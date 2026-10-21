import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'

const mcpDir = fileURLToPath(new URL('..', import.meta.url))
const entry = join(mcpDir, 'index.js')

function startServer(workspace) {
  const child = spawn(process.execPath, [entry, '--workspace', workspace], {
    cwd: mcpDir,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  })
  let buffer = ''
  const responses = new Map()
  const diagnostics = []
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk) => diagnostics.push(chunk))
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk) => {
    buffer += chunk
    let newline
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline).trim()
      buffer = buffer.slice(newline + 1)
      if (!line) continue
      const message = JSON.parse(line)
      responses.get(message.id)?.resolve(message)
      responses.delete(message.id)
    }
  })
  let id = 0
  return {
    child,
    diagnostics,
    request(method, params = {}) {
      const requestId = ++id
      return new Promise((resolve, reject) => {
        responses.set(requestId, { resolve, reject })
        child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params })}\n`)
      })
    },
    notify(method, params = {}) {
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`)
    },
  }
}

async function stopServer(server) {
  server.child.kill()
  await once(server.child, 'exit')
}

test('MCP script sync saves, previews and applies selected updates with backups and handle isolation', async () => {
  const temp = mkdtempSync(join(tmpdir(), 'qxqy-mcp-sync-'))
  const workspace = join(temp, 'workspace')
  const target = join(temp, 'default_import_file')
  mkdirSync(join(workspace, 'game'), { recursive: true })
  mkdirSync(join(target, 'game'), { recursive: true })
  const original = Buffer.from('-- original\r\n')
  writeFileSync(join(target, 'game/main.lua'), original)
  writeFileSync(join(target, 'keep.lua'), '-- other project')
  writeFileSync(join(workspace, 'game/main.lua'), '-- updated')
  writeFileSync(join(workspace, 'game/module.lua'), '-- module v1')
  writeFileSync(join(workspace, 'game/unregistered.lua'), '-- not in the save')
  const server = startServer(workspace)
  const call = async (name, args = {}) => {
    const response = await server.request('tools/call', { name, arguments: args })
    assert.ok(response.result && !response.result.isError, JSON.stringify(response))
    return response.result.structuredContent
  }
  try {
    await server.request('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'script-sync-test', version: '1' } })
    const listed = await server.request('tools/list')
    const syncTool = listed.result.tools.find(tool => tool.name === 'qxqy_script_sync')
    assert.ok(syncTool.inputSchema.properties.action.enum.includes('save'))
    assert.ok(syncTool.inputSchema.properties.action.enum.includes('apply'))
    const { handle } = await call('qxqy_project_open')
    let snapshot = await call('qxqy_studio_get', { handle })
    for (const [path, source] of [['game/main.lua', '-- updated'], ['game/module.lua', '']]) {
      snapshot = await call('qxqy_studio_patch', { handle, op: { op: 'addScript', path, source, expectedRevision: snapshot.version } })
    }
    const config = { version: 1, workspaceDir: 'game', clientImportRoot: target, clientSubdir: 'game' }
    snapshot = await call('qxqy_script_sync', { handle, action: 'configure', args: { config, expectedRevision: snapshot.version } })
    const saved = await call('qxqy_script_sync', { handle, action: 'save', args: { path: 'game.save.json', expectedRevision: snapshot.version } })
    assert.equal(saved.path, 'game.save.json')
    assert.deepEqual(JSON.parse(readFileSync(join(workspace, saved.path), 'utf8')).scriptSync, config)
    let plan = await call('qxqy_script_sync', { handle, action: 'preview' })
    const main = plan.rows.find(row => row.path === 'game/main.lua')
    const module = plan.rows.find(row => row.path === 'game/module.lua')
    assert.equal(main.status, '覆盖')
    assert.equal(module.status, '新增')
    assert.deepEqual(readFileSync(join(target, 'game/main.lua')), original, 'preview must not copy')
    const refused = await server.request('tools/call', { name: 'qxqy_script_sync', arguments: { handle, action: 'apply', args: { planId: plan.id, scriptIds: [main.id] } } })
    assert.equal(refused.result.isError, true)
    assert.match(refused.result.content[0].text, /确认/)
    const other = await call('qxqy_project_open', { path: saved.path })
    const crossHandle = await server.request('tools/call', { name: 'qxqy_script_sync', arguments: { handle: other.handle, action: 'apply', args: { planId: plan.id, scriptIds: [main.id], confirmed: true } } })
    assert.equal(crossHandle.result.isError, true)
    assert.deepEqual(readFileSync(join(target, 'game/main.lua')), original)
    const copied = await call('qxqy_script_sync', { handle, action: 'apply', args: { planId: plan.id, scriptIds: [main.id], confirmed: true } })
    assert.equal(copied.completed, true, JSON.stringify(copied))
    assert.equal(copied.results.length, 1)
    assert.deepEqual(readFileSync(join(copied.backupRoot, 'game/main.lua')), original)
    assert.equal(readFileSync(join(target, 'game/main.lua'), 'utf8'), '-- updated')
    assert.equal(existsSync(join(target, 'game/module.lua')), false)
    assert.equal(existsSync(join(target, 'game/unregistered.lua')), false)
    assert.equal(readFileSync(join(target, 'keep.lua'), 'utf8'), '-- other project')
    assert.deepEqual((await call('qxqy_script_sync', { handle, action: 'status' })).lastResult, copied)
    const reused = await server.request('tools/call', { name: 'qxqy_script_sync', arguments: { handle, action: 'apply', args: { planId: plan.id, scriptIds: [main.id], confirmed: true } } })
    assert.equal(reused.result.isError, true)
    plan = await call('qxqy_script_sync', { handle, action: 'preview' })
    writeFileSync(join(workspace, 'game/module.lua'), '-- module v2')
    const stale = await server.request('tools/call', { name: 'qxqy_script_sync', arguments: { handle, action: 'apply', args: { planId: plan.id, scriptIds: [module.id], confirmed: true } } })
    assert.equal(stale.result.isError, true)
    assert.match(stale.result.content[0].text, /已变化/)
    assert.equal(existsSync(join(target, 'game/module.lua')), false)
    plan = await call('qxqy_script_sync', { handle, action: 'preview' })
    const added = await call('qxqy_script_sync', { handle, action: 'apply', args: { planId: plan.id, scriptIds: [module.id], confirmed: true } })
    assert.equal(added.completed, true, JSON.stringify(added))
    assert.equal(readFileSync(join(target, 'game/module.lua'), 'utf8'), '-- module v2')
  } finally {
    await stopServer(server)
    rmSync(temp, { recursive: true, force: true })
  }
})

test('MCP handshake exposes simulator tools and supports an edit/save round trip', async () => {
  const workspace = mkdtempSync(join(tmpdir(), 'qxqy-mcp-'))
  const server = startServer(workspace)
  try {
    const initialized = await server.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'test', version: '1' },
    })
    assert.equal(initialized.result.protocolVersion, '2024-11-05')
    assert.equal(initialized.result.serverInfo.name, 'beyond-simulator-mcp')
    assert.match(initialized.result.instructions, /qxqy_project_save/)
    assert.match(initialized.result.instructions, /do not update the browser/)
    assert.match(initialized.result.instructions, /qxqy_preview_open/)
    assert.ok(initialized.result.capabilities.tools)
    server.notify('notifications/initialized')

    const listed = await server.request('tools/list')
    const names = listed.result.tools.map((tool) => tool.name)
    assert.deepEqual(names, [
      'qxqy_script_sync',
      'qxqy_project_open', 'qxqy_project_save', 'qxqy_studio_get', 'qxqy_studio_patch',
      'qxqy_studio_play', 'qxqy_studio_ui_screenshot', 'qxqy_studio_play_screenshot', 'qxqy_studio_load',
      'qxqy_preview_status', 'qxqy_preview_open',
    ])

    const archives = await server.request('tools/call', {
      name: 'qxqy_studio_load',
      arguments: {},
    })
    assert.deepEqual(archives.result.structuredContent.archives, [])

    const opened = await server.request('tools/call', { name: 'qxqy_project_open', arguments: {} })
    assert.equal(opened.result.isError, undefined)
    const handle = opened.result.structuredContent.handle

    const got = await server.request('tools/call', { name: 'qxqy_studio_get', arguments: { handle } })
    const revision = got.result.structuredContent.version
    const patched = await server.request('tools/call', {
      name: 'qxqy_studio_patch',
      arguments: { handle, op: { op: 'renameSave', name: 'MCP test', expectedRevision: revision } },
    })
    assert.equal(patched.result.structuredContent.save.name, 'MCP test')

    const syncConfig = { version: 1, workspaceDir: '', clientImportRoot: join(workspace, 'client'), clientSubdir: '' }
    const configured = await server.request('tools/call', {
      name: 'qxqy_script_sync', arguments: { handle, action: 'configure', args: { config: syncConfig, expectedRevision: patched.result.structuredContent.version } },
    })
    assert.deepEqual(configured.result.structuredContent.scriptSync, syncConfig)
    const refused = await server.request('tools/call', { name: 'qxqy_script_sync', arguments: { handle, action: 'apply', args: { confirmed: true } } })
    assert.equal(refused.result.isError, true)

    const saved = await server.request('tools/call', {
      name: 'qxqy_project_save',
      arguments: { handle, path: 'nested/test.save.json' },
    })
    assert.ok(saved.result.structuredContent, JSON.stringify(saved))
    assert.equal(saved.result.structuredContent.path, 'nested/test.save.json')
    assert.equal(saved.result.structuredContent.preview.status, 'not-requested')
    const savedJson = JSON.parse(readFileSync(join(workspace, 'nested', 'test.save.json'), 'utf8'))
    assert.equal(savedJson.format, 'qxqy-simulator-save')
    assert.equal(savedJson.meta.name, 'MCP test')
    assert.deepEqual(savedJson.scriptSync, syncConfig)

    const screenshot = await server.request('tools/call', {
      name: 'qxqy_studio_ui_screenshot',
      arguments: { handle },
    })
    assert.equal(screenshot.result.content[1].type, 'image')
    assert.equal(screenshot.result.content[1].mimeType, 'image/png')
    assert.ok(screenshot.result.content[1].data.length > 100)

    const started = await server.request('tools/call', {
      name: 'qxqy_studio_play',
      arguments: { handle, action: 'start', args: {} },
    })
    assert.equal(started.result.structuredContent.running, true)
    const playScreenshot = await server.request('tools/call', {
      name: 'qxqy_studio_play_screenshot',
      arguments: { handle },
    })
    assert.equal(playScreenshot.result.content[1].type, 'image')
    const stopped = await server.request('tools/call', {
      name: 'qxqy_studio_play',
      arguments: { handle, action: 'stop', args: {} },
    })
    assert.equal(stopped.result.structuredContent.running, false)
  } finally {
    await stopServer(server)
    rmSync(workspace, { recursive: true, force: true })
  }
})

