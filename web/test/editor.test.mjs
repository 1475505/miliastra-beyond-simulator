import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createWebServer } from '../server.js'
import { EditorSessions } from '../lib/editor-sessions.js'

test('editor isolates tabs, preserves sessions on reload, and protects disk saves from stale writers', async t => {
  const workspace = mkdtempSync(join(tmpdir(), 'qxqy-editor-'))
  const app = await createWebServer({ workspace, port: 0, maxSessions: 1 })
  t.after(async () => { await app.close(); rmSync(workspace, { recursive: true, force: true }) })
  const call = async (sessionId, action, body = {}) => {
    const response = await fetch(`${app.url}/editor/api/${action}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId, ...body }),
    })
    return { status: response.status, ...await response.json() }
  }
  let a = (await call('a', 'get')).value
  a = (await call('a', 'patch', { op: { op: 'renameSave', name: 'Editor A', expectedRevision: a.version } })).value
  assert.equal(a.save.name, 'Editor A')
  assert.notEqual((await call('b', 'get')).value.save.name, 'Editor A')
  assert.equal((await call('a', 'get')).value.save.name, 'Editor A')
  const saved = await call('a', 'save', { path: 'nested/demo.save.json', expectedRevision: a.version })
  assert.equal(saved.status, 200)
  const path = join(workspace, saved.value.path)
  assert.equal(JSON.parse(readFileSync(path, 'utf8')).format, 'qxqy-simulator-save')
  const before = readFileSync(path, 'utf8')
  assert.equal((await call('b', 'save', { path: saved.value.path, expectedRevision: (await call('b', 'get')).value.version })).status, 400)
  assert.equal(readFileSync(path, 'utf8'), before)
  const b = (await call('b', 'load-archive', { path: saved.value.path })).value.snapshot
  assert.equal(b.save.name, 'Editor A')
  a = (await call('a', 'patch', { op: { op: 'renameSave', name: 'Editor A2', expectedRevision: a.version } })).value
  assert.equal((await call('a', 'save', { path: saved.value.path, expectedRevision: a.version })).status, 200)
  assert.match((await call('b', 'save', { path: saved.value.path, expectedRevision: b.version })).error, /存档已被外部修改/)
  assert.match((await call('a', 'save', { path: '../outside.json', expectedRevision: a.version })).error, /workspace/)
  assert.match((await call('a', 'save', { path: 'other.json', expectedRevision: -1 })).error, /revision conflict/)
  writeFileSync(path, readFileSync(path, 'utf8') + ' ')
  assert.match((await call('a', 'save', { path: saved.value.path, expectedRevision: a.version })).error, /存档已被外部修改/)
  const started = await call('a', 'play', { action: 'start', args: { view: true } })
  assert.equal(started.value.scene.format, 'tree-v1')
  assert.equal((await call('a', 'play', { action: 'pause' })).value.paused, true)
  await call('a', 'get')
  assert.equal((await call('a', 'play', { action: 'get' })).value.paused, true)
  for (const route of ['/editor', '/editor.js', '/editor.css', '/editor/play', '/editor/play.js', '/editor/play.css', '/editor/play-renderer.js']) {
    const response = await fetch(app.url + route)
    assert.equal(response.status, 200, route)
    assert.ok(response.headers.get('content-security-policy').includes(`frame-ancestors '${route === '/editor/play' ? 'self' : 'none'}'`), route)
    assert.ok((await response.text()).length > 50, route)
  }
})

test('editor parks idle projects beyond the warm budget without losing revisions or live workers', async t => {
  const workspace = mkdtempSync(join(tmpdir(), 'qxqy-editor-budget-'))
  const game = mkdtempSync(join(tmpdir(), 'qxqy-editor-game-'))
  let now = 0
  const sessions = new EditorSessions(workspace, { maxSessions: 2, now: () => now, sessionIdleMs: 1000 })
  t.after(async () => { await sessions.dispose(); rmSync(workspace, { recursive: true, force: true }); rmSync(game, { recursive: true, force: true }) })
  const call = (sessionId, action, body = {}) => sessions.call(action, { sessionId, ...body })
  const expected = new Map()
  for (let i = 0; i < 12; i++) {
    const id = `tab-${i}`
    let snap = await call(id, 'get')
    snap = await call(id, 'patch', { op: { op: 'renameSave', name: `Unsaved ${i}`, expectedRevision: snap.version } })
    expected.set(id, snap)
  }
  assert.equal([...sessions.sessions.values()].filter(row => row.controller).length, 2)
  assert(sessions.sessions.get('tab-0').parked instanceof Buffer)
  for (const [id, snap] of expected) assert.deepEqual(await call(id, 'get'), snap, 'restoration preserves the complete snapshot and revision')
  await call('tab-0', 'play', { action: 'start', args: { clockMode: 'manual' } })
  const playing = sessions.sessions.get('tab-0').controller
  const worker = playing.worker
  let release
  const gate = new Promise(resolve => { release = resolve })
  const busy = sessions.getSession('busy').controller
  const lock = busy.exclusive(() => gate)
  const pending = call('busy', 'get')
  try {
    await Promise.all(Array.from({ length: 12 }, (_, i) => call(`extra-${i}`, 'get')))
    assert.equal(sessions.sessions.get('busy').controller, busy, 'queued requests cannot be parked')
    assert.equal(sessions.sessions.get('tab-0').controller.worker, worker, 'opening tabs cannot stop a live playtest')
  } finally { release(); await lock }
  await pending
  now = 900
  await call('tab-0', 'play', { action: 'get' })
  now = 1100
  await sessions.sweepIdle()
  assert.equal(playing.worker, worker, 'play polling renews the idle lease')
  now = 2101
  await sessions.sweepIdle()
  assert.equal(playing.worker, null, 'abandoned workers are terminated')
  assert.deepEqual(await call('tab-0', 'get'), expected.get('tab-0'))
  const snap = await call('tab-0', 'patch', { op: { op: 'renameSave', name: 'Restored edit', expectedRevision: expected.get('tab-0').version } })
  await call('tab-0', 'save', { path: 'restored.save.json', expectedRevision: snap.version })
  assert.equal(JSON.parse(readFileSync(join(workspace, 'restored.save.json'), 'utf8')).meta.name, 'Restored edit')
  let next = await call('tab-0', 'patch', { op: { op: 'addScript', path: 'scripts/main.lua', source: 'print("restored")', expectedRevision: snap.version } })
  next = await call('tab-0', 'patch', { op: { op: 'setScriptSync', config: { version: 1, workspaceDir: '', clientImportRoot: game, clientSubdir: '' }, expectedRevision: next.version } })
  await call('tab-0', 'save', { path: 'restored.save.json', expectedRevision: next.version })
  const plan = await call('tab-0', 'script-sync', { action: 'preview' })
  await call('other-a', 'get'); await call('other-b', 'get')
  assert.equal(sessions.sessions.get('tab-0').controller, null)
  const applied = await call('tab-0', 'script-sync-apply', { planId: plan.id, scriptIds: plan.rows.map(row => row.id), confirmed: true })
  assert.equal(applied.completed, true, 'saved fingerprints and a pending sync plan survive hibernation')
  assert.equal(readFileSync(join(game, 'scripts/main.lua'), 'utf8'), 'print("restored")')
})
