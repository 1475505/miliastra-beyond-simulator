import test from 'node:test'
import assert from 'node:assert/strict'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { Container, DOMAdapter, Matrix } from 'pixi.js'
import { createRuntime } from '../../client/lua-runtime/src/index.js'
import { createStudio } from '../index.js'
import { paintList, playSnapshot } from '../play/session.js'
import { renderEditorPng, renderPaintPng, renderScenePng, flattenScenePaint } from '../host-png.js'
import { PixiPlayRenderer } from '../play/pixi-renderer.js'
import { editorMaskProject, maskScenes, maskSamples, maskAlphas } from './fixtures/image-mask.mjs'

function control(name, kind, x, y, w, h, extra = {}) {
  return {
    name, kind, active: true, visible: true,
    anchoredPositionX: x, anchoredPositionY: y, sizeDeltaX: w, sizeDeltaY: h,
    anchorMinX: 0.5, anchorMaxX: 0.5, anchorMinY: 0.5, anchorMaxY: 0.5,
    pivotX: 0.5, pivotY: 0.5, ...extra,
  }
}

function fixture(t) {
  const runtime = createRuntime({ canvasWidth: 240, canvasHeight: 160 })
  t.after(() => runtime.destroy())
  const root = runtime.addRoot(control('Root', 'container', 0, 0, 240, 160, {
    children: [
      control('Sibling', 'image', 90, 0, 24, 24, { imageId: 100001, imageColor: 0xff0000ff }),
      control('Mask', 'image', 0, 0, 100, 60, {
        imageId: 100001, imageColor: 0x00ffffff, enableMask: true,
        children: [
          control('Red', 'image', 0, 12, 180, 24, { imageId: 100001, imageColor: 0xffff0000 }),
          control('Group', 'container', 0, 0, 100, 60, {
            children: [control('Green', 'image', 0, -12, 180, 24, { imageId: 100001, imageColor: 0xff00ff00 })],
          }),
        ],
      }),
    ],
  }))
  const session = { runtime, compiled: { canvasId: 'pc-16-9', platform: 'PC' }, history: [] }
  return { runtime, root, mask: root.GetChild('Mask'), session, scene: () => playSnapshot(session, { view: true }).scene }
}

async function alphaPixel(png, x, yFromTop) {
  const image = await loadImage(png.data)
  const canvas = createCanvas(image.width, image.height)
  const ctx = canvas.getContext('2d')
  ctx.drawImage(image, 0, 0)
  return ctx.getImageData(x, yFromTop, 1, 1).data[3]
}

test('hard rectangle mask clips descendants but not siblings, independent of image alpha', async (t) => {
  const f = fixture(t)
  const png = renderScenePng(f.scene(), 240, 160, { background: 'transparent' })
  const flat = renderPaintPng(paintList(f.session), 240, 160, { background: 'transparent' })
  assert.deepEqual(png.data, flat.data)
  assert.equal(await alphaPixel(png, 120, 68), 255, 'direct child inside the mask stays visible')
  assert.equal(await alphaPixel(png, 120, 92), 255, 'grandchild inside the mask stays visible')
  assert.equal(await alphaPixel(png, 40, 68), 0, 'direct child outside the rectangle is clipped')
  assert.equal(await alphaPixel(png, 40, 92), 0, 'grandchild outside the rectangle is clipped')
  assert.equal(await alphaPixel(png, 210, 80), 255, 'sibling outside the mask is not clipped')
  assert.equal(await alphaPixel(png, 120, 108), 0, 'transparent mask image does not paint its own pixels')
})

test('pixel feather fades inward on the selected axis and width zero stays hard', async (t) => {
  const f = fixture(t)
  f.mask.enableSoftEdge = true
  f.mask.softEdgeMode = 'Pixel'
  f.mask.softEdgeWidthX = 20
  f.mask.softEdgeWidthY = 0
  const png = renderScenePng(f.scene(), 240, 160, { background: 'transparent' })
  // Hand-calculated distances 9.5/19.5/50.5 from the left edge, divided by 20.
  for (const [x, alpha] of [[79, 121], [89, 249], [120, 255]]) assert.equal(await alphaPixel(png, x, 68), alpha)
  assert.equal(await alphaPixel(png, 120, 58), 255, 'zero vertical feather does not fade the top edge')
  f.mask.softEdgeWidthX = 0
  const hard = renderScenePng(f.scene(), 240, 160, { background: 'transparent' })
  assert.equal(await alphaPixel(hard, 71, 68), 255)
  assert.equal(await alphaPixel(hard, 68, 68), 0)
  f.mask.softEdgeWidthY = 20
  const vertical = renderScenePng(f.scene(), 240, 160, { background: 'transparent' })
  assert.equal(await alphaPixel(vertical, 120, 58), 108, '8.5 units inside a 20-unit top feather')
  assert.equal(await alphaPixel(vertical, 71, 80), 255, 'X=0 keeps the left edge hard')
})

