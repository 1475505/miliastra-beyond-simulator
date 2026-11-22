import test from 'node:test'
import assert from 'node:assert/strict'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { Container, DOMAdapter, Matrix } from 'pixi.js'
import { createRuntime } from '../../client/lua-runtime/src/index.js'
import { createStudio } from '../index.js'
import { paintList, playSnapshot } from '../play/session.js'
import { renderEditorPng, renderPaintPng, renderScenePng, flattenScenePaint } from '../host-png.js'
import { PixiPlayRenderer } from '../play/pixi-renderer.js'
import { editorMaskProject, maskScenes, maskSamples, maskAlphas, contourScene, contourSamples, contourAlphas, disjointReverseMaskScene } from './fixtures/image-mask.mjs'
import { imageMaskSpec, createMaskSampler, paintMaskCanvas } from '../play/image-mask.js'
import { featherMaskAlpha } from '../play/image-mask-raster.js'
import { imageAssetKey } from '../assets/catalog.js'

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

test('Lua feather changes reach scene deltas and independent pixels; width zero stays hard', async (t) => {
  const f = fixture(t)
  const script = f.runtime.mountScript({ path: 'mask', control: f.root, source: `
function SetMask(x, y)
  local mask = script.object:GetChild('Mask')
  mask.enableSoftEdge = true
  mask.softEdgeMode = Enum.ImageMaskSoftEdgeMode.Pixel
  mask:SetSoftEdgeWidth(x, y)
end` })
  const before = f.scene()
  f.runtime.invokeOn(script.env, 'SetMask', [20, 0])
  const patch = playSnapshot(f.session, { view: true, sceneRev: before.revision }).scene
  assert.equal(patch.reset, false)
  assert.equal(patch.changed.find(n => n.name === 'Mask').softEdgeWidthX, 20)
  const png = renderScenePng(f.scene(), 240, 160, { background: 'transparent' })
  // Hand-calculated distances 9.5/19.5/50.5 from the left edge, divided by 20.
  for (const [x, alpha] of [[79, 121], [89, 249], [120, 255]]) assert.equal(await alphaPixel(png, x, 68), alpha)
  assert.equal(await alphaPixel(png, 120, 58), 255, 'zero vertical feather does not fade the top edge')
  f.runtime.invokeOn(script.env, 'SetMask', [0, 0])
  const hard = renderScenePng(f.scene(), 240, 160, { background: 'transparent' })
  assert.equal(await alphaPixel(hard, 71, 68), 255)
  assert.equal(await alphaPixel(hard, 68, 68), 0)
  f.runtime.invokeOn(script.env, 'SetMask', [0, 20])
  const vertical = renderScenePng(f.scene(), 240, 160, { background: 'transparent' })
  assert.equal(await alphaPixel(vertical, 120, 58), 108, '8.5 units inside a 20-unit top feather')
  assert.equal(await alphaPixel(vertical, 71, 80), 255, 'X=0 keeps the left edge hard')
  assert.equal(f.runtime.logs.some(n => n.level === 'lua-error'), false)
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
  await update({ primitive: 'ring', imageId: 100006, reverseMaskArea: true })
  assert.equal(root.__imageMask.texture, texture, 'shape and inverse changes repaint the owned texture')
  const pixels = texture.source.resource.getContext('2d')
  assert.equal(pixels.getImageData(100, 60, 1, 1).data[3], 255, 'the inverted ring leaves its hole visible in the mask texture')
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

test('a disjoint reversed mask does not reveal the ring at 0°, 45° or 90°', async () => {
  const options = { background: 'transparent' }
  const empty = renderPaintPng([], 240, 160, options).data
  for (const angle of [0, 45, 90]) {
    const scene = disjointReverseMaskScene(angle)
    assert.ok(renderScenePng(scene, 240, 160, options).data.equals(empty), `the ring is fully clipped at ${angle}°`)
    scene.nodes[1].enableMask = false
    assert.equal(await alphaPixel(renderScenePng(scene, 240, 160, options), 164, 80), 255, 'the ring is visible with masking off')
  }
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

test('six contour masks and their complements clip outside the rectangle and retain local shapes', async () => {
  for (const [primitive, expected] of Object.entries(contourAlphas)) for (const reverseMaskArea of [false, true]) {
    const scene = contourScene(primitive, { reverseMaskArea })
    const png = renderScenePng(scene, 240, 160, { background: 'transparent' })
    assert.deepEqual(png.data, renderPaintPng(flattenScenePaint(scene), 240, 160, { background: 'transparent' }).data)
    for (const [i, [x, y]] of contourSamples.entries()) {
      const want = reverseMaskArea && i !== 0 ? 255 - expected[i] : expected[i]
      assert.equal(await alphaPixel(png, x, y), want, `${primitive} reverse=${reverseMaskArea} at ${x},${y}`)
    }
  }
  const scene = contourScene('triangle')
  scene.nodes.find(n => n.id === 'mask').matrix = { a: 0, b: 1, c: -1, d: 0, tx: 0, ty: 0 }
  const png = renderScenePng(scene, 240, 160, { background: 'transparent' })
  assert.equal(await alphaPixel(png, 160, 120), 255, 'rotated base')
  assert.equal(await alphaPixel(png, 80, 120), 0, 'rotated tip excludes corner')
  for (const size of [{ sourceWidth: 0 }, { sourceHeight: 0 }]) {
    const empty = renderScenePng(contourScene('ring', { ...size, reverseMaskArea: true }), 240, 160, { background: 'transparent' })
    assert.equal(await alphaPixel(empty, 120, 80), 0, 'empty rectangle stays empty with inversion on')
    assert.equal(await alphaPixel(empty, 60, 80), 0)
  }
})

test('percentage ranges, contour feather and inversion follow independently calculated alpha', () => {
  const alpha = new Uint8ClampedArray([0, 0, 0, 0, 0, 0, 255, 255, 255, 0, 0, 255, 0, 255, 0, 0, 255, 128, 255, 0, 0, 0, 0, 0, 0])
  assert.deepEqual(featherMaskAlpha(alpha, 5, 5, 0, 0), alpha)
  const x = featherMaskAlpha(alpha, 5, 5, 2, 0), y = featherMaskAlpha(alpha, 5, 5, 0, 2)
  assert.equal(x[11], 64); assert.equal(x[7], 191); assert.equal(x[17], 128)
  assert.equal(y[11], 191); assert.equal(y[7], 64); assert.equal(y[12], 0)
  const matrix = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 }
  const item = { kind: 'image', imageId: 100001, enableMask: true, width: 200, height: 100,
    enableSoftEdge: true, softEdgeMode: 'Percentage', horizontalSoftRange: 80, verticalSoftRange: 60,
    softEdgeWidthX: 999, softEdgeWidthY: 888 }
  const mask = imageMaskSpec(item, matrix), sample = createMaskSampler(mask, createCanvas)
  assert.ok(Math.abs(mask.featherX - 20) < 1e-10); assert.equal(mask.featherY, 20)
  assert.ok(Math.abs(sample(90, 0) - .5) < 1e-10)
  assert.equal(sample(0, 40), .5)
  const inverted = createMaskSampler({ ...mask, reverseMaskArea: true }, createCanvas)
  assert.equal(inverted(100, 0), 0, 'the boundary is not inverted')
  assert.equal(inverted(110, 0), 0)
  assert.ok(Math.abs(inverted(95, 0) - .75) < 1e-10)
  const ring = createMaskSampler({ ...mask, primitive: 'ring', width: 100, height: 100, featherX: 10, featherY: 0 }, createCanvas)
  assert.equal(ring(0, 0), 0)
  assert.ok(ring(45, 0) > .4 && ring(45, 0) < .6, 'both outer edge and hole feather inward')
  assert.equal(item.softEdgeWidthX, 999)
})

test('mask textures preserve contour coverage at native and resampled resolutions', () => {
  for (const [primitive, expected] of Object.entries(contourAlphas)) for (const [width, height] of [[200, 200], [125, 75]]) {
    const canvas = createCanvas(width, height)
    const ctx = canvas.getContext('2d')
    for (const reverseMaskArea of [false, true]) {
      paintMaskCanvas(canvas, { primitive, width: 100, height: 100, featherX: 0, featherY: 0, reverseMaskArea }, null, createCanvas)
      contourSamples.slice(1).forEach(([x, y], i) => {
        const pixel = ctx.getImageData(Math.floor((x - 70) * width / 100), Math.floor((y - 30) * height / 100), 1, 1).data
        const want = reverseMaskArea ? 255 - expected[i + 1] : expected[i + 1]
        assert.equal(pixel[3], want, `${primitive} ${width}×${height} at ${x},${y}; reverse=${reverseMaskArea}`)
      })
    }
  }
  const canvas = createCanvas(200, 200)
  paintMaskCanvas(canvas, { primitive: 'ring', width: 100, height: 100, featherX: 10, featherY: 0 }, null, createCanvas)
  const alpha = canvas.getContext('2d').getImageData(190, 100, 1, 1).data[3]
  assert.ok(Math.abs(alpha - 121) <= 2, 'pixel center 45.25 is 4.75 units inside a ten-unit outer feather')
})

test('texture alpha and slice borders determine masks independently of image tint', async () => {
  const image = createCanvas(10, 10), ctx = image.getContext('2d')
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 10, 10); ctx.clearRect(2, 2, 6, 6)
  ctx.clearRect(0, 0, 2, 10); ctx.fillStyle = '#ffffff80'; ctx.fillRect(0, 0, 2, 10)
  const key = imageAssetKey(101001)
  const options = { background: 'transparent', images: new Map([[key, image]]),
    imageMetadata: new Map([[key, { width: 10, height: 10, border: { left: 2, right: 2, top: 2, bottom: 2 } }]]) }
  const scene = contourScene('sprite', { imageId: 101001, imageType: 'Basic' })
  let png = renderScenePng(scene, 240, 160, options)
  assert.equal(await alphaPixel(png, 80, 80), 128, 'semi-transparent texture edge survives transparent tint')
  assert.equal(await alphaPixel(png, 120, 80), 0, 'texture hole')
  const mask = scene.nodes.find(n => n.id === 'mask')
  mask.imageType = 'Stretch'
  png = renderScenePng(scene, 240, 160, options)
  assert.equal(await alphaPixel(png, 85, 80), 0, 'two-unit border is not stretched to twenty')
  assert.equal(await alphaPixel(png, 169, 80), 255, 'right border remains two units wide')
  mask.reverseMaskArea = true
  png = renderScenePng(scene, 240, 160, options)
  assert.equal(await alphaPixel(png, 120, 80), 255)
  assert.equal(await alphaPixel(png, 60, 80), 0, 'inverted slice stays inside the rectangle')
  assert.equal(await alphaPixel(png, 169, 80), 0)
})

test('isolated Lua mask assignments and percentage Tweens update scene deltas and pixels', async t => {
  const f = fixture(t)
  const script = f.runtime.mountScript({ path: 'mask-controls', control: f.root, source: `
local mask = script.object:GetChild('Mask')
mask.enableSoftEdge = true
mask.softEdgeMode = Enum.ImageMaskSoftEdgeMode.Percentage
mask.horizontalSoftRange = 100
mask.verticalSoftRange = 100
function Horizontal(range) mask.horizontalSoftRange = range end
function Vertical(range) mask.verticalSoftRange = range end
function Invert(reverse) mask.reverseMaskArea = reverse end
function TweenRange(field)
  game.Tween(mask, { [field] = 20 }, 1):SetEase(Enum.EaseType.Linear):Play()
end
function UseCircle() mask:SetImage(Enum.ImageSource.StaticReference, 100002) end` })
  assert.deepEqual(f.runtime.mountErrors, [])
  const invoke = (name, ...args) => f.runtime.invokeOn(script.env, name, args)
  const options = { background: 'transparent' }
  // Mask bounds in PNG are x=70..170, y=50..110. At the two edge samples
  // the pixel centers are 9.5 units from the left and 8.5 from the top.
  const points = [[79, 68], [120, 58], [40, 68], [120, 68], [210, 80]]
  const checkPixels = async (scene, alphas) => {
    const png = renderScenePng(scene, 240, 160, options)
    const ctx = createCanvas(240, 160).getContext('2d')
    ctx.drawImage(await loadImage(png.data), 0, 0)
    assert.deepEqual(points.map(([x, y]) => ctx.getImageData(x, y, 1, 1).data[3]), alphas)
    assert.deepEqual(png.data, renderPaintPng(paintList(f.session), 240, 160, options).data)
  }
  let scene = f.scene()
  const checkDelta = (key, value) => {
    const delta = playSnapshot(f.session, { view: true, sceneRev: scene.revision }).scene
    assert.equal(delta.reset, false)
    assert.deepEqual(delta.changed.map(node => [node.id, node[key]]), [[f.mask.Id, value]], key)
    scene = f.scene()
  }
  for (const [action, argument, field, value, alphas] of [
    ['Horizontal', 60, 'horizontalSoftRange', 60, [121, 255, 0, 255, 255]],
    ['Vertical', 40, 'verticalSoftRange', 40, [121, 120, 0, 255, 255]],
    ['Invert', true, 'reverseMaskArea', true, [134, 135, 0, 0, 255]],
    ['Invert', false, 'reverseMaskArea', false, [121, 120, 0, 255, 255]],
  ]) {
    invoke(action, argument)
    checkDelta(field, value)
    await checkPixels(scene, alphas)
  }

  invoke('Horizontal', 100)
  invoke('Vertical', 100)
  scene = f.scene()
  invoke('TweenRange', 'horizontalSoftRange')
  f.runtime.step(0.5)
  checkDelta('horizontalSoftRange', 60)
  await checkPixels(scene, [121, 255, 0, 255, 255])
  f.runtime.step(0.5)
  checkDelta('horizontalSoftRange', 20)
  await checkPixels(scene, [61, 255, 0, 255, 255])
  invoke('TweenRange', 'verticalSoftRange')
  f.runtime.step(0.5)
  checkDelta('verticalSoftRange', 60)
  await checkPixels(scene, [61, 181, 0, 255, 255])
  f.runtime.step(0.5)
  checkDelta('verticalSoftRange', 20)
  await checkPixels(scene, [61, 90, 0, 197, 255])

  invoke('UseCircle')
  checkDelta('primitive', 'circle')
  assert.equal(f.runtime.logs.some(n => n.level === 'lua-error'), false)
})
