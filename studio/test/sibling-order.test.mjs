import test from 'node:test'
import assert from 'node:assert/strict'
import { createRuntime } from '../../client/lua-runtime/src/index.js'
import { paintList, hitPlayControl, playSnapshot } from '../play/session.js'
import { flattenScenePaint } from '../host-png.js'

// Independent expectations: editor lists are front-to-back; official Lua
// rev223 puts First at the bottom and Last / the largest sibling index on top.
function fixture(t) {
  const runtime = createRuntime({ canvasWidth: 200, canvasHeight: 200 })
  t.after(() => runtime.destroy())
  const shape = (name, kind, children = []) => ({
    name, kind, active: true, visible: true, sizeDeltaX: 180, sizeDeltaY: 180,
    anchorMinX: 0.5, anchorMaxX: 0.5, anchorMinY: 0.5, anchorMaxY: 0.5,
    pivotX: 0.5, pivotY: 0.5, imageId: 100001, imageColor: 0xffffffff,
    raycastTarget: kind === 'cursor', children,
  })
  const group = (name) => shape(name, 'container', [shape(name + 'Image', 'image'), shape(name + 'Hit', 'cursor')])
  const root = runtime.addRoot(shape('Root', 'container', [group('Front'), group('Middle'), group('Back')]))
  const session = { runtime, compiled: { canvasId: 'pc-16-9', platform: 'PC' }, history: [] }
  const controls = Object.fromEntries(root.children.map(c => [c.name, c]))
  const assertTop = (name) => {
    assert.equal(paintList(session).at(-1).name, name + 'Image')
    assert.equal(hitPlayControl(session, 100, 100).name, name + 'Hit')
    assert.equal(flattenScenePaint(playSnapshot(session, { view: true }).scene).at(-1).name, name + 'Image')
  }
  return { runtime, root, session, ...controls, assertTop }
}

test('unchanged editor list stays first-on-top, while Lua reports the largest top index', t => {
  const { root, Front, Middle, Back, assertTop } = fixture(t)
  assert.deepEqual(root.GetChildren().map(c => c.name), ['Front', 'Middle', 'Back'])
  assert.deepEqual([Front, Middle, Back].map(c => c.GetSiblingIndex()), [2, 1, 0])
  assertTop('Front')
})

test('Lua First lowers and Last raises an entire subtree for painting and pointer hits', t => {
  const { runtime, root, Front, Back, assertTop } = fixture(t)
  runtime.mountScript({ path: 'layer-test', control: root, source: `
function OnStart()
  local front = script.object:GetChild('Front')
  assert(front:SetAsFirstSibling())
  assert(front:GetSiblingIndex() == 0)
end` })
  assert.equal(runtime.mountErrors.length, 0)
  assertTop('Middle')
  assert.equal(Back.SetAsLastSibling(), true)
  assert.equal(Back.GetSiblingIndex(), 2)
  assertTop('Back')
  assert.equal(Front.SetSiblingIndex(2), true)
  assertTop('Front')
})

test('explicit intermediate sibling indices reorder only siblings and invalidate scene patches', t => {
  const { root, session, Front, Back, assertTop } = fixture(t)
  const initial = playSnapshot(session, { view: true }).scene
  assert.equal(Back.SetSiblingIndex(1), true)
  assert.deepEqual(root.GetChildren().map(c => c.name), ['Front', 'Back', 'Middle'])
  assertTop('Front')
  const base = playSnapshot(session, { view: true }).scene
  Front.SetAsFirstSibling()
  const patch = playSnapshot(session, { view: true, sceneRev: base.revision }).scene
  assert.equal(patch.reset, false)
  const nodes = new Map(base.nodes.map(node => [node.id, node]))
  for (const id of patch.removed) nodes.delete(id)
  for (const node of patch.changed) nodes.set(node.id, node)
  assert.equal(flattenScenePaint({ nodes: [...nodes.values()] }).at(-1).name, 'BackImage')
  assertTop('Back')
  assert.ok(initial.nodes.length > 0)
})

test('out-of-range and non-integer sibling values do not change the tree', t => {
  const { root, Front } = fixture(t)
  const initial = root.GetChildren()
  for (const value of [-1, 3, 0.5, NaN, Infinity]) assert.equal(Front.SetSiblingIndex(value), false)
  assert.deepEqual(root.GetChildren(), initial)
})
