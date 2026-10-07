import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { Context } from '@deepseek-ai/cordis'
import { ToolRuntime } from '@deepseek-ai/dsh-tools'
import * as plugin from '../lib/index.js'

const routeKeys = [
  'prefix /qxqy-simulator/api',
  'prefix /qxqy-simulator/play',
  'exact /qxqy-simulator/play-renderer.js',
  'prefix /qxqy-assets',
  'prefix /qxqy-audio',
]

async function host(t) {
  const ctx = new Context()
  const routes = new Map()
  // Harness 0.2 register() returns a plain disposer, not a Cordis effect.
  // Keep that distinction: an auto-disposing mock would hide the regression.
  ctx.provide('webServer', {
    register(route) {
      const key = `${route.kind} ${route.path}`
      if (routes.has(key)) throw new Error(`webserver: duplicate ${route.kind} route "${route.path}"`)
      routes.set(key, route)
      return () => { routes.delete(key) }
    },
  })
  ctx.provide('systemPrompt', { tools() {} })
  const toolsOwner = await ctx.plugin(ToolRuntime)
  const tools = ctx.tools
  const server = createServer((request, response) => {
    const path = new URL(request.url, 'http://localhost').pathname
    const route = routes.get(`exact ${path}`) || [...routes.values()]
      .filter(row => row.kind === 'prefix' && (path === row.path || path.startsWith(row.path + '/')))
      .sort((a, b) => b.path.length - a.path.length)[0]
    if (!route) { response.statusCode = 404; response.end(); return }
    Promise.resolve(route.handler(request, response)).catch(error => {
      response.statusCode = 500; response.end(error.message)
    })
  })
  t.after(async () => {
    await ctx.fiber.dispose()
    await new Promise(resolve => { server.close(resolve); server.closeAllConnections() })
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const url = `http://127.0.0.1:${server.address().port}`
  let callId = 0
  return {
    ctx, routes, tools, toolsOwner, url,
    async call(name, args = {}) {
      const result = await tools.execute({
        callId: `lifecycle-${++callId}`, name, arguments: args,
        agent: { id: 'lifecycle-session', session: { header: {} } },
        signal: AbortSignal.timeout(10_000),
      })
      assert.equal(result.isError, false, JSON.stringify(result))
      return result.value
    },
    async post(action, body = {}) {
      const response = await fetch(`${url}/qxqy-simulator/api/${action}`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: 'lifecycle-session', ...body }),
        signal: AbortSignal.timeout(10_000),
      })
      const payload = await response.json()
      assert.equal(response.status, 200, JSON.stringify(payload))
      assert.equal(payload.ok, true, JSON.stringify(payload))
      return payload.value
    },
  }
}

test('one plugin can restart repeatedly without leaking routes or splitting HTTP/tool state', async t => {
  const app = await host(t)
  const owner = await app.ctx.plugin(plugin)
  for (let cycle = 0; cycle < 3; cycle++) {
    assert.deepEqual([...app.routes.keys()], routeKeys)
    assert.equal(app.tools.schemas().filter(tool => tool.name.startsWith('qxqy_')).length, 7)
    const before = await app.post('get')
    assert.equal(before.save.name, '未命名存档')
    await app.call('qxqy_studio_patch', { op: { op: 'renameSave', name: `cycle-${cycle}` } })
    assert.equal((await app.post('get')).save.name, `cycle-${cycle}`)
    await app.post('patch', { op: { op: 'renameSave', name: `http-${cycle}` } })
    assert.equal((await app.call('qxqy_studio_get')).save.name, `http-${cycle}`)
    await owner.restart()
  }
  await owner.dispose()
  assert.equal(app.routes.size, 0)
  assert.equal(app.tools.schemas().filter(tool => tool.name.startsWith('qxqy_')).length, 0)
  for (const path of ['/qxqy-simulator/api/health', '/qxqy-simulator/play', '/qxqy-simulator/play-renderer.js', '/qxqy-assets', '/qxqy-audio']) {
    assert.equal((await fetch(app.url + path)).status, 404, path)
  }
  await app.ctx.plugin(plugin)
  assert.deepEqual(await app.post('health'), { status: 'ok' })
})

test('a late route collision rolls back this activation and preserves the existing owner', async t => {
  const app = await host(t)
  const other = { kind: 'prefix', path: '/qxqy-audio', handler() {} }
  const removeOther = app.ctx.webServer.register(other)
  const failed = app.ctx.plugin(plugin)
  await assert.rejects(failed.await(), /duplicate prefix route "\/qxqy-audio"/)
  assert.deepEqual([...app.routes.values()], [other])
  assert.equal(app.tools.schemas().filter(tool => tool.name.startsWith('qxqy_')).length, 0)
  await failed.dispose()
  removeOther()
  await app.ctx.plugin(plugin)
  assert.deepEqual(await app.post('health'), { status: 'ok' })
})

test('a tools service reload reactivates the plugin against the same web server', async t => {
  const app = await host(t)
  const owner = await app.ctx.plugin(plugin)
  await app.post('patch', { op: { op: 'renameSave', name: 'old activation' } })
  await app.toolsOwner.restart()
  await owner.await()
  assert.deepEqual([...app.routes.keys()], routeKeys)
  const result = await app.ctx.tools.execute({
    callId: 'after-tools-reload', name: 'qxqy_studio_get', arguments: {},
    agent: { id: 'lifecycle-session', session: { header: {} } },
    signal: AbortSignal.timeout(5_000),
  })
  assert.equal(result.isError, false)
  assert.equal(result.value.save.name, '未命名存档')
  assert.equal((await app.post('get')).save.name, result.value.save.name)
})

test('unloading the plugin waits for its play Worker to exit', async t => {
  const app = await host(t)
  let worker
  t.mock.method(plugin.SimulatorController.prototype, 'createWorker', function () {
    worker = Object.getPrototypeOf(plugin.SimulatorController.prototype).createWorker.call(this)
    return worker
  })
  const owner = await app.ctx.plugin(plugin)
  assert.equal((await app.call('qxqy_studio_play', { action: 'start' })).running, true)
  assert.ok(worker.threadId > 0)
  let exited = false
  const stopped = once(worker, 'exit').then(() => { exited = true })
  try {
    await owner.dispose()
    assert.equal(exited, true, 'plugin disposal must await Worker termination')
    assert.equal(app.routes.size, 0)
  } finally { await stopped }
})

test('a request waiting on workspace lookup cannot resurrect an unloaded session', async t => {
  const app = await host(t)
  const entered = Promise.withResolvers()
  const lookup = Promise.withResolvers()
  app.ctx.provide('sessionPersistence', {
    inspect() { entered.resolve(); return lookup.promise },
  })
  let workerStarted = false
  t.mock.method(plugin.SimulatorController.prototype, 'createWorker', () => {
    workerStarted = true
    throw new Error('unexpected Worker start after unload')
  })
  const owner = await app.ctx.plugin(plugin)
  const pending = fetch(`${app.url}/qxqy-simulator/api/play`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: 'late-request', action: 'start' }),
    signal: AbortSignal.timeout(10_000),
  })
  try {
    await entered.promise
    await owner.dispose()
  } finally { lookup.resolve({ meta: {} }) }
  const response = await pending
  assert.equal(response.status, 400)
  assert.match((await response.json()).error, /plugin has been disposed/)
  assert.equal(workerStarted, false)
  await app.ctx.plugin(plugin)
  assert.equal((await app.post('get')).save.name, '未命名存档')
})
