import test from 'node:test'
import assert from 'node:assert/strict'
import { Container, Matrix } from 'pixi.js'
import { PixiPlayRenderer } from '../play/pixi-renderer.js'

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