test('soft masks composite groups once, multiply nested groups, and retain empty coverage', async () => {
  for (const [name, scene] of Object.entries(maskScenes())) {
    const png = renderScenePng(scene, 240, 160, { background: 'transparent' })
    assert.deepEqual(png.data, renderPaintPng(flattenScenePaint(scene), 240, 160, { background: 'transparent' }).data)
    const ctx = createCanvas(240, 160).getContext('2d')
    ctx.drawImage(await loadImage(png.data), 0, 0)
    maskSamples.forEach(([x, y], i) => {
      const pixel = [...ctx.getImageData(x, y, 1, 1).data]
      assert.equal(pixel[3], maskAlphas[name][i], `${name}: alpha at ${x},${y}`)
      if (pixel[3]) assert.deepEqual(pixel.slice(0, 3), [255, 0, 0], `${name}: no mask/viewport white leaks`)
    })
  }
})

test('Lua mask-only changes invalidate the scene', t => {
  const f = fixture(t)
  const script = f.runtime.mountScript({ path: 'mask', control: f.root, source: `
function SetMask(width)
  local mask = script.object:GetChild('Mask')
  mask.enableSoftEdge = true
  mask.softEdgeMode = Enum.ImageMaskSoftEdgeMode.Pixel
  mask:SetSoftEdgeWidth(width, 0)
end` })
  const before = f.scene()
  f.runtime.invokeOn(script.env, 'SetMask', [40])
  const patch = playSnapshot(f.session, { view: true, sceneRev: before.revision }).scene
  assert.equal(patch.reset, false)
  assert.equal(patch.changed.find(n => n.name === 'Mask').softEdgeWidthX, 40)
  assert.equal(f.runtime.logs.some(n => n.level === 'lua-error'), false)
})

test('cropped mask layers keep backing-pixel offsets at high DPI and when partly outside the canvas', async () => {
  const scene = maskScenes().nested
  scene.nodes.find(n => n.id === 'root').matrix.tx = 20
  const png = renderScenePng(scene, 240, 160, { background: 'transparent', scale: 2 })
  // World x=59.75 is 10.25 inside the right edge; two masks apply .5125 twice.
  assert.equal(await alphaPixel(png, 119, 160), 67)
  assert.equal(await alphaPixel(png, 150, 160), 0)
  assert.equal(await alphaPixel(png, 40, 160), 255)
})

test('Pixi image and viewport masks update independently and release their resources', async t => {
  const previous = DOMAdapter.get()
  DOMAdapter.set({ ...previous, createCanvas })
  const renderer = Object.create(PixiPlayRenderer.prototype)
  Object.assign(renderer, { ready: Promise.resolve(), nodes: new Map(), scratch: new Matrix(), canvasWidth: 240, canvasHeight: 160,
    app: { stage: new Container(), render() {}, renderer: { resize() {} } } })
  t.after(() => { renderer.clearNodes(); DOMAdapter.set(previous) })
  const scene = maskScenes().grid
  await renderer.applyScene(scene, 240, 160)
  const root = renderer.nodes.get('mask')
  const viewport = root.__viewportClip, texture = root.__imageMask.texture
  const item = scene.nodes.find(n => n.id === 'mask')
  const update = extra => renderer.applyScene({ format: 'tree-v1', reset: false, changed: [{ ...item, ...extra }] }, 240, 160)
  await update({ softEdgeWidthX: 40 })
  assert.equal(root.mask, viewport, 'width change must not overwrite viewport clip')
  assert.equal(root.__imageMask.texture, texture, 'width animation reuses the texture')
  assert.equal(root.__imageContent.mask, root.__imageMask)
  await update({ sourceWidth: 0 })
  assert.equal(root.__imageContent.visible, false)
  assert.equal(root.mask, viewport)
  assert.equal(texture.destroyed, true)
  await update({})
  assert.equal(root.__imageContent.visible, true)
  const restoredTexture = root.__imageMask.texture
  await update({ enableMask: false })
  assert.equal(root.mask, viewport)
  assert.equal(root.__imageContent.mask, undefined)
  assert.equal(restoredTexture.destroyed, true)
  await update({ clipToParent: false })
  assert.equal(root.mask, undefined)
  assert.equal(viewport.destroyed, true)
  const finalTexture = root.__imageMask.texture
  renderer.removeNode('mask')
  assert.equal(finalTexture.destroyed, true)
  assert.equal(renderer.nodes.get('red').destroyed, false, 'child removal is owned by the scene, not mask disposal')
})

