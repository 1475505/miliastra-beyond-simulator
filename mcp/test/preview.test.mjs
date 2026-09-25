import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createPreviewClient } from '../lib/preview.js'

function fixture(t) {
  const workspace = realpathSync(mkdtempSync(join(tmpdir(), 'qxqy-preview-')))
  writeFileSync(join(workspace, 'test.save.json'), '{}')
  t.after(() => rmSync(workspace, { recursive: true, force: true }))
  return workspace
}

async function httpServer(t, handler) {
  const server = createServer(handler)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => {
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  })
  return { server, webUrl: `http://127.0.0.1:${server.address().port}` }
}

function json(response, value, status = 200) {
  response.writeHead(status, { 'content-type': 'application/json' })
  response.end(JSON.stringify(value))
}

function state(workspace, overrides = {}) {
  return { service: 'beyond-simulator-web', version: 'test-version', workspace, activePath: '', revision: 1, name: 'Preview test', lastError: '', lastLoadedAt: '', ...overrides }
}

test('preview bridge queries metadata and explicitly opens a file with a workspace guard', async t => {
  const workspace = fixture(t)
  const requests = []
  const password = 'local-test-password'
  const { webUrl } = await httpServer(t, async (request, response) => {
    assert.equal(request.headers.authorization, `Basic ${Buffer.from(`simulator:${password}`).toString('base64')}`)
    requests.push(`${request.method} ${request.url}`)
    if (request.url === '/api/preview') return json(response, { ok: true, value: state(workspace) })
    let body = ''
    for await (const chunk of request) body += chunk
    assert.deepEqual(JSON.parse(body), { path: 'test.save.json', expectedWorkspace: workspace })
    json(response, { ok: true, value: { ...state(workspace, { activePath: 'test.save.json', lastLoadedAt: 'now' }), snapshot: { huge: 'excluded' } } })
  })
  const client = createPreviewClient({ workspace, webUrl, password })
  const status = await client.status()
  assert.equal(status.status, 'connected')
  assert.equal(status.workspace, workspace)
  assert.equal(status.activePath, '')
  const opened = await client.open('./test.save.json')
  assert.equal(opened.status, 'opened')
  assert.equal(opened.activePath, 'test.save.json')
  assert.equal(opened.requestedPath, 'test.save.json')
  assert.equal(opened.name, 'Preview test')
  assert.equal(opened.version, 'test-version')
  assert.equal(opened.url, webUrl)
  assert.equal(opened.snapshot, undefined)
  assert.deepEqual(requests, ['GET /api/preview', 'GET /api/preview', 'POST /api/open'])
})

test('preview bridge rejects a wrong workspace or unrelated service before any mutation', async t => {
  const workspace = fixture(t)
  const otherWorkspace = fixture(t)
  let value = state(otherWorkspace)
  let posts = 0
  const { webUrl } = await httpServer(t, (request, response) => {
    if (request.method === 'POST') posts++
    json(response, { ok: true, value })
  })
  const client = createPreviewClient({ workspace, webUrl })
  await assert.rejects(client.open('test.save.json'), /workspace mismatch/)
  value = state(workspace, { service: 'unrelated-service' })
  await assert.rejects(client.open('test.save.json'), /service mismatch/)
  assert.equal(posts, 0)
})

test('preview workspace comparison respects Windows filesystem case', { skip: process.platform !== 'win32' }, async t => {
  const workspace = fixture(t)
  const { webUrl } = await httpServer(t, (_request, response) => json(response, { ok: true, value: state(workspace.toUpperCase()) }))
  assert.equal((await createPreviewClient({ workspace, webUrl }).status()).status, 'connected')
})

test('preview bridge reports offline, authentication, and old API failures clearly', async t => {
  const workspace = fixture(t)
  let status = 401
  const { server, webUrl } = await httpServer(t, (_request, response) => json(response, { ok: false, error: 'Authentication required' }, status))
  const client = createPreviewClient({ workspace, webUrl })
  await assert.rejects(client.status(), /authentication\/access failed.*401.*QXQY_WEB_PASSWORD/)
  status = 404
  await assert.rejects(client.status(), /update and restart beyond-simulator-web/)
  await new Promise(resolve => server.close(resolve))
  await assert.rejects(client.status(), /Web preview is unavailable/)
})

test('preview bridge does not follow redirects or leak credentials in returned errors', async t => {
  const workspace = fixture(t)
  const password = 'do-not-expose-this-password'
  const encoded = Buffer.from(`simulator:${password}`).toString('base64')
  let redirect = true
  let redirected = false
  const { webUrl } = await httpServer(t, (request, response) => {
    if (request.url === '/other') redirected = true
    if (redirect) {
      response.writeHead(302, { location: '/other' })
      response.end()
    } else {
      json(response, { ok: false, error: `server echoed ${password} Basic ${encoded}` }, 400)
    }
  })
  const client = createPreviewClient({ workspace, webUrl, password })
  await assert.rejects(client.status(), /Web preview is unavailable/)
  assert.equal(redirected, false)
  redirect = false
  await assert.rejects(client.status(), error => {
    assert.match(error.message, /Web preview request failed/)
    assert.ok(!error.message.includes(password))
    assert.ok(!error.message.includes(encoded))
    return true
  })
  await assert.rejects(createPreviewClient({ workspace, webUrl: `http://simulator:${password}@localhost:4173` }).status(), error => {
    assert.match(error.message, /without credentials/)
    assert.ok(!error.message.includes(password))
    return true
  })
})

test('preview bridge deadline covers delayed response bodies', async t => {
  const workspace = fixture(t)
  const { webUrl } = await httpServer(t, (_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.write('{"ok":true,')
  })
  const client = createPreviewClient({ workspace, webUrl, timeoutMs: 200 })
  await assert.rejects(client.status(), /timed out after 200ms/)
})

test('preview bridge supports cancellation before and during a request', async t => {
  const workspace = fixture(t)
  let received
  const requested = new Promise(resolve => { received = resolve })
  const { webUrl } = await httpServer(t, () => received())
  const client = createPreviewClient({ workspace, webUrl })
  const before = new AbortController()
  before.abort()
  await assert.rejects(client.status(before.signal), /request cancelled/)
  const during = new AbortController()
  const pending = client.status(during.signal)
  await requested
  during.abort()
  await assert.rejects(pending, /request cancelled/)
})

test('preview open preserves path boundaries and requires the server to confirm the file', async t => {
  const workspace = fixture(t)
  let requests = 0
  const { webUrl } = await httpServer(t, (_request, response) => {
    requests++
    json(response, { ok: true, value: state(workspace, { activePath: 'another.save.json' }) })
  })
  const client = createPreviewClient({ workspace, webUrl })
  assert.throws(() => client.open('../outside.save.json'), /inside the configured workspace/)
  assert.throws(() => client.open(''), /non-empty workspace-relative path/)
  assert.equal(requests, 0)
  await assert.rejects(client.open('test.save.json'), /did not confirm the requested archive/)
})
