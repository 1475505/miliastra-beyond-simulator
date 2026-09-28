import test from 'node:test'
import assert from 'node:assert/strict'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { Container } from 'pixi.js'
import { createRuntime } from '../../client/lua-runtime/src/index.js'
import { paintList, hitPlayControl, playSnapshot, injectPlayPointer } from '../play/session.js'
import { flattenScenePaint, renderScenePng } from '../host-png.js'
import { PixiPlayRenderer } from '../play/pixi-renderer.js'

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

// 2026-09-28 accepted compatibility rule: each newly instantiated root is
// above existing siblings. Expected colors/indices are fixed here; they are
// not inferred from the old simulator or from unreadable device screenshots.
function dynamicFixture(t, { reverse = false, deferred = false, kind = 'image' } = {}) {
  const runtime = createRuntime({ canvasWidth: 320, canvasHeight: 200 })
  t.after(() => runtime.destroy())
  const rect = (name, controlKind, children = []) => ({
    name, kind: controlKind, active: true, visible: true,
    sizeDeltaX: 160, sizeDeltaY: 100,
    anchorMinX: 0.5, anchorMaxX: 0.5, anchorMinY: 0.5, anchorMaxY: 0.5,
    pivotX: 0.5, pivotY: 0.5, children,
  })
  const root = runtime.addRoot({ ...rect('Root', 'container'), sizeDeltaX: 320, sizeDeltaY: 200, showCursor: true })
  runtime.registerTemplate(30001, {
    ...rect('Token', kind, kind === 'image' ? [] : [{ ...rect('Visual', 'image'), imageId: 100001, imageColor: 0xffffffff }]),
    imageId: 100001, imageColor: 0xffffffff, raycastTarget: true, interactable: true,
  })
  const session = { runtime, compiled: { canvasId: 'pc-16-9', platform: 'PC' }, history: [] }
  const first = reverse ? 'B' : 'A', second = reverse ? 'A' : 'B'
  runtime.mountScript({ path: 'dynamic-layers', control: root, source: `
local function spawn(name)
  local c = game.InstantiateClientUIControl(30001, script.object)
  c.name = name
  c.anchoredPositionX = name == "A" and -40 or 40
  local image = ${kind === 'image' ? 'c' : 'c:GetChild("Visual")'}
  image:SetImage(Enum.ImageSource.StaticReference, 100001)
  image.imageColor = name == "A" and Color.FromRGBA(240, 65, 65, 255) or Color.FromRGBA(45, 215, 105, 255)
  ${kind === 'button' || kind === 'cursor' ? `c:AddCursorEventListener(Enum.CursorEventType.CursorClick, function() print("clicked", c.name) end)` : ''}
end
function OnStart()
  spawn("${first}")
  ${deferred ? 'script:EnableUpdate(true)' : `spawn("${second}")`}
end
function OnUpdate()
  script:EnableUpdate(false)
  spawn("${second}")
end` })
  assert.deepEqual(runtime.mountErrors, [])
  return { runtime, root, session }
}

async function assertPixels(scene, middle) {
  const canvas = createCanvas(320, 200)
  const context = canvas.getContext('2d')
  context.drawImage(await loadImage(renderScenePng(scene, 320, 200).data), 0, 0)
  const colors = { A: [240, 65, 65, 255], B: [45, 215, 105, 255] }
  // A: x=40..200; B: x=120..280. All samples are away from edges.
  for (const [x, who] of [[80, 'A'], [160, middle], [240, 'B']]) {
    assert.deepEqual([...context.getImageData(x, 100, 1, 1).data], colors[who], `pixel x=${x}`)
  }
}

function applyScenePatch(base, patch) {
  assert.equal(patch.reset, false)
  const nodes = new Map(base.nodes.map(node => [node.id, node]))
  for (const id of patch.removed) nodes.delete(id)
  for (const node of patch.changed) nodes.set(node.id, node)
  return { nodes: [...nodes.values()] }
}

for (const reverse of [false, true]) {
  test(`Lua Instantiate paints the later ${reverse ? 'A' : 'B'} on top while keeping both exclusive regions visible`, async t => {
    const { root, session } = dynamicFixture(t, { reverse })
    const first = reverse ? 'B' : 'A', last = reverse ? 'A' : 'B'
    const scene = playSnapshot(session, { view: true }).scene
    await assertPixels(scene, last)
    assert.deepEqual([root.GetChild(first).GetSiblingIndex(), root.GetChild(last).GetSiblingIndex()], [0, 1])
    assert.deepEqual(paintList(session).map(c => c.name), [first, last])
    assert.deepEqual(flattenScenePaint(scene).map(c => c.name), [first, last])
  })
}