test('tool failures are returned as MCP isError results', async () => {
  const workspace = mkdtempSync(join(tmpdir(), 'qxqy-mcp-error-'))
  const server = startServer(workspace)
  try {
    const result = await server.request('tools/call', {
      name: 'qxqy_studio_get',
      arguments: { handle: 'missing' },
    })
    assert.equal(result.result.isError, true)
    assert.match(result.result.content[0].text, /unknown project handle/)
  } finally {
    await stopServer(server)
    rmSync(workspace, { recursive: true, force: true })
  }
})

async function clockFixture(t) {
  const workspace = mkdtempSync(join(tmpdir(), 'qxqy-mcp-clock-'))
  const server = startServer(workspace)
  t.after(async () => {
    await stopServer(server)
    rmSync(workspace, { recursive: true, force: true })
  })
  const raw = async (name, args) => (await server.request('tools/call', { name, arguments: args })).result
  const call = async (name, args) => {
    const result = await raw(name, args)
    assert.notEqual(result.isError, true, JSON.stringify(result))
    return result.structuredContent
  }
  const { handle } = await call('qxqy_project_open', {})
  const snapshot = await call('qxqy_studio_get', { handle })
  await call('qxqy_studio_patch', { handle, op: {
    op: 'addScript', path: 'clock.lua', controlId: 'n1', controlAsset: 'server-control-template',
    expectedRevision: snapshot.version, source: `
local elapsed = 0
function OnStart()
  script:EnableUpdate(true)
end
function OnUpdate(dt)
  elapsed = elapsed + dt
  script.object:GetChild("文本框").text = string.format("%.2f", elapsed)
end`,
  } })
  const play = (action, args = {}) => call('qxqy_studio_play', { handle, action, args })
  return { workspace, raw, call, handle, play }
}

