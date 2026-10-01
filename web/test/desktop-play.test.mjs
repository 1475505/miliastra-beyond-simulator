import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { build } from 'esbuild'
import { apply } from '../../dsh-plugin/lib/index.js'
import { createStudio } from '../../studio/index.js'

test('Desktop custom protocol supports fallback play under Electron window denial', { skip: !process.env.QXQY_ELECTRON, timeout: 60_000 }, async t => {
  const directory = mkdtempSync(join(tmpdir(), 'qxqy-desktop-play-'))
  const routes = []
  let dispose
  apply({ tools: { register() {} }, webServer: { register(route) { routes.push(route) } }, effect(factory) { dispose = factory() } })
  const fixture = await build({ entryPoints: [fileURLToPath(new URL('./fixtures/harness-client.js', import.meta.url))], bundle: true, write: false, platform: 'browser', format: 'iife' })
  const server = createServer((request, response) => {
    if (request.headers.cookie !== 'test-desktop-auth=1') { response.statusCode = 401; response.end('Test auth required'); return }
    const path = new URL(request.url, 'http://localhost').pathname
    if (path === '/') { response.setHeader('content-type', 'text/html'); response.end('<!doctype html><style>html,body,#app{height:100%;margin:0}</style><div id="app"></div><script src="/fixture.js"></script>'); return }
    if (path === '/fixture.js' || path === '/plugin.js') {
      response.setHeader('content-type', 'text/javascript')
      response.end(path === '/fixture.js' ? fixture.outputFiles[0].contents : readFileSync(new URL('../../dsh-plugin/dist/client.js', import.meta.url)))
      return
    }
    const route = routes.find(route => route.kind === 'exact' ? path === route.path : path === route.path || path.startsWith(route.path + '/'))
    if (route) void route.handler(request, response)
    else { response.statusCode = 404; response.end('Not found') }
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const url = `http://127.0.0.1:${server.address().port}`
  let child
  t.after(async () => {
    if (child && child.exitCode === null && child.signalCode === null) { const exited = once(child, 'close'); child.kill(); await exited }
    dispose?.()
    await new Promise(resolve => server.close(resolve))
    rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  })
  const studio = createStudio()
  studio.patch({ op: 'addScript', path: 'input.lua', controlId: 'n1', source: 'function OnStart()\n script.object:AddKeyEventListener(Enum.KeyEventType.KeyboardCraftspersonKey1Down, function() print("desktop-key") end)\nend' })
  const imported = await (await fetch(url + '/qxqy-simulator/api/import', {
    method: 'POST', headers: { 'content-type': 'application/json', cookie: 'test-desktop-auth=1' },
    body: JSON.stringify({ sessionId: 'desktop-play', format: 'json', filename: 'test.save.json', data: Buffer.from(JSON.stringify(studio.archiveData())).toString('base64') }),
  })).json()
  assert.equal(imported.ok, true)
  const env = { ...process.env, QXQY_TEST_DIRECTORY: directory, QXQY_TEST_HOST: url }
  delete env.ELECTRON_RUN_AS_NODE
  child = spawn(process.env.QXQY_ELECTRON, [fileURLToPath(new URL('./fixtures/desktop-play.cjs', import.meta.url))], { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  let output = ''
  child.stdout.on('data', chunk => { output += chunk })
  child.stderr.on('data', chunk => { output += chunk })
  const [code] = await once(child, 'close', { signal: AbortSignal.timeout(45_000) })
  assert.equal(code, 0, output)
  assert.match(output, /PASS Electron Desktop policy/)
})
