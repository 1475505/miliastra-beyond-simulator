import test from 'node:test'
import assert from 'node:assert/strict'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { Container, Graphics, Matrix } from 'pixi.js'
import { createRuntime } from '../../client/lua-runtime/src/index.js'
import { paintList, playSnapshot } from '../play/session.js'
import { renderPaintPng, renderScenePng } from '../host-png.js'
import { PixiPlayRenderer } from '../play/pixi-renderer.js'

function fixture(t, imageId = 100001, children = []) {
  const runtime = createRuntime({ canvasWidth: 240, canvasHeight: 160 })
  t.after(() => runtime.destroy())
  const root = runtime.addRoot({
    name: 'Root', kind: 'container', active: true, visible: true,
    sizeDeltaX: 240, sizeDeltaY: 160,
    anchorMinX: 0.5, anchorMaxX: 0.5, anchorMinY: 0.5, anchorMaxY: 0.5,
    pivotX: 0.5, pivotY: 0.5,
    children: [{
      name: 'Image', kind: 'image', active: true, visible: true,
      sizeDeltaX: 100, sizeDeltaY: 80,
      anchorMinX: 0.5, anchorMaxX: 0.5, anchorMinY: 0.5, anchorMaxY: 0.5,
      pivotX: 0.5, pivotY: 0.5, imageId, imageColor: 0xffffffff, children,
    }],
  })
  const control = root.GetChild('Image')
  const session = { runtime, compiled: { canvasId: 'pc-16-9', platform: 'PC' }, history: [] }
  const script = runtime.mountScript({ path: 'fill-test', control: root, source: `
local image = script.object:GetChild('Image')
function FillHorizontal(direction, amount)
  image:SetFillHorizontal(Enum.ImageFillHorizontalType[direction], amount)
  assert(image.fillHorizontalType == Enum.ImageFillHorizontalType[direction])
end
function FillVertical(direction, amount)
  image:SetFillVertical(Enum.ImageFillVerticalType[direction], amount)
  assert(image.fillVerticalType == Enum.ImageFillVerticalType[direction])
end
function Unused() image:SetFillUnused() end
function DirectFields()
  image.fillType = Enum.ImageFillType.Vertical
  image.fillVerticalType = Enum.ImageFillVerticalType.Bottom
  image.fillAmount = 0.5
end
` })
  assert.deepEqual(runtime.mountErrors, [])
  const setFill = (axis, direction, amount) => runtime.invokeOn(script.env, 'Fill' + axis, [direction, amount])
  const invoke = name => runtime.invokeOn(script.env, name, [])
  const scene = options => playSnapshot(session, { view: true, ...options }).scene
  const node = () => scene().nodes.find(item => item.name === 'Image')
  return { runtime, root, control, session, setFill, invoke, scene, node }
}

async function pixels(png) {
  const canvas = createCanvas(240, 160)
  const context = canvas.getContext('2d')
  context.drawImage(await loadImage(png.data), 0, 0)
  const data = context.getImageData(0, 0, 240, 160).data
  return (x, y) => Array.from(data.slice((y * 240 + x) * 4, (y * 240 + x) * 4 + 4))
}

const isWhite = rgba => rgba[0] > 245 && rgba[1] > 245 && rgba[2] > 245
// Independent geometric oracle: the centered 100x80 rectangle spans
// x=70..170 / y=40..120. The points below are strictly inside its four quarters.
// Direction names come from the local API: Left/Right/Top/Bottom starts there.
const quarterPoints = [[95, 60], [145, 60], [95, 100], [145, 100]]
const directions = [
  { axis: 'Horizontal', direction: 'Left', half: [true, false, true, false], rect: [-50, -40, 50, 80] },
  { axis: 'Horizontal', direction: 'Right', half: [false, true, false, true], rect: [0, -40, 50, 80] },
  { axis: 'Vertical', direction: 'Top', half: [true, true, false, false], rect: [-50, -40, 100, 40] },
  { axis: 'Vertical', direction: 'Bottom', half: [false, false, true, true], rect: [-50, 0, 100, 40] },
]
const expectedQuarters = (entry, amount) => amount === 0 ? [false, false, false, false] : amount === 1 ? [true, true, true, true] : entry.half

test('real Lua fill methods and enum assignments project names and invalidate fill-only scene patches', t => {
  const f = fixture(t)
  let previous = f.scene()
  for (const entry of directions) for (const amount of [0, 0.5, 1]) {
    f.setFill(entry.axis, entry.direction, amount)
    const patch = f.scene({ sceneRev: previous.revision })
    assert.equal(patch.reset, false)
    const changed = patch.changed.find(item => item.name === 'Image')
    assert.ok(changed, `${entry.direction} ${amount} must produce an incremental scene update`)
    assert.equal(changed.fillType, entry.axis)
    assert.equal(changed['fill' + entry.axis + 'Type'], entry.direction)
    assert.equal(changed.fillAmount, amount)
    assert.equal(f.control['fill' + entry.axis + 'Type'].Name, entry.direction)
    const paint = paintList(f.session).find(item => item.name === 'Image')
    assert.equal(paint.fillType, changed.fillType)
    assert.equal(paint['fill' + entry.axis + 'Type'], entry.direction)
    assert.equal(paint.fillAmount, amount)
    previous = f.scene()
  }
  f.invoke('DirectFields')
  assert.equal(f.control.fillType.Name, 'Vertical')
  assert.equal(f.node().fillType, 'Vertical')
  assert.equal(f.node().fillVerticalType, 'Bottom')
  f.invoke('Unused')
  assert.equal(f.node().fillType, 'Unused')
  assert.equal(f.runtime.logs.filter(item => item.level === 'error').length, 0)
})

