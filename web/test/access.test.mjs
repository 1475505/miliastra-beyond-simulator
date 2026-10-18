import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createWebServer } from '../server.js'
import { cleanGenerated } from '../../scripts/paths.mjs'

test('non-local listener requires a password before creating a session', async t => {
  // Authentication must not depend on a font configured by the person running
  // the tests; local-font privacy is covered by the dedicated font fixture.
  const directory = mkdtempSync(join(tmpdir(), 'qxqy-access-font-'))
  const previousConfig = process.env.QXQY_FONT_CONFIG_PATH
  const previousFont = process.env.QXQY_FONT_PATH
  process.env.QXQY_FONT_CONFIG_PATH = join(directory, 'font.json')
  delete process.env.QXQY_FONT_PATH
  writeFileSync(process.env.QXQY_FONT_CONFIG_PATH, JSON.stringify({ mode: 'system' }))
  t.after(async () => {
    if (previousConfig === undefined) delete process.env.QXQY_FONT_CONFIG_PATH; else process.env.QXQY_FONT_CONFIG_PATH = previousConfig
    if (previousFont === undefined) delete process.env.QXQY_FONT_PATH; else process.env.QXQY_FONT_PATH = previousFont
    await cleanGenerated(directory, tmpdir())
  })
  await assert.rejects(createWebServer({ host: '0.0.0.0', password: '' }), /PASSWORD is required/)
})

test('password covers files and API, while health reveals no workspace information', async t => {
  const workspace = mkdtempSync(join(tmpdir(), 'qxqy-access-'))
  const app = await createWebServer({ workspace, port: 0, password: 'test-secret' })
  t.after(async () => { await app.close(); rmSync(workspace, { recursive: true, force: true }) })
  const authorization = 'Basic ' + Buffer.from('simulator:test-secret').toString('base64')
  for (const path of ['/', '/app.js', '/api/state', '/api/preview', '/api/editor.png', '/editor', '/editor.js', '/editor/play', '/editor/api/get', '/qxqy-audio/mp3-v1/50888.mp3']) assert.equal((await fetch(app.url + path)).status, 401)
  assert.deepEqual(await (await fetch(app.url + '/health')).json(), { status: 'ok' })
  assert.equal((await fetch(app.url + '/api/state', { headers: { authorization } })).status, 200)
  const wrong = 'Basic ' + Buffer.from('simulator:wrong-secret').toString('base64')
  assert.equal((await fetch(app.url, { headers: { authorization: wrong } })).status, 401)
  const post = headers => fetch(app.url + '/api/view', { method: 'POST', headers: { authorization, ...headers }, body: '{}' })
  assert.equal((await post({ 'content-type': 'text/plain' })).status, 415)
  assert.equal((await post({ 'content-type': 'application/json', origin: 'https://other.example' })).status, 403)
  assert.equal((await post({ 'content-type': 'application/json', origin: app.url })).status, 200)
})
