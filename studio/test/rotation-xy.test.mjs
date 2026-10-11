import test from 'node:test'
import assert from 'node:assert/strict'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { Container, Matrix } from 'pixi.js'
import { createRuntime } from '../../client/lua-runtime/src/index.js'
import { createStudio } from '../index.js'
import { PLATFORMS } from '../constants.js'
import { createNode } from '../ui/authoring.js'
import { layoutTree, painterBoxes, hitTest } from '../ui/inspector.js'
import { computeRect, canvasBox, localRectMatrix } from '../ui/layout.js'
import { paintList, playSnapshot } from '../play/session.js'
import { renderScenePng, renderPaintPng, renderEditorPng } from '../host-png.js'
import { PixiPlayRenderer } from '../play/pixi-renderer.js'
import { controlTransformStyle } from '../../editor-ui/control-transform.js'

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`)
test('XY inspector edits preserve other axes and respect four-platform synchronization', () => {
  const studio = createStudio()
  const id = studio.get().root.children[0].children.find(c => c.kind === 'image').id
  studio.patch({ op: 'select', id })
  for (const [key, value] of [['rotationX', 60], ['rotationY', 120], ['rotationZ', 30]]) studio.patch({ op: 'set', key, value })
  const image = studio.get().root.children[0].children.find(c => c.id === id)
  for (const p of PLATFORMS) assert.deepEqual(image.transformByPlatform[p].rotation, { x: 60, y: 120, z: 30 })
  studio.patch({ op: 'set', key: 'syncAllDevices', value: false })
  studio.patch({ op: 'set', key: 'rotationX', value: 0 })
  const changed = studio.get().root.children[0].children.find(c => c.id === id)
  assert.equal(changed.transformByPlatform.KEYBOARD.rotation.x, 0)
  assert.equal(changed.transformByPlatform.TOUCHSCREEN.rotation.x, 60)
  assert.throws(() => studio.patch({ op: 'set', key: 'rotationY', value: Infinity }), /finite/)
  const restored = createStudio(studio.archiveData())
  assert.deepEqual(restored.get().root.children[0].children.find(c => c.id === id).transformByPlatform, changed.transformByPlatform)
})

test('projected Euler policy renders equivalent device readbacks identically and respects pivots', () => {
  const rt = createNode('image').transformByPlatform.KEYBOARD
  const box = computeRect(canvasBox('pc-16-9'), rt)
  for (const [first, second] of [[{ x: 120, y: 0, z: 0 }, { x: 60, y: 180, z: 180 }],
    [{ x: 180, y: 0, z: 0 }, { x: 0, y: 180, z: 180 }]]) {
    const a = localRectMatrix(box, { ...rt, rotation: first }), b = localRectMatrix(box, { ...rt, rotation: second })
    for (const key of Object.keys(a)) close(a[key], b[key])
  }
  const m = localRectMatrix(box, { ...rt, pivot: { x: 0, y: 0 }, rotation: { x: 180, y: 0, z: 0 } })
  close(m.d, -1)
  close(m.ty, 2 * box.bottom)
  const style = controlTransformStyle({ ...box, renderMatrix: m }, 1600, 900)
  assert.equal(style.transform, 'matrix(1,0,0,-1,0,0)')
  assert.equal(style.width, '5%')
})

test('editor screenshot and selection preserve inherited back-face reflection', async () => {
  const image = createNode('image', { id: 'picture', imageColor: 0xff87cafa })
  const corner = createNode('image', { id: 'corner', imageColor: 0xffff0000 })
  image.children.push(corner)
  image.transformByPlatform.KEYBOARD.rotation.y = 180
  const rt = corner.transformByPlatform.KEYBOARD
  rt.size = { x: 12, y: 12 }; rt.offset = { x: -25, y: 20 }
  const { boxes } = layoutTree(image, 'pc-16-9')
  assert.equal(hitTest([boxes.corner], 825, 470), 'corner')
  assert.equal(hitTest([boxes.corner], 775, 470), null)
  const png = renderEditorPng({ canvas: { width: 1600, height: 900 }, boxes: painterBoxes(image, boxes) })
  const ctx = createCanvas(1600, 900).getContext('2d')
  ctx.drawImage(await loadImage(png.data), 0, 0)
  assert.deepEqual([...ctx.getImageData(825, 430, 1, 1).data], [255, 0, 0, 255])
  image.transformByPlatform.KEYBOARD.rotation.y = 90
  assert.equal(hitTest([layoutTree(image, 'pc-16-9').boxes.picture], 800, 450), null)
})

test('Lua XY methods/fields drive PNG, flat paint, Pixi transforms and inherited corner markers', async t => {
  const runtime = createRuntime({ canvasWidth: 240, canvasHeight: 160 })
  t.after(() => runtime.destroy())
  const control = (name, kind, x, y, w, h, extra = {}) => ({ name, kind, active: true, visible: true,
    anchoredPositionX: x, anchoredPositionY: y, sizeDeltaX: w, sizeDeltaY: h, pivotX: .5, pivotY: .5,
    anchorMinX: .5, anchorMaxX: .5, anchorMinY: .5, anchorMaxY: .5, ...extra })
  const root = runtime.addRoot(control('Root', 'container', 0, 0, 240, 160, { children: [
    control('Image', 'image', 0, 0, 100, 60, { imageId: 100001, imageColor: 0xff87cafa, children: [
      control('Corner', 'image', -35, 18, 12, 12, { imageId: 100001, imageColor: 0xffff0000 }),
    ] }),
  ] }))
  const script = runtime.mountScript({ path: 'rotxy', control: root, source: `