test('a rotated mask uses its own rectangle rather than the axis-aligned bounds', async (t) => {
  const f = fixture(t)
  f.mask.SetLocalRotation(0, 0, 90)
  const png = renderScenePng(f.scene(), 240, 160, { background: 'transparent' })
  assert.equal(await alphaPixel(png, 120, 80), 255, 'center survives rotation')
  assert.equal(await alphaPixel(png, 145, 80), 0, 'wide axis-aligned point is outside the rotated thin rectangle')
  assert.equal(await alphaPixel(png, 120, 60), 255, 'the rotated long axis remains inside')
})

test('editor boxes preserve mask ancestry; editor PNG composites groups and keeps selection outside masks', async () => {
  const studio = createStudio(editorMaskProject())
  const context = createCanvas(1600, 900).getContext('2d')
  const draw = async snapshot => {
    context.clearRect(0, 0, 1600, 900)
    context.drawImage(await loadImage(renderEditorPng(snapshot).data), 0, 0)
    return (x, y) => [...context.getImageData(x, y, 1, 1).data]
  }
  const snapshot = studio.get()
  const background = await draw({ ...snapshot, boxes: [] })
  const bg = [background(740, 450), background(760, 450)]
  assert.equal(snapshot.boxes.find(box => box.id === 'mask').masks[0].id, 'mask')
  assert.deepEqual(snapshot.boxes.find(box => box.id === 'red').masks.map(mask => mask.id), ['mask'])
  assert.equal(snapshot.boxes.find(box => box.id === 'sibling').masks, undefined)
  let pixel = await draw(snapshot)
  assert.deepEqual(pixel(740, 450), bg[0], 'outside child pixels are clipped')
  const expected = [255, 0, 0].map((value, i) => Math.round(value * 134 / 255 + bg[1][i] * 121 / 255))
  pixel(760, 450).slice(0, 3).forEach((value, i) => assert.ok(Math.abs(value - expected[i]) <= 1,
    'overlapping children receive their common feather only once'))
  assert.deepEqual(pixel(800, 450), [255, 0, 0, 255])
  assert.deepEqual(pixel(910, 450), [0, 0, 255, 255])
  studio.patch({ op: 'set', id: 'mask', key: 'width', value: 0 })
  pixel = await draw(studio.get())
  assert.deepEqual(pixel(760, 450), bg[1], 'zero-sized masks retain empty coverage')
  studio.patch({ op: 'set', id: 'mask', key: 'width', value: 100 })
  studio.patch({ op: 'set', id: 'mask', key: 'rotationZ', value: 90 })
  pixel = await draw(studio.get())
  assert.deepEqual(pixel(740, 450), bg[0], 'rotated mask stays in its own local rectangle')
  studio.patch({ op: 'set', id: 'mask', key: 'rotationZ', value: 0 })
  studio.patch({ op: 'select', id: 'red' })
  pixel = await draw(studio.get())
  assert.deepEqual(pixel(710, 450), [97, 185, 255, 255], 'selected child outline is editable outside the mask')
  studio.patch({ op: 'set', id: 'mask', key: 'visible', value: false })
  assert.equal(studio.get().boxes.find(box => box.id === 'red').visibleInHierarchy, false)
  pixel = await draw(studio.get())
  assert.deepEqual(pixel(740, 450), bg[0])

  const nestedSnapshot = createStudio(editorMaskProject({ nested: true })).get()
  assert.deepEqual(nestedSnapshot.boxes.find(box => box.id === 'red').masks.map(mask => mask.id), ['mask', 'inner'])
  pixel = await draw(nestedSnapshot)
  const fadedTwice = [255, 0, 0].map((value, i) => Math.round(value * 70 / 255 + bg[1][i] * 185 / 255))
  pixel(760, 450).slice(0, 3).forEach((value, i) => assert.ok(Math.abs(value - fadedTwice[i]) <= 1))
})
