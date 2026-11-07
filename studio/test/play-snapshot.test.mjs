import test from 'node:test'
import assert from 'node:assert/strict'
import { createRuntime } from '../../client/lua-runtime/src/index.js'
import { createServer } from '../../server/index.js'
import { SimulatorController } from '../host/controller.js'
import { playSnapshot } from '../play/session.js'

function fixture(t, count = 2) {
  const runtime = createRuntime({ canvasWidth: 200, canvasHeight: 200 })
  t.after(() => runtime.destroy())
  const root = runtime.addRoot({ name: 'Root', kind: 'container', active: true, sizeDeltaX: 200, sizeDeltaY: 200,
    children: Array.from({ length: count }, (_, i) => ({ name: `Image${i}`, kind: 'image', active: true, imageId: 100001,
      sizeDeltaX: 20, sizeDeltaY: 20, imageColor: 0xffffffff })) })
  const session = { runtime, compiled: { canvasId: 'pc-16-9', platform: 'PC' } }
  const scene = sceneRev => playSnapshot(session, { view: true, compact: true, sceneRev }).scene
  return { runtime, root, session, scene }
}

test('independent scene viewers merge changes, removals and hidden restoration without advancing idle revisions', t => {
  const { runtime, root, scene } = fixture(t)
  const [a, b] = root.children
  const first = scene()
  assert.equal(first.reset, true)
  for (let i = 0; i < 3; i++) {
    assert.deepEqual(scene(first.revision), { format: 'tree-v1', revision: first.revision, count: 3, reset: false, changed: [], removed: [] })
    assert.equal(scene().revision, first.revision, 'a full read must not invalidate another viewer')
  }
  a.SetAnchoredPosition(10, 0)
  const fast = scene(first.revision)
  assert.equal(fast.reset, false)
  assert.deepEqual(fast.changed.map(n => [n.id, n.matrix.tx]), [[a.Id, 10]])
  a.SetAnchoredPosition(20, 0)
  b.SetVisible(false)
  const hidden = scene(fast.revision)
  assert.deepEqual(hidden.removed, [b.Id])
  b.SetVisible(true)
  const restored = scene(hidden.revision)
  assert.deepEqual(restored.changed.map(n => n.id), [b.Id])
  runtime.destroyControl(a)
  scene(restored.revision)
  const slow = scene(first.revision)
  assert.equal(slow.reset, false)
  assert.deepEqual(slow.removed, [a.Id])
  assert.equal(slow.changed.filter(n => n.id === b.Id).length, 1)
  const merged = new Map(first.nodes.map(n => [n.id, n]))
  for (const id of slow.removed) merged.delete(id)
  for (const node of slow.changed) merged.set(node.id, node)
  const sorted = nodes => [...nodes].sort((a, b) => a.id - b.id)
  assert.deepEqual(sorted(merged.values()), sorted(scene().nodes))

  const full = scene()
  full.nodes[0].matrix.tx = 999
  slow.changed[0].matrix.tx = 999
  assert.equal(scene().nodes.some(n => n.matrix.tx === 999), false, 'responses cannot mutate the cached scene')
  for (const revision of [0, -1, 0.5, NaN, slow.revision + 1]) assert.equal(scene(revision).reset, true)
  runtime.destroyControl(b)
  const empty = scene(slow.revision)
  assert.equal(empty.count, 0)
  assert.deepEqual(new Set(empty.removed), new Set([root.Id, b.Id]))
  assert.equal(scene(empty.revision).reset, false, 'an empty scene is still a valid delta base')
  assert.deepEqual(scene().nodes, [])
})

test('scene history is bounded by revision count and changed IDs; expired readers get a current reset', t => {
  for (const [count, changes] of [[1, 121], [100, 101]]) {
    const { root, scene } = fixture(t, count)
    const first = scene()
    let latest = first
    for (let i = 1; i <= changes; i++) {
      for (const child of root.children) child.SetAnchoredPosition(i, 0)
      latest = scene(latest.revision)
      assert.equal(latest.reset, false, 'current viewers remain incremental even as old history expires')
    }
    const reset = scene(first.revision)
    assert.equal(reset.reset, true)
    assert.equal(reset.revision, latest.revision)
    assert.equal(reset.count, count + 1)
    assert.ok(reset.nodes.filter(n => n.kind === 'image').every(n => n.matrix.tx === changes))
  }
})

test('player switches and Worker restarts invalidate earlier viewers even when revision numbers match', async t => {
  const controller = new SimulatorController('', { clockMode: 'manual' })
  t.after(() => controller.dispose())
  const get = args => controller.play('get', { view: true, ...args })
  let current = (await controller.play('start', { playerCount: 2, view: true })).scene
  const first = current.revision
  for (const playerIndex of [2, 1]) {
    const next = (await controller.play('view', { playerIndex, view: true, sceneRev: current.revision })).scene
    assert.equal(next.reset, true)
    assert.ok(next.revision > current.revision)
    assert.equal((await get({ sceneRev: first })).scene.reset, true)
    assert.equal((await get({ sceneRev: next.revision })).scene.reset, false)
    current = next
  }
  const previous = await controller.play('start', { view: true })
  const restarted = await controller.play('start', { view: true })
  assert.equal(restarted.scene.revision, previous.scene.revision)
  const stale = await get({ sceneRev: previous.scene.revision, sceneSessionId: previous.audio.sessionId })
  assert.equal(stale.scene.reset, true)
  assert.notEqual(stale.audio.sessionId, previous.audio.sessionId)
  const caughtUp = await get({ sceneRev: stale.scene.revision, sceneSessionId: stale.audio.sessionId })
  assert.equal(caughtUp.scene.reset, false)
  assert.deepEqual(caughtUp.scene.changed, [])
})

test('compact play snapshots copy only history tails and leave full history available', t => {
  const { runtime, session } = fixture(t, 0)
  const server = session.server = createServer()
  t.after(() => server.destroy())
  session.history = { events: [] }
  let oldCopies = 0
  const oldValue = { toJSON() { oldCopies++; return [7] } }
  for (let i = 0; i < 105; i++) {
    const params = [{ type: 'IntList', value: i < 5 ? oldValue : [i] }]
    server.receiveFromClient(`in-${i}`, params)
    server.sendToClient(`out-${i}`, params)
    server.log('info', `log-${i}`)
    runtime.log('info', `client-${i}`)
    session.history.events.push({ t: i, kind: 'key', payload: { key: 'KeyboardJumpKeyDown' } })
  }
  oldCopies = 0
  const compact = playSnapshot(session, { compact: true })
  assert.equal(oldCopies, 0, 'discarded history must not be copied before slicing')
  for (const rows of [compact.server.inbound, compact.server.outbound, compact.server.logs, compact.logs, compact.history]) assert.equal(rows.length, 100)
  assert.equal(compact.server.inbound[0].name, 'in-5')
  assert.equal(compact.server.outbound.at(-1).name, 'out-104')
  assert.equal(compact.server.logs[0].text, 'log-5')
  assert.equal(compact.logs[0].text, 'client-5')
  assert.equal(compact.history[0].t, 5)
  compact.server.inbound[0].params[0].value[0] = -1
  const full = playSnapshot(session)
  assert.ok(oldCopies > 0)
  assert.equal(full.server.inbound[5].params[0].value[0], 5)
  for (const rows of [full.server.inbound, full.server.outbound, full.server.logs, full.logs, full.history]) assert.equal(rows.length, 105)
  assert.equal(server.snapshot({ historyLimit: 0 }).inbound.length, 0)
})