function Rotate(axis, angle, field)
  local image = script.object:GetChild('Image')
  image:SetLocalRotation(0, 0, 0)
  if field then
    if axis == 'X' then image.localRotationX = angle else image.localRotationY = angle end
  elseif axis == 'X' then image:SetLocalRotation(angle, 0, 0)
  else image:SetLocalRotation(0, angle, 0) end
end` })
  const session = { runtime, compiled: { canvasId: 'pc-16-9', platform: 'PC' }, history: [] }
  // Independent device-observed single-axis ratios/flip signs, not a golden
  // generated by the matrix implementation. 30° is the analytic projection.
  for (const axis of ['X', 'Y']) for (const [angle, ratio] of [[0, 1], [30, Math.sqrt(3) / 2], [60, .5], [90, 0], [120, -.5], [180, -1]]) {
    let previousPng
    for (const field of [false, true]) {
      runtime.invokeOn(script.env, 'Rotate', [axis, angle, field])
      const scene = playSnapshot(session, { view: true }).scene
      const paint = paintList(session), item = paint.find(c => c.name === 'Image')
      close(item.matrix.a, axis === 'Y' ? ratio : 1)
      close(item.matrix.d, axis === 'X' ? ratio : 1)
      const png = renderScenePng(scene, 240, 160, { background: 'transparent' })
      assert.deepEqual(png.data, renderPaintPng(paint, 240, 160, { background: 'transparent' }).data)
      if (previousPng) assert.deepEqual(png.data, previousPng, 'method and field produce the same pixels')
      previousPng = png.data
      const ctx = createCanvas(240, 160).getContext('2d')
      ctx.drawImage(await loadImage(png.data), 0, 0)
      if (ratio === 0) {
        assert.equal(ctx.getImageData(0, 0, 240, 160).data.some((v, i) => i % 4 === 3 && v), false, 'edge-on paints no face')
      } else {
        const x = Math.floor(120 - 35 * (axis === 'Y' ? ratio : 1))
        const y = Math.floor(80 - 18 * (axis === 'X' ? ratio : 1))
        assert.deepEqual([...ctx.getImageData(x, y, 1, 1).data], [255, 0, 0, 255], 'corner inherits compression and back-face reflection')
      }
      const pixi = Object.create(PixiPlayRenderer.prototype)
      Object.assign(pixi, { scratch: new Matrix(), canvasHeight: 160 })
      const container = new Container()
      pixi.applyMatrix(container, item, false)
      container.updateLocalTransform()
      close(container.localTransform.a, item.matrix.a)
      close(container.localTransform.d, item.matrix.d)
      container.destroy()
    }
  }
  assert.equal(runtime.logs.some(l => l.level === 'lua-error'), false)
})

test('XY-only Lua edits produce scene deltas', t => {
  const runtime = createRuntime({ canvasWidth: 100, canvasHeight: 100 })
  t.after(() => runtime.destroy())
  const image = runtime.addRoot({ kind: 'image', imageId: 100001, active: true, visible: true })
  const session = { runtime, compiled: { canvasId: 'pc-16-9', platform: 'PC' }, history: [] }
  const before = playSnapshot(session, { view: true }).scene
  image.SetLocalRotation(60, 0, 0)
  const delta = playSnapshot(session, { view: true, sceneRev: before.revision }).scene
  assert.equal(delta.reset, false)
  close(delta.changed.find(c => c.id === image.Id).matrix.d, .5)
})
