import { test } from 'node:test'
import assert from 'node:assert/strict'
import { basename, join } from 'node:path'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { SimulatorController, apply, headerWorkspace, jsonParam, lookupSessionWorkspace, sessionWorkspace } from '../lib/index.js'

const testWorkspace = fileURLToPath(new URL('../', import.meta.url)).replace(/[/\\]+$/, '')

// Shared editing, codecs and rendering are tested in Studio. Keep DSH host,
// Worker and registered-tool boundaries here, not a second copy of core tests.
test('persistent play Worker delivers pointer input, server writes and replay history', async t => {
  const controller = new SimulatorController('', { clockMode: 'manual' })
  t.after(() => controller.dispose())
  controller.patch({ op: 'addScript', controlId: 'n1', path: 'worker.lua', source: `
function OnStart()
  script.object:FindChild("预设按钮"):AddCursorEventListener(Enum.CursorEventType.CursorClick, function() print("worker-click") end)
  script:RegisterCustomVariableChangedHandler(Enum.CustomVariableEntityType.Level, "Wave", function(entityType, name)
    print("wave", game.GetGlobalCustomVariableValue(entityType, name))
  end)
end` })
  assert.equal((await controller.play('start')).running, true)
  assert.equal((await controller.play('pause')).paused, true)
  assert.equal((await controller.play('resume')).paused, false)
  await controller.play('pointer', { type: 'down', x: 800, y: 450 })
  const down = await controller.play('get', { inspect: true })
  assert.equal(down.tree[0].children.find(node => node.kind === 'button').pressed, true)
  const up = await controller.play('pointer', { type: 'up', x: 800, y: 450 })
  assert.ok(up.logs.some(entry => entry.text === 'worker-click'))
  const afterSet = await controller.play('serverSet', { entityType: 'Level', name: 'Wave', value: 2 })
  assert.equal(afterSet.server.vars.Level.Wave.value, 2)
  assert.ok(afterSet.logs.some(entry => entry.text === 'wave\t2'))
  assert.ok((await controller.play('history')).events.some(row => row.kind === 'serverSet' && row.payload.name === 'Wave'))
  const report = await controller.play('runCase', { case: {
    name: 'wave-set', events: [{ t: 0, kind: 'serverSet', payload: { entityType: 'Level', name: 'Wave', value: 2 } }],
    asserts: [{ kind: 'var', entityType: 'Level', name: 'Wave', equals: 2 }],
  } })
  assert.equal(report.passed, true)
  assert.equal((await controller.play('stop')).running, false)
})

test('Worker keeps OnUpdate running while Lua level time is paused', async t => {
  const controller = new SimulatorController()
  t.after(() => controller.dispose())
  controller.patch({ op: 'addScript', controlId: 'n1', path: 'level-pause', source: `
function OnStart() script:EnableUpdate(true); game.PauseLevelTime(true) end
function OnUpdate() print("level-pause-update") end
function OnLevelUpdate() print("level-pause-level-update") end` })
  const started = await controller.play('start')
  assert.equal(started.paused, false)
  assert.equal(started.levelTimePaused, true)
  await new Promise(resolve => setTimeout(resolve, 180))
  const after = await controller.play('get')
  assert.ok(after.frame > started.frame)
  const logs = after.logs.map(entry => entry.text)
  assert.ok(logs.includes('level-pause-update'))
  assert.equal(logs.includes('level-pause-level-update'), false)
})

test('plugin registers tools and serves its play page and renderer', t => {
  const tools = [], routes = [], effects = []
  apply({
    tools: { register(tool) { tools.push(tool) } },
    webServer: { register(route) { routes.push(route) } },
    effect(factory) { effects.push(factory()) },
  })
  t.after(() => Promise.all(effects.map(dispose => dispose?.())))
  assert.deepEqual(tools.map(tool => tool.name).sort(), [
    'qxqy_script_sync', 'qxqy_studio_get', 'qxqy_studio_play_screenshot', 'qxqy_studio_ui_screenshot',
    'qxqy_studio_patch', 'qxqy_studio_export', 'qxqy_studio_play', 'qxqy_studio_load',
  ].sort())
  for (const [path, type, file] of [
    ['/qxqy-simulator/play', /text\/html/, '../lib/play.html'],
    ['/qxqy-simulator/play-renderer.js', /text\/javascript/, '../dist/play-renderer.js'],
  ]) {
    const headers = {}
    let body
    const response = { statusCode: 0, setHeader(name, value) { headers[name] = value }, end(value) { body = value } }
    routes.find(route => route.path === path).handler({ method: 'GET', url: path }, response)
    assert.equal(response.statusCode, 200)
    assert.match(headers['content-type'], type)
    assert.equal(body, readFileSync(new URL(file, import.meta.url), 'utf8'))
  }
})