test('MCP manual clock advances only on step, including across screenshots and pause/resume (#5)', { timeout: 15000 }, async t => {
  const { call, handle, play } = await clockFixture(t)
  const start = await play('start')
  await delay(250)
  const idle = await play('get')
  assert.equal(idle.time, start.time, 'waiting between MCP calls must not advance Lua')
  assert.equal(idle.frame, start.frame)
  assert.equal(idle.clockMode, 'manual')
  const step = await play('step', { dt: 2, inspect: true })
  assert.equal(step.time, 2)
  assert.equal(step.frame, 1)
  assert.equal(step.tree[0].children.find(node => node.kind === 'textbox').text, '2.00')
  await delay(250)
  const image = await call('qxqy_studio_play_screenshot', { handle })
  assert.equal(image.time, 2)
  assert.equal(image.frame, 1)
  assert.equal(image.clockMode, 'manual')
  const after = await play('get', { light: true })
  assert.equal(after.time, 2)
  assert.equal(after.frame, 1)
  await play('pause')
  const pausedStep = await play('step', { dt: 0.25 })
  assert.equal(pausedStep.time, 2.25)
  assert.equal(pausedStep.paused, true)
  await play('resume')
  await delay(250)
  assert.equal((await play('get')).time, 2.25)
  const device = await play('device', { canvasId: 'mobile-16-9' })
  assert.equal(device.clockMode, 'manual')
  assert.equal(device.time, 0)
  await delay(250)
  assert.equal((await play('get')).time, 0)
})

