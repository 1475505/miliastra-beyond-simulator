import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SimulatorController } from 'qxqy-studio/host/controller'
import { createWebServer } from '../server.js'

async function fixture(t, options = {}) {
  const workspace = mkdtempSync(join(tmpdir(), 'qxqy-preview-state-'))
  const controller = new SimulatorController(workspace)
  const app = await createWebServer({ workspace, port: 0, watchIntervalMs: 60000, ...options })
  t.after(async () => { await app.close(); await controller.dispose(); rmSync(workspace, { recursive: true, force: true }) })
  return { workspace, controller, app }
}

test('a missing initial file leaves diagnostics available and retries that exact file', async t => {
  const { controller, app } = await fixture(t, { initialPath: 'wanted.json' })
  const status = (await (await fetch(app.url + '/api/preview')).json()).value
  assert.equal(status.service, 'beyond-simulator-web')
  assert.match(status.version, /^\d+\.\d+\.\d+/)
  assert.equal(status.activePath, '')
  assert.match(status.lastError, /wanted.json/)
  controller.saveArchive('unrelated.json')
  await app.session.refreshFromDisk()
  assert.equal(app.session.activePath, '')
  controller.saveArchive('wanted.json')
  await app.session.refreshFromDisk()
  assert.equal(app.session.activePath, 'wanted.json')
  assert.equal(app.session.lastError, '')
})

test('invalid disk updates report a persistent error and recover without switching files', async t => {
  const { workspace, controller, app } = await fixture(t)
  controller.saveArchive('current.json')
  await app.session.open('current.json')
  writeFileSync(join(workspace, 'current.json'), '{broken')
  assert.equal(await app.session.refreshFromDisk(), false)
  assert.ok(app.session.lastError)
  assert.equal(app.session.activePath, 'current.json')
  controller.patch({ op: 'renameSave', name: 'Recovered file' })
  controller.saveArchive('current.json')
  await app.session.refreshFromDisk()
  assert.equal(app.session.lastError, '')
  assert.equal(app.session.state().snapshot.save.name, 'Recovered file')
})

test('a queued disk refresh cannot undo an explicit preview switch', async t => {
  const { controller, app } = await fixture(t)
  controller.saveArchive('a.json')
  controller.saveArchive('b.json')
  await app.session.open('a.json')
  controller.patch({ op: 'renameSave', name: 'Updated A on disk' })
  controller.saveArchive('a.json')
  let unlock
  const blocker = app.session.controller.exclusive(() => new Promise(resolve => { unlock = resolve }))
  await new Promise(resolve => setImmediate(resolve))
  const manual = app.session.open('b.json', 'mcp-preview')
  const watcher = app.session.refreshFromDisk()
  unlock()
  await Promise.all([blocker, manual, watcher])
  assert.equal(app.session.activePath, 'b.json')
})

test('restoring an archive with its original size and timestamp clears a previous load error', async t => {
  const { workspace, controller, app } = await fixture(t)
  controller.saveArchive('current.json')
  const path = join(workspace, 'current.json')
  const bytes = readFileSync(path)
  utimesSync(path, 1_700_000_000, 1_700_000_000)
  await app.session.open('current.json')
  writeFileSync(path, '{broken')
  await app.session.refreshFromDisk()
  assert.ok(app.session.lastError)
  writeFileSync(path, bytes)
  utimesSync(path, 1_700_000_000, 1_700_000_000)
  assert.equal(await app.session.refreshFromDisk(), true)
  assert.equal(app.session.lastError, '')
})

test('the open API checks the expected workspace before changing preview state', async t => {
  const { workspace, controller, app } = await fixture(t)
  controller.saveArchive('a.json')
  await app.session.open('a.json')
  const response = await fetch(app.url + '/api/open', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path: 'a.json', expectedWorkspace: tmpdir() }),
  })
  assert.equal(response.status, 400)
  assert.match((await response.json()).error, /workspace mismatch/)
  assert.equal(app.session.workspace, workspace)
  assert.equal(app.session.activePath, 'a.json')
})
