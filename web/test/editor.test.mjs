import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createWebServer } from '../server.js'

test('editor isolates tabs, preserves sessions on reload, and protects disk saves from stale writers', async t => {
  const workspace = mkdtempSync(join(tmpdir(), 'qxqy-editor-'))
  const app = await createWebServer({ workspace, port: 0 })
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
  assert.match((await call('b', 'save', { path: saved.value.path, expectedRevision: b.version })).error, /File changed/)
  assert.match((await call('a', 'save', { path: '../outside.json', expectedRevision: a.version })).error, /workspace/)
  assert.match((await call('a', 'save', { path: 'other.json', expectedRevision: -1 })).error, /revision conflict/)
  writeFileSync(path, readFileSync(path, 'utf8') + ' ')
  assert.match((await call('a', 'save', { path: saved.value.path, expectedRevision: a.version })).error, /File changed/)
  const started = await call('a', 'play', { action: 'start', args: { view: true } })
  assert.equal(started.value.scene.format, 'tree-v1')
  assert.equal((await call('a', 'play', { action: 'pause' })).value.paused, true)
  await call('a', 'get')
  assert.equal((await call('a', 'play', { action: 'get' })).value.paused, true)
  for (const route of ['/editor', '/editor.js', '/editor.css', '/editor/play', '/editor/play.js', '/editor/play.css', '/editor/play-renderer.js']) {
    const response = await fetch(app.url + route)
    assert.equal(response.status, 200, route)
    assert.ok((await response.text()).length > 50, route)
  }
})
