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
import { hitPlayControl, paintList, playSnapshot } from '../play/session.js'
import { flattenScenePaint, renderScenePng, renderPaintPng, renderEditorPng } from '../host-png.js'
import { PixiPlayRenderer } from '../play/pixi-renderer.js'
import { controlTransformStyle } from '../../editor-ui/control-transform.js'
import { imageTiltFixture } from './fixtures/image-tilt.mjs'

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
  // Keep distinct projection classes: face-on, compressed, edge-on and flipped.
  // Ratios come from device observations, not the matrix implementation.
  for (const axis of ['X', 'Y']) for (const [angle, ratio] of [[0, 1], [60, .5], [90, 0], [180, -1]]) {
    let previousPng
    for (const field of [false, true]) {
      const before = playSnapshot(session, { view: true }).scene
      runtime.invokeOn(script.env, 'Rotate', [axis, angle, field])
      const delta = playSnapshot(session, { view: true, sceneRev: before.revision }).scene
      assert.equal(delta.reset, false)
      if (!field && angle !== 0) {
        const changed = delta.changed.find(node => node.name === 'Image')
        assert.ok(changed, 'rotation-only updates must invalidate the scene')
        close(changed.matrix.a, axis === 'Y' ? ratio : 1)
        close(changed.matrix.d, axis === 'X' ? ratio : 1)
      }
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

test('IMGGEOM Y rotations and parent Z scale give 100, 0, 100 and 150 percent widths', async t => {
  const { runtime, session, lua, scene, parent } = imageTiltFixture(t)
  const renderer = Object.create(PixiPlayRenderer.prototype)
  Object.assign(renderer, { ready: Promise.resolve(), nodes: new Map(), scratch: new Matrix(), canvasWidth: 240, canvasHeight: 160,
    app: { stage: new Container(), render() {}, renderer: { resize() {} } } })
  t.after(() => renderer.clearNodes())
  const face = parent.GetChild('Face'), hit = parent.GetChild('Hit')
  const [left, right] = face.children.map(c => c.Id)
  const opts = { background: 'transparent' }
  const full = scene()
  const nodes = new Map(full.nodes.map(node => [node.id, node]))
  let revision = full.revision
  await renderer.applyScene(full, 240, 160)
  const visual = renderer.nodes.get(face.Id).__visual
  const cases = [
    ['R0', () => {}, 1],
    ['R1', () => lua('Pose', 45, 45), 0],
    ['R2', () => lua('Pose', 45, -45), 1],
    ['R3', () => lua('SetDepth', 2), 1.5],
    ['Z Field', () => lua('DepthField', 1), 1],
    ['Z Tween half', () => { lua('DepthTween', 2); runtime.step(.5) }, 1.25],
    ['Edge-on parent, recovered child', () => { runtime.step(.5); lua('SetDepth', 1); lua('Pose', 90, -90) }, 1],
    ['Flipped child', () => lua('Pose', 90, 90), -1],
    ['Planar again', () => lua('Pose', 0, 0), 1],
  ]
  for (const [label, change, scale] of cases) {
    change()
    const delta = scene(revision)
    assert.equal(delta.reset, false)
    for (const node of delta.changed) nodes.set(node.id, node)
    assert.deepEqual(delta.removed, [])
    if (label === 'R3' || label.startsWith('Z ')) {
      assert.deepEqual(new Set(delta.changed.map(n => n.id)), new Set([face.Id, left, right]), 'parent face unchanged, but its descendants must refresh')
    }
    revision = delta.revision
    const current = { nodes: [...nodes.values()] }
    const item = flattenScenePaint(current).find(n => n.id === face.Id)
    assert.deepEqual([item.sourceWidth, item.sourceHeight], [100, 42])
    close(item.width, 100 * Math.abs(scale))
    close(item.matrix.a, scale)
    close(item.matrix.tx, 120)
    const png = renderScenePng(current, 240, 160, opts)
    assert.deepEqual(png.data, renderPaintPng(paintList(session), 240, 160, opts).data)
    const ctx = createCanvas(240, 160).getContext('2d')
    ctx.drawImage(await loadImage(png.data), 0, 0)
    const row = ctx.getImageData(28, 80, 184, 1).data
    // A half-pixel edge contributes partial coverage when the width is odd.
    const coverage = row.reduce((sum, value, i) => i % 4 === 3 ? sum + value : sum, 0) / 255
    assert.ok(Math.abs(coverage - 100 * Math.abs(scale)) < .02, `${label}: pixel width ${coverage}`)
    if (scale !== 0) {
      for (const [offset, color] of [[-39, [255, 0, 0, 255]], [39, [255, 255, 0, 255]]]) {
        assert.deepEqual([...ctx.getImageData(Math.floor(120 + scale * offset), 80, 1, 1).data], color, label)
      }
    }
    assert.equal(hitPlayControl(session, 120, 80), scale === 0 ? null : hit)
    assert.equal(hitPlayControl(session, 185, 80), label === 'R3' ? hit : null)

    await renderer.applyScene(delta, 240, 160)
    assert.equal(renderer.nodes.get(face.Id).__visual, visual, 'geometry is reused through pose changes')
    const world = visual.getGlobalTransform(new Matrix())
    close(world.a, scale)
    close(world.d, 1)
    close(world.tx, 120)
    close(world.ty, 80)
    close(renderer.nodes.get(left).__visual.getGlobalTransform(new Matrix()).tx, 120 - 39 * scale)
    assert.deepEqual(scene(revision).changed, [], 'a settled pose sends no redundant delta')
  }
  assert.equal(runtime.logs.some(l => l.level === 'lua-error'), false)
})

test('editor projects an off-center child pivot through parent Z scale without changing local layout', () => {
  const picture = createNode('image', { id: 'face' })
  const tilt = createNode('container', { children: [picture] })
  const root = createNode('container', { children: [tilt] })
  Object.assign(picture.transformByPlatform.KEYBOARD, {
    size: { x: 100, y: 42 }, pivot: { x: 0, y: .5 }, offset: { x: 20, y: 0 }, rotation: { x: 0, y: -90, z: 0 },
  })
  tilt.transformByPlatform.KEYBOARD.rotation.y = 90
  tilt.transformByPlatform.KEYBOARD.scale.z = 2
  root.transformByPlatform.KEYBOARD.rotation.z = 90
  const { boxes } = layoutTree(root, 'pc-16-9')
  const box = boxes.face, p = box.renderMatrix
  // Child's pivot offset along X projects into depth in the parent. Its own
  // width turns back, doubles, then the planar root turns it up the screen.
  assert.deepEqual([box.left, box.width, box.height], [820, 100, 42])
  close(box.renderWidth, 200)
  close(p.a, 0); close(p.b, 2); close(p.c, -1); close(p.d, 0)
  close(p.c * box.centerY + p.tx, 800)
  close(p.b * box.centerX + p.ty, 550)
  assert.equal(hitTest([box], 800, 630), 'face')
  assert.equal(hitTest([box], 800, 420), null)
})