test('Harness AI tools save and copy selected scripts without requiring editor actions', async t => {
  const temp = mkdtempSync(join(tmpdir(), 'qxqy-dsh-sync-'))
  const workspace = join(temp, 'workspace'), target = join(temp, 'default_import_file')
  mkdirSync(join(workspace, 'game'), { recursive: true })
  mkdirSync(join(target, 'game'), { recursive: true })
  writeFileSync(join(target, 'game/main.lua'), '-- original')
  writeFileSync(join(target, 'keep.lua'), '-- untouched')
  const tools = [], effects = []
  apply({ tools: { register(tool) { tools.push(tool) } }, webServer: { register() {} }, effect(factory) { effects.push(factory()) } })
  t.after(async () => { await Promise.all(effects.map(dispose => dispose?.())); rmSync(temp, { recursive: true, force: true }) })
  const exec = { agent: { id: 'script-sync-session', session: { header: { cwd: workspace } } } }
  const call = (name, args = {}, context = exec) => tools.find(tool => tool.name === name).execute(args, context)
  const sync = (action, args) => call('qxqy_script_sync', { action, ...(args === undefined ? {} : { args: JSON.stringify(args) }) })
  let snapshot = await call('qxqy_studio_get')
  for (const path of ['game/main.lua', 'game/unselected.lua']) {
    snapshot = await call('qxqy_studio_patch', { op: JSON.stringify({ op: 'addScript', path, source: '-- updated', expectedRevision: snapshot.version }) })
  }
  snapshot = await sync('configure', { config: { version: 1, workspaceDir: 'game', clientImportRoot: target, clientSubdir: 'game' }, expectedRevision: snapshot.version })
  const saved = await sync('save', { path: 'game.save.json', expectedRevision: snapshot.version })
  assert.equal(JSON.parse(readFileSync(join(workspace, saved.path), 'utf8')).assets.scripts.length, 2)
  const plan = await sync('preview'), main = plan.rows.find(row => row.path === 'game/main.lua')
  assert.equal(readFileSync(main.target, 'utf8'), '-- original')
  await assert.rejects(() => sync('apply', { planId: plan.id, scriptIds: [main.id] }), /确认/)
  const other = { agent: { id: 'another-session', session: { header: { cwd: workspace } } } }
  await assert.rejects(() => call('qxqy_script_sync', { action: 'apply', args: { planId: plan.id, scriptIds: [main.id], confirmed: true } }, other), /确认/)
  const result = await sync('apply', { planId: plan.id, scriptIds: [main.id], confirmed: true })
  assert.equal(result.completed, true, JSON.stringify(result))
  assert.equal(result.results.length, 1)
  assert.equal(readFileSync(main.target, 'utf8'), '-- updated')
  assert.equal(readFileSync(join(result.backupRoot, main.targetRelative), 'utf8'), '-- original')
  assert.equal(existsSync(join(target, 'game/unselected.lua')), false)
  assert.equal(readFileSync(join(target, 'keep.lua'), 'utf8'), '-- untouched')
  assert.deepEqual((await sync('status')).lastResult, result)
  await assert.rejects(() => sync('apply', { planId: plan.id, scriptIds: [main.id], confirmed: true }), /确认/)
})

test('client bundle loads through Harness ModuleLoader and exposes the slot plugin', () => {
  let clientModule
  new Function('window', readFileSync(new URL('../dist/client.js', import.meta.url), 'utf8'))({ __ModuleLoader__: { load: value => { clientModule = value } } })
  const exports = clientModule.factory(name => { assert.equal(name, 'react'); return { createElement() {} } })
  assert.deepEqual(exports.inject, ['slots'])
  assert.equal(typeof exports.apply, 'function')
})

test('host tool runtime is supplied by Harness instead of bundled twice', () => {
  const manifest = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
  assert.equal(manifest.dependencies?.['@deepseek-ai/dsh-tools'], undefined)
  assert.ok(manifest.peerDependencies?.['@deepseek-ai/dsh-tools'])
})

