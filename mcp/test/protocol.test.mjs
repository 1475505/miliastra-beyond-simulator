import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

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
    assert.ok(initialized.result.capabilities.tools)
    server.notify('notifications/initialized')

    const listed = await server.request('tools/list')
    const names = listed.result.tools.map((tool) => tool.name)
    assert.deepEqual(names, [
      'qxqy_project_open', 'qxqy_project_save', 'qxqy_studio_get', 'qxqy_studio_patch',
      'qxqy_studio_play', 'qxqy_studio_ui_screenshot', 'qxqy_studio_play_screenshot', 'qxqy_studio_load',
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

    const saved = await server.request('tools/call', {
      name: 'qxqy_project_save',
      arguments: { handle, path: 'nested/test.save.json' },
    })
    assert.ok(saved.result.structuredContent, JSON.stringify(saved))
    assert.equal(saved.result.structuredContent.path, 'nested/test.save.json')
    const savedJson = JSON.parse(readFileSync(join(workspace, 'nested', 'test.save.json'), 'utf8'))
    assert.equal(savedJson.format, 'qxqy-simulator-save')
    assert.equal(savedJson.meta.name, 'MCP test')

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