test('instantiating after a scene snapshot updates existing siblings in incremental PNG and Pixi order', async t => {
  const { runtime, root, session } = dynamicFixture(t, { deferred: true })
  const base = playSnapshot(session, { view: true }).scene
  runtime.step(1 / 60)
  const patch = playSnapshot(session, { view: true, sceneRev: base.revision }).scene
  const merged = applyScenePatch(base, patch)
  const aId = root.GetChild('A').Id, bId = root.GetChild('B').Id
  assert.equal(patch.changed.find(c => c.id === aId)?.z, 1, 'old sibling must move behind the inserted instance')
  assert.equal(patch.changed.find(c => c.id === bId)?.z, 0)
  await assertPixels(merged, 'B')
  assert.deepEqual(flattenScenePaint(merged).map(c => c.name), ['A', 'B'])

  // Real Pixi containers with the production attach adapter; no GPU assumption.
  const stage = new Container()
  t.after(() => stage.destroy({ children: true }))
  const renderer = Object.create(PixiPlayRenderer.prototype)
  renderer.app = { stage }
  renderer.nodes = new Map()
  const attach = nodes => {
    for (const node of nodes) if (!renderer.nodes.has(node.id)) renderer.nodes.set(node.id, new Container())
    for (const node of nodes) renderer.attachNode(renderer.nodes.get(node.id), node)
  }
  attach(base.nodes)
  attach(patch.changed)
  const parent = renderer.nodes.get(root.Id)
  parent.sortChildren()
  assert.deepEqual(parent.children, [renderer.nodes.get(aId), renderer.nodes.get(bId)])
})

test('First, Last and numeric indices override dynamic creation order and reach incremental scenes', async t => {
  const { runtime, root, session } = dynamicFixture(t)
  const a = root.GetChild('A'), b = root.GetChild('B')
  let scene = playSnapshot(session, { view: true }).scene
  runtime.mountScript({ path: 'move-dynamic-layers', control: root, source: `
local step = 0
function OnStart() script:EnableUpdate(true) end
function OnUpdate()
  step = step + 1
  local a = script.object:GetChild("A")
  local b = script.object:GetChild("B")
  if step == 1 then assert(b:SetAsFirstSibling())
  elseif step == 2 then assert(b:SetAsLastSibling())
  else assert(a:SetSiblingIndex(1)); script:EnableUpdate(false) end
end` })
  assert.deepEqual(runtime.mountErrors, [])
  for (const [top, indices] of [['A', [1, 0]], ['B', [0, 1]], ['A', [1, 0]]]) {
    runtime.step(1 / 60)
    const patch = playSnapshot(session, { view: true, sceneRev: scene.revision }).scene
    scene = { ...applyScenePatch(scene, patch), revision: patch.revision }
    assert.deepEqual([a.GetSiblingIndex(), b.GetSiblingIndex()], indices)
    await assertPixels(scene, top)
  }
})

for (const kind of ['button', 'cursor']) {
  test(`dynamic ${kind} pointer arbitration follows the top sibling and skips a disabled raycast`, async t => {
    const { runtime, root, session } = dynamicFixture(t, { kind })
    const a = root.GetChild('A'), b = root.GetChild('B')
    assert.equal(hitPlayControl(session, 80, 100)?.Id, a.Id)
    assert.equal(hitPlayControl(session, 160, 100)?.Id, b.Id)
    assert.equal(hitPlayControl(session, 240, 100)?.Id, b.Id)
    injectPlayPointer(session, 'click', 160, 100)
    assert.equal(runtime.logs.at(-1).text, 'clicked\tB')
    b.raycastTarget = false
    assert.equal(hitPlayControl(session, 160, 100)?.Id, a.Id)
    injectPlayPointer(session, 'click', 160, 100)
    assert.equal(runtime.logs.at(-1).text, 'clicked\tA')
    await assertPixels(playSnapshot(session, { view: true }).scene, 'B')
  })
}

test('a later image within a lower instantiated group cannot escape its parent paint order', t => {
  const { runtime, root, session } = dynamicFixture(t, { kind: 'container' })
  const a = root.GetChild('A'), b = root.GetChild('B')
  runtime.registerTemplate(30002, {
    name: 'LateImage', kind: 'image', active: true, visible: true,
    sizeDeltaX: 160, sizeDeltaY: 100, imageId: 100001, imageColor: 0xff0000ff,
  })
  runtime.mountScript({ path: 'late-child', control: root, source: `
function OnStart()
  game.InstantiateClientUIControl(30002, script.object:GetChild("A"))
end` })
  assert.deepEqual(runtime.mountErrors, [])
  const paint = paintList(session)
  assert.ok(paint.findIndex(c => c.name === 'LateImage') < paint.findIndex(c => c.id === b.GetChild('Visual').Id))
  assert.equal(paint.at(-1).id, b.GetChild('Visual').Id)
  assert.equal(a.GetSiblingIndex(), 0)
})