async function waitForFrames(play, previous) {
  const deadline = Date.now() + 3000
  while (Date.now() < deadline) {
    await delay(50)
    const next = await play('get', { light: true })
    if (next.frame > previous.frame) return next
  }
  assert.fail('realtime clock did not advance')
}

test('MCP realtime is opt-in, pauses correctly and preserves mode on device changes (#5)', { timeout: 15000 }, async t => {
  const { raw, handle, play } = await clockFixture(t)
  const start = await play('start', { clockMode: 'realtime' })
  assert.equal(start.clockMode, 'realtime')
  assert.ok((await waitForFrames(play, start)).time > start.time)
  const paused = await play('pause')
  await delay(250)
  assert.equal((await play('get')).time, paused.time)
  await play('resume')
  assert.ok((await waitForFrames(play, paused)).time > paused.time)
  const device = await play('device', { canvasId: 'pc-21-9' })
  assert.equal(device.clockMode, 'realtime')
  await waitForFrames(play, device)
  const restarted = await play('start')
  assert.equal(restarted.clockMode, 'manual', 'a fresh MCP start returns to its default')
  for (const action of ['start', 'device']) {
    const result = await raw('qxqy_studio_play', { handle, action, args: { canvasId: 'pc-16-9', clockMode: 'invalid' } })
    assert.equal(result.isError, true)
    assert.match(result.content[0].text, /clockMode must be/)
  }
  const unchanged = await play('get')
  assert.equal(unchanged.clockMode, 'manual')
  assert.equal(unchanged.time, restarted.time, 'invalid options must not replace the running worker')
})

test('MCP stop/load/start uses updated inline and file-backed scripts (#5.3)', { timeout: 15000 }, async t => {
  const { workspace, call, handle, play } = await clockFixture(t)
  await call('qxqy_project_save', { handle, path: 'reload.save.json' })
  const path = join(workspace, 'reload.save.json')
  const archive = JSON.parse(readFileSync(path, 'utf8'))
  for (const sourceKind of ['inline', 'file']) {
    for (const version of [1, 2]) {
      const marker = `${sourceKind}-v${version}`
      const source = `function OnStart() print("${marker}") end`
      archive.assets.scripts[0].source = sourceKind === 'inline' ? source : ''
      writeFileSync(join(workspace, 'clock.lua'), sourceKind === 'inline' ? 'error("inline source must win")' : source)
      writeFileSync(path, JSON.stringify(archive))
      await play('stop')
      await call('qxqy_studio_load', { handle, path: 'reload.save.json' })
      const started = await play('start')
      assert.equal(started.mountError, null)
      assert.deepEqual(started.logs.map(row => row.text), [marker])
    }
  }
})
