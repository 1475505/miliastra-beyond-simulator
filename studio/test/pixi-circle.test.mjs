import test from 'node:test'
import assert from 'node:assert/strict'
import { createCanvas } from '@napi-rs/canvas'
import { Container, DOMAdapter, Matrix, Sprite } from 'pixi.js'
import { createCircleTexture, PixiPlayRenderer } from '../play/pixi-renderer.js'

function harness(t) {
  const previous = DOMAdapter.get()
  DOMAdapter.set({ ...previous, createCanvas })
  const renderer = Object.create(PixiPlayRenderer.prototype)
  renderer.scratch = new Matrix()
  renderer.canvasHeight = 720
  renderer.circleTextures = new Map()
  const root = new Container()
  t.after(() => {
    renderer.clearVisual(root)
    root.destroy({ children: true })
    for (const texture of renderer.circleTextures.values()) texture.destroy(true)
    DOMAdapter.set(previous)
  })
  const item = { id: 1, kind: 'image', primitive: 'circle', imageId: 100002,
    imageColor: 0xff14201d, sourceWidth: 50, sourceHeight: 50,
    matrix: { a: 1, b: 0, c: 0, d: 1, tx: 210, ty: 110 } }
  return { renderer, root, item }
}

test('circle texture is opaque inside the analytic circle and transparent outside it', t => {
  harness(t)
  const texture = createCircleTexture(256)
  t.after(() => texture.destroy(true))
  const { data } = texture.source.resource.getContext('2d').getImageData(0, 0, 256, 256)
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
    const distance = Math.hypot(x + 0.5 - 128, y + 0.5 - 128)
    const alpha = data[(y * 256 + x) * 4 + 3]
    if (distance < 126) assert.equal(alpha, 255)
    if (distance > 130) assert.equal(alpha, 0)
  }
})

test('circle position, radius, tint and alpha animate without replacing its sprite or texture', t => {
  const { renderer, root, item } = harness(t)
  renderer.updateNode(root, item, { nested: true })
  const visual = root.__visual, circle = visual.children[0], texture = circle.texture
  assert.ok(circle instanceof Sprite)
  for (const diameter of [0, 1, 20, 60, 50]) {
    renderer.updateNode(root, { ...item, sourceWidth: diameter, sourceHeight: diameter + 8,
      imageColor: 0x80eadfc8, matrix: { ...item.matrix, tx: 280 } }, { nested: true })
    assert.equal(root.__visual, visual)
    assert.equal(circle.texture, texture)
    assert.equal(circle.width, diameter)
    assert.equal(circle.height, diameter)
    assert.equal(circle.visible, diameter > 0)
    assert.equal(circle.tint, 0xeadfc8)
    assert.equal(circle.alpha, 128 / 255)
    assert.equal(root.x, 280)
    assert.equal(root.y, -110)
  }
  assert.equal(renderer.circleTextures.size, 1)
})

test('circle sprites share textures and removing one does not invalidate another', t => {
  const { renderer, root, item } = harness(t)
  const second = new Container()
  t.after(() => second.destroy({ children: true }))
  renderer.updateNode(root, item)
  renderer.updateNode(second, { ...item, id: 2, sourceWidth: 48, sourceHeight: 48 })
  const circle = second.__visual.children[0]
  assert.equal(root.__visual.children[0].texture, circle.texture)
  renderer.clearVisual(root)
  assert.equal(circle.texture.destroyed, false)
  renderer.updateNode(second, { ...item, id: 2, sourceWidth: 700, sourceHeight: 700 })
  assert.equal(second.__visual.children[0], circle)
  assert.equal(circle.width, 700)
  assert.equal(renderer.circleTextures.size, 2)
  renderer.clearVisual(second)
})
