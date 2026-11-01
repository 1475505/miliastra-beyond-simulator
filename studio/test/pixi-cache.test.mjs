import test from 'node:test'
import assert from 'node:assert/strict'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { Container, Matrix, Text } from 'pixi.js'
import { PixiPlayRenderer } from '../play/pixi-renderer.js'
import { renderEditorPng, renderPaintPng } from '../host-png.js'

function harness(t) {
  const renderer = Object.create(PixiPlayRenderer.prototype)
  renderer.scratch = new Matrix()
  renderer.canvasHeight = 720
  const root = new Container()
  t.after(() => root.destroy({ children: true }))
  const item = { id: 1, kind: 'image', primitive: 'rectangle', imageId: 100001,
    imageColor: 0xff14201d, sourceWidth: 50, sourceHeight: 50,
    matrix: { a: 1, b: 0, c: 0, d: 1, tx: 210, ty: 110 } }
  return { renderer, root, item }
}

test('a resized primitive retains its rebuilt visual across subsequent position updates', t => {
  const { renderer, root, item } = harness(t)
  renderer.updateNode(root, item, { nested: true })
  const initial = root.__visual
  const resized = { ...item, sourceWidth: 56, sourceHeight: 56 }
  renderer.updateNode(root, resized, { nested: true })
  const rebuilt = root.__visual
  assert.notEqual(rebuilt, initial)
  assert.equal(initial.destroyed, true)
  for (const tx of [215, 240, 280]) {
    renderer.updateNode(root, { ...resized, matrix: { ...item.matrix, tx } }, { nested: true })
    assert.equal(root.__visual.uid, rebuilt.uid, 'moving the rebuilt image must retain its GPU geometry')
    assert.equal(root.x, tx)
  }
})

test('color and fill changes rebuild once and the same appearance then remains cached', t => {
  const { renderer, root, item } = harness(t)
  renderer.updateNode(root, item)
  let previous = root.__visual
  for (const appearance of [
    { ...item, imageColor: 0xffddddcc },
    { ...item, fillType: 'Vertical', fillVerticalType: 'Top', fillAmount: 0.4 },
    { ...item, primitive: 'rectangle', imageId: 100001 },
  ]) {
    renderer.updateNode(root, appearance)
    const changed = root.__visual
    assert.notEqual(changed, previous)
    assert.equal(previous.destroyed, true)
    renderer.updateNode(root, appearance)
    assert.equal(root.__visual.uid, changed.uid)
    previous = changed
  }
})

test('button placeholder is neutral dark gray in Pixi and editor/play PNG, retaining pressed feedback', async t => {
  const { renderer, root, item } = harness(t)
  const button = { ...item, kind: 'button', sourceWidth: 150, sourceHeight: 50,
    left: 25, bottom: 25, width: 150, height: 50,
    matrix: { a: 1, b: 0, c: 0, d: 1, tx: 100, ty: 50 } }
  renderer.updateNode(root, button)
  const graphic = root.__visual.children[0]
  assert.equal(graphic.context.instructions[0].data.style.color, 0x202020)
  assert.equal(graphic.context.instructions[1].data.style.color, 0x555555)
  renderer.updateNode(root, { ...button, pressed: true })
  assert.equal(root.__visual.children[0].context.instructions.at(-1).data.style.alpha, 0.28)
  const sample = async png => {
    const canvas = createCanvas(200, 100), ctx = canvas.getContext('2d')
    ctx.drawImage(await loadImage(png.data), 0, 0)
    return Array.from(ctx.getImageData(60, 40, 1, 1).data)
  }
  assert.deepEqual(await sample(renderPaintPng([button], 200, 100)), [32, 32, 32, 255])
  assert.deepEqual(await sample(renderEditorPng({ canvas: { width: 200, height: 100 }, boxes: [button] })), [32, 32, 32, 255])
  const pressed = await sample(renderPaintPng([{ ...button, pressed: true }], 200, 100))
  assert.ok(pressed[0] < 32)
  assert.equal(pressed[0], pressed[1])
  assert.equal(pressed[1], pressed[2])
})

test('replacing or removing an image releases its owned shape and mask contexts', t => {
  const { renderer, root, item } = harness(t)
  renderer.updateNode(root, { ...item, fillType: 'Vertical', fillVerticalType: 'Top', fillAmount: 0.4 })
  const contexts = root.__visual.children.map(child => child.context)
  assert.equal(contexts.length, 2, 'fixture includes both the image and its clipping geometry')
  renderer.updateNode(root, { ...item, sourceWidth: 52 })
  for (const context of contexts) assert.equal(context.destroyed, true, 'replaced geometry must not wait for timed GPU garbage collection')
  const remaining = root.__visual.children[0].context
  renderer.clearVisual(root)
  assert.equal(remaining.destroyed, true)
})

test('HUD text, style and scroll-offset updates reuse owned visuals; geometry changes release them', t => {
  const { renderer, root, item } = harness(t)
  const label = { ...item, kind: 'textbox', text: 'Score 1', sourceWidth: 240, sourceHeight: 60,
    fontSize: 24, fontColor: 0xffffffff, bgColor: 0, enableOutline: false,
    horizontalAlignment: 'Left', verticalAlignment: 'Top' }
  renderer.updateNode(root, label)
  const visual = root.__visual, text = visual.children.find(child => child instanceof Text)
  const mask = text.mask, style = text.style
  for (let i = 2; i <= 40; i++) renderer.updateNode(root, { ...label, text: `Score ${i}` })
  assert.equal(root.__visual, visual)
  assert.equal(text.text, 'Score 40')
  assert.equal(text.mask, mask)
  assert.equal(text.style, style)
  renderer.updateNode(root, { ...label, text: 'A\nB', horizontalAlignment: 'Right', verticalAlignment: 'Bottom',
    textLayout: { fontSize: 13, lineHeight: 15.6, lines: ['A', 'B'] }, enableOutline: true, outlineColor: 0x33333333 })
  assert.equal(root.__visual, visual)
  assert.equal(text.style.fontSize, 13)
  assert.equal(text.style.wordWrap, false)
  assert.equal(text.style.stroke.alpha, 0.2)
  assert.deepEqual([text.anchor.x, text.anchor.y, text.x, text.y], [1, 1, 118, 30])
  renderer.updateNode(root, { ...label, sourceWidth: 260 })
  assert.notEqual(root.__visual, visual)
  assert.equal(text.destroyed, true)
  assert.equal(mask.context, null, 'old clipping geometry is released')
  const scroll = { lines: ['A', 'B', 'C', 'D'], lineHeight: 24, textWidth: 236, offset: 0,
    max: 100, contentLength: 160, showBar: false }
  renderer.updateNode(root, { ...label, kind: 'textwindow', scroll })
  const windowVisual = root.__visual, windowText = windowVisual.children.find(child => child instanceof Text)
  renderer.updateNode(root, { ...label, kind: 'textwindow', scroll: { ...scroll, offset: 48 } })
  assert.equal(root.__visual, windowVisual)
  assert.equal(windowText.style.wordWrap, false)
  assert.equal(windowText.y, -54)
  renderer.clearVisual(root)
  assert.equal(windowText.destroyed, true)
})