test('sessionWorkspace reads the DSH session header cwd and tolerates missing context', () => {
  const exec = { agent: { id: 'agent-1', session: { header: { cwd: testWorkspace } } } }
  assert.equal(sessionWorkspace(exec), testWorkspace)
  assert.equal(headerWorkspace({ cwd: testWorkspace }), testWorkspace)
  assert.equal(sessionWorkspace({ agent: { id: 'agent-1' } }), '')
  assert.equal(sessionWorkspace(), '')
})

test('lookupSessionWorkspace reads live and cold headers across Harness persistence APIs', async () => {
  assert.equal(await lookupSessionWorkspace('s1', { sessions: { get: () => ({ header: { cwd: testWorkspace } }) } }), testWorkspace)
  const persistence = {
    async stat(id) { assert.equal(id, 's1'); assert.equal(this, persistence); return { header: { cwd: 'E:\\cold-history' } } },
    async inspect() { assert.fail('stat must not read the entire conversation') },
  }
  assert.equal(await lookupSessionWorkspace('s1', { sessionPersistence: persistence }), 'E:\\cold-history')
  assert.equal(await lookupSessionWorkspace('s1', {
    sessions: { get: () => ({ header: { cwd: testWorkspace } }) },
    sessionPersistence: { stat() { assert.fail('live session takes precedence') } },
  }), testWorkspace)
  assert.equal(await lookupSessionWorkspace('s1', { sessionPersistence: { stat: async () => undefined } }), '')
  assert.equal(await lookupSessionWorkspace('s1', { sessionPersistence: { stat: async () => { throw new Error('unreadable') } } }), '')
  assert.equal(await lookupSessionWorkspace('s1', {
    sessions: { get: () => undefined }, sessionPersistence: { inspect: async () => ({ meta: { cwd: 'E:\\from-disk' } }) },
  }), 'E:\\from-disk')
  assert.equal(await lookupSessionWorkspace('s1', { sessionPersistence: { inspect: async () => { throw new Error('missing') } } }), '')
  assert.equal(await lookupSessionWorkspace('s1', {}), '')
})

test('editor HTTP get binds the live session cwd instead of the host startup directory', async t => {
  const routes = [], effects = []
  apply({ tools: { register() {} }, webServer: { register(route) { routes.push(route) } },
    effect(factory) { effects.push(factory()) },
    get(name) { if (name === 'sessions') return { get: () => ({ header: { cwd: testWorkspace } }) } },
  })
  t.after(() => Promise.all(effects.map(dispose => dispose?.())))
  const request = {
    method: 'POST', url: '/qxqy-simulator/api/get',
    on(event, listener) {
      if (event === 'data') queueMicrotask(() => listener(Buffer.from(JSON.stringify({ sessionId: 'sess-http' }))))
      if (event === 'end') queueMicrotask(listener)
      return request
    },
    once() { return request }, destroy() {},
  }
  const payload = await new Promise(resolve => routes.find(route => route.path === '/qxqy-simulator/api').handler(request, {
    statusCode: 0, setHeader() {}, end(value) { resolve(JSON.parse(value)) },
  }))
  assert.equal(payload.ok, true)
  assert.equal(payload.value.workspace.bound, true)
  assert.equal(payload.value.workspace.name, basename(testWorkspace))
  assert.equal(payload.value.workspace.path, testWorkspace)
})

test('jsonParam accepts objects and JSON strings and rejects garbage', () => {
  assert.deepEqual(jsonParam({ a: 1 }), { a: 1 })
  assert.deepEqual(jsonParam('{"a":1}'), { a: 1 })
  for (const input of ['not-json', undefined, null]) assert.equal(jsonParam(input), undefined)
})

test('play device action rebuilds the runtime without changing the editor canvas', async t => {
  const controller = new SimulatorController('', { clockMode: 'manual' })
  t.after(() => controller.dispose())
  const started = await controller.play('start', { canvasId: 'mobile-16-9' })
  assert.equal(started.device, 'Mobile')
  await controller.play('step', { dt: 1 })
  const switched = await controller.play('device', { canvasId: 'pc-21-9' })
  assert.equal(switched.device, 'KeyboardAndMouse')
  assert.equal(switched.canvasWidth, 2100)
  assert.equal(switched.time, 0)
  for (const args of [{ canvasId: 'ipad-13' }, {}]) await assert.rejects(() => controller.play('device', args), /unknown canvas preset/)
  assert.equal(controller.get().canvasId, 'pc-16-9')
  const restarted = await controller.play('start', { canvasId: 'mobile-19.5-9' })
  assert.equal(restarted.canvasId, 'mobile-19.5-9')
})