test('PNG horizontal and vertical fill obey independent quarter pixels for 0, half and full progress', async t => {
  const f = fixture(t)
  for (const entry of directions) for (const amount of [0, 0.5, 1]) {
    f.setFill(entry.axis, entry.direction, amount)
    const png = renderScenePng(f.scene(), 240, 160)
    const at = await pixels(png)
    assert.deepEqual(quarterPoints.map(([x, y]) => isWhite(at(x, y))), expectedQuarters(entry, amount), `${entry.direction} ${amount}`)
    assert.equal(isWhite(at(60, 80)), false, 'fill must not enlarge the source rectangle')
    const flat = renderPaintPng(paintList(f.session), 240, 160)
    assert.deepEqual(png.data, flat.data, 'scene and compact paint must carry the same fill')
  }
  f.setFill('Vertical', 'Top', 0)
  f.invoke('Unused')
  const at = await pixels(renderScenePng(f.scene(), 240, 160))
  assert.deepEqual(quarterPoints.map(([x, y]) => isWhite(at(x, y))), [true, true, true, true], 'Unused cancels clipping even after amount zero')
})

test('Pixi uses image-local masks for all four half fills, hides zero, and removes masks for Unused', t => {
  const f = fixture(t)
  const renderer = Object.create(PixiPlayRenderer.prototype)
  renderer.scratch = new Matrix()
  renderer.canvasHeight = 160
  const root = new Container()
  t.after(() => root.destroy({ children: true }))
  for (const entry of directions) for (const amount of [0, 0.5, 1]) {
    f.setFill(entry.axis, entry.direction, amount)
    renderer.updateNode(root, f.node())
    const graphic = root.__visual.children.at(-1)
    assert.ok(graphic instanceof Graphics)
    assert.equal(graphic.visible, amount !== 0)
    if (amount !== 0) {
      const clip = graphic.mask
      assert.ok(clip instanceof Graphics)
      const bounds = clip.bounds
      assert.deepEqual([bounds.minX, bounds.minY, bounds.width, bounds.height], amount === 1 ? [-50, -40, 100, 80] : entry.rect)
      const actual = quarterPoints.map(([x, y]) => clip.containsPoint({ x: x - 120, y: y - 80 }))
      assert.deepEqual(actual, expectedQuarters(entry, amount))
    }
  }
  f.invoke('Unused')
  renderer.updateNode(root, f.node())
  const graphic = root.__visual.children.at(-1)
  assert.equal(graphic.visible, true)
  assert.equal(graphic.mask, undefined)
  assert.equal(root.__visual.children.length, 1)
})

test('circle fill clips the original circle instead of rescaling its shape', async t => {
  const f = fixture(t, 100002)
  f.setFill('Vertical', 'Top', 0.5)
  const at = await pixels(renderScenePng(f.scene(), 240, 160))
  assert.equal(isWhite(at(120, 50)), true)
  assert.equal(isWhite(at(90, 70)), true, 'original radius survives the crop')
  assert.equal(isWhite(at(120, 100)), false, 'bottom half is cropped')
  assert.equal(isWhite(at(85, 45)), false, 'circle corner stays outside the source shape')
})

test('image-local fill rotates with its parent and does not clip child controls', async t => {
  const f = fixture(t, 100001, [{
    name: 'Child', kind: 'image', active: true, visible: true,
    sizeDeltaX: 12, sizeDeltaY: 12,
    anchorMinX: 0.5, anchorMaxX: 0.5, anchorMinY: 0.5, anchorMaxY: 0.5,
    anchoredPositionX: 20, anchoredPositionY: -20,
    pivotX: 0.5, pivotY: 0.5, imageId: 100001, imageColor: 0xffff0000,
  }])
  f.setFill('Vertical', 'Top', 0.5)
  let at = await pixels(renderScenePng(f.scene(), 240, 160))
  assert.deepEqual(at(140, 100), [255, 0, 0, 255], 'child in the cropped half remains visible')
  f.root.SetLocalRotation(0, 0, 90)
  at = await pixels(renderScenePng(f.scene(), 240, 160))
  assert.equal(isWhite(at(100, 80)), true, 'local top turns to stage left after a 90-degree rotation')
  assert.equal(isWhite(at(140, 80)), false)
})
