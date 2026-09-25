import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

const repository = fileURLToPath(new URL('../..', import.meta.url))
const REQUEST_TIMEOUT_MS = 15_000

function startProcess(entry, args) {
  const child = spawn(process.execPath, [join(repository, entry), ...args], {
    cwd: repository,
    env: { ...process.env, QXQY_WEB_PASSWORD: '' },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  })
  let diagnostics = ''
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk) => { diagnostics = (diagnostics + chunk).slice(-16_384) })
  child.stdout.setEncoding('utf8')
  // Attach before a process can exit, including when startup itself fails.
  const closed = new Promise((resolve) => {
    child.once('close', (code, signal) => resolve({ code, signal }))
  })
  return { child, closed, diagnostics: () => diagnostics }
}

async function stopProcess(server) {
  if (!server) return
  const { child, closed } = server
  if (child.exitCode === null && child.signalCode === null) child.kill()
  let timer
  try {
    await Promise.race([
      closed,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          child.kill('SIGKILL')
          reject(new Error(`child did not close within 5 seconds: ${server.diagnostics()}`))
        }, 5_000)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

async function startWeb(workspace) {
  const server = startProcess('web/server.js', ['--workspace', workspace, '--host', '127.0.0.1', '--port', '0'])
  let timer
  let output = ''
  try {
    server.url = await new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`Web startup timed out: ${server.diagnostics()}`)), REQUEST_TIMEOUT_MS)
      server.child.once('error', reject)
      server.closed.then(({ code, signal }) => reject(new Error(`Web exited before startup (${code ?? signal}): ${server.diagnostics()}`)))
      server.child.stdout.on('data', (chunk) => {
        output += chunk
        const url = output.match(/QXQY Simulator Web: (http:\/\/[^\s]+)/)?.[1]
        if (url) resolve(url)
      })
    })
    return server
  } catch (error) {
    await stopProcess(server)
    throw error
  } finally {
    clearTimeout(timer)
  }
}

function startMcp(workspace, webUrl) {
  const server = startProcess('mcp/index.js', ['--workspace', workspace, '--web-url', webUrl])
  const pending = new Map()
  let sequence = 0
  let buffer = ''
  let failure
  const rejectPending = (error) => {
    failure = error
    for (const request of pending.values()) request.reject(error)
    pending.clear()
  }
  server.child.on('error', rejectPending)
  server.child.stdin.on('error', rejectPending)
  server.closed.then(({ code, signal }) => {
    rejectPending(new Error(`MCP exited (${code ?? signal}): ${server.diagnostics()}`))
  })
  server.child.stdout.on('data', (chunk) => {
    buffer += chunk
    let newline
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline).trim()
      buffer = buffer.slice(newline + 1)
      if (!line) continue
      try {
        const message = JSON.parse(line)
        pending.get(message.id)?.resolve(message)
      } catch (error) {
        rejectPending(error)
      }
    }
  })
  server.request = (method, params = {}) => {
    if (failure) return Promise.reject(failure)
    const id = ++sequence
    return new Promise((resolve, reject) => {
      const finish = (callback, value) => {
        clearTimeout(timer)
        pending.delete(id)
        callback(value)
      }
      const timer = setTimeout(() => {
        finish(reject, new Error(`${method} timed out after ${REQUEST_TIMEOUT_MS}ms: ${server.diagnostics()}`))
      }, REQUEST_TIMEOUT_MS)
      pending.set(id, {
        resolve: (value) => finish(resolve, value),
        reject: (error) => finish(reject, error),
      })
      server.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
    })
  }
  return server
}

async function initialize(mcp) {
  const response = await mcp.request('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'web-integration-test', version: '1' },
  })
  assert.equal(response.error, undefined)
  assert.equal(response.result.serverInfo.name, 'beyond-simulator-mcp')
  mcp.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`)
}

async function toolResult(mcp, name, args = {}) {
  const response = await mcp.request('tools/call', { name, arguments: args })
  assert.equal(response.error, undefined, JSON.stringify(response.error))
  return response.result
}

async function callTool(mcp, name, args = {}) {
  const result = await toolResult(mcp, name, args)
  assert.notEqual(result.isError, true, result.content?.[0]?.text)
  assert.ok(result.structuredContent, `missing structuredContent from ${name}`)
  return result.structuredContent
}

async function rename(mcp, handle, name) {
  const snapshot = await callTool(mcp, 'qxqy_studio_get', { handle })
  return callTool(mcp, 'qxqy_studio_patch', {
    handle,
    op: { op: 'renameSave', name, expectedRevision: snapshot.version },
  })
}

async function preview(web) {
  const response = await fetch(`${web.url}/api/preview`, { signal: AbortSignal.timeout(5_000) })
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.ok, true)
  assert.equal(body.value.service, 'beyond-simulator-web')
  assert.equal(typeof body.value.version, 'string')
  assert.ok(body.value.version)
  return body.value
}

async function eventually(check, description, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs
  do {
    if (await check()) return
    await delay(100)
  } while (Date.now() < deadline)
  assert.fail(`timed out waiting for ${description}`)
}

async function remainsOn(web, path, name) {
  // Cross at least one real default 700ms watch interval, checking throughout.
  const deadline = Date.now() + 1_000
  do {
    const current = await preview(web)
    assert.equal(current.activePath, path)
    assert.equal(current.name, name)
    await delay(100)
  } while (Date.now() < deadline)
}

function fileIdentity(path) {
  return {
    hash: createHash('sha256').update(readFileSync(path)).digest('hex'),
    mtimeNs: statSync(path, { bigint: true }).mtimeNs,
  }
}

test('separate MCP and Web processes discover saves, retain paths and explicitly switch previews', { timeout: 60_000 }, async () => {
  const workspace = mkdtempSync(join(tmpdir(), 'qxqy-mcp-web-'))
  const otherWorkspace = mkdtempSync(join(tmpdir(), 'qxqy-mcp-web-other-'))
  let web
  let mcp
  let otherMcp
  try {
    web = await startWeb(workspace)
    mcp = startMcp(workspace, web.url)
    await initialize(mcp)
    const empty = await callTool(mcp, 'qxqy_preview_status')
    assert.equal(empty.status, 'connected')
    assert.equal(empty.workspace, realpathSync(workspace))
    assert.equal(empty.activePath, '')

    const a = await callTool(mcp, 'qxqy_project_open')
    await rename(mcp, a.handle, 'Archive A')
    await callTool(mcp, 'qxqy_project_save', { handle: a.handle, path: 'nested/a.save.json' })
    await eventually(async () => {
      const current = await preview(web)
      return current.activePath === 'nested/a.save.json' && current.name === 'Archive A'
    }, 'first MCP save to appear after empty Web startup')

    await rename(mcp, a.handle, 'Archive A updated')
    const savedA = await callTool(mcp, 'qxqy_project_save', { handle: a.handle })
    assert.equal(savedA.path, 'nested/a.save.json')
    assert.equal(savedA.preview.status, 'not-requested')
    await eventually(async () => (await preview(web)).name === 'Archive A updated', 'current file reload')

    const b = await callTool(mcp, 'qxqy_project_open')
    await rename(mcp, b.handle, 'Archive B')
    await callTool(mcp, 'qxqy_project_save', { handle: b.handle, path: 'b.save.json' })
    await callTool(mcp, 'qxqy_project_open', { path: 'b.save.json' })
    await callTool(mcp, 'qxqy_studio_load', { handle: a.handle, path: 'b.save.json' })
    await remainsOn(web, 'nested/a.save.json', 'Archive A updated')

    const aPath = join(workspace, 'nested', 'a.save.json')
    const bPath = join(workspace, 'b.save.json')
    const beforeA = fileIdentity(aPath)
    const beforeB = fileIdentity(bPath)
    const openedB = await callTool(mcp, 'qxqy_preview_open', { path: 'b.save.json' })
    assert.equal(openedB.status, 'opened')
    assert.equal(openedB.requestedPath, 'b.save.json')
    assert.equal(openedB.activePath, 'b.save.json')
    assert.equal(openedB.name, 'Archive B')
    assert.deepEqual(fileIdentity(aPath), beforeA)
    assert.deepEqual(fileIdentity(bPath), beforeB)
    assert.equal((await preview(web)).activePath, 'b.save.json')
    const status = await callTool(mcp, 'qxqy_preview_status')
    assert.equal(status.activePath, 'b.save.json')
    assert.equal(status.name, 'Archive B')
    assert.equal(status.lastError, '')

    const reopenedA = await callTool(mcp, 'qxqy_project_open', { path: 'nested/a.save.json' })
    await rename(mcp, reopenedA.handle, 'Archive A reopened')
    const resavedA = await callTool(mcp, 'qxqy_project_save', { handle: reopenedA.handle })
    assert.equal(resavedA.path, 'nested/a.save.json')
    assert.equal(JSON.parse(readFileSync(aPath, 'utf8')).meta.name, 'Archive A reopened')
    assert.equal(existsSync(join(workspace, 'qxqy-simulator.save.json')), false)
    await remainsOn(web, 'b.save.json', 'Archive B')

    // Identical relative filenames must not let a differently bound MCP
    // switch the Web service to a file in the wrong workspace.
    otherMcp = startMcp(otherWorkspace, web.url)
    await initialize(otherMcp)
    const other = await callTool(otherMcp, 'qxqy_project_open')
    await callTool(otherMcp, 'qxqy_project_save', { handle: other.handle, path: 'nested/a.save.json' })
    const beforeMismatch = await preview(web)
    for (const [name, args] of [
      ['qxqy_preview_status', {}],
      ['qxqy_preview_open', { path: 'nested/a.save.json' }],
    ]) {
      const result = await toolResult(otherMcp, name, args)
      assert.equal(result.isError, true)
      assert.match(result.content[0].text, /workspace mismatch/i)
    }
    const afterMismatch = await preview(web)
    assert.equal(afterMismatch.activePath, beforeMismatch.activePath)
    assert.equal(afterMismatch.lastLoadedAt, beforeMismatch.lastLoadedAt)
    assert.equal(afterMismatch.revision, beforeMismatch.revision)

    await stopProcess(web)
    for (const [name, args] of [
      ['qxqy_preview_status', {}],
      ['qxqy_preview_open', { path: 'b.save.json' }],
    ]) {
      const result = await toolResult(mcp, name, args)
      assert.equal(result.isError, true)
      assert.match(result.content[0].text, /Web preview is unavailable/i)
    }
    await rename(mcp, b.handle, 'Saved while Web is offline')
    const offlineSave = await callTool(mcp, 'qxqy_project_save', { handle: b.handle })
    assert.equal(offlineSave.path, 'b.save.json')
    assert.equal(offlineSave.preview.status, 'not-requested')
    assert.equal(JSON.parse(readFileSync(bPath, 'utf8')).meta.name, 'Saved while Web is offline')
  } finally {
    await Promise.all([stopProcess(otherMcp), stopProcess(mcp), stopProcess(web)])
    rmSync(workspace, { recursive: true, force: true })
    rmSync(otherWorkspace, { recursive: true, force: true })
  }
})

test('an MCP save larger than 8 MiB is discovered by an initially empty Web process', { timeout: 60_000 }, async () => {
  const workspace = mkdtempSync(join(tmpdir(), 'qxqy-mcp-web-large-'))
  let web
  let mcp
  try {
    web = await startWeb(workspace)
    mcp = startMcp(workspace, web.url)
    await initialize(mcp)
    assert.equal((await preview(web)).activePath, '')
    const opened = await callTool(mcp, 'qxqy_project_open')
    const renamed = await rename(mcp, opened.handle, 'Large MCP save')
    await callTool(mcp, 'qxqy_studio_patch', {
      handle: opened.handle,
      op: {
        op: 'addScript',
        path: 'large-comment.lua',
        source: `--${'x'.repeat(8 * 1024 * 1024)}`,
        expectedRevision: renamed.version,
      },
    })
    const saved = await callTool(mcp, 'qxqy_project_save', { handle: opened.handle, path: 'large.save.json' })
    assert.ok(saved.bytes > 8 * 1024 * 1024)
    const listed = await callTool(mcp, 'qxqy_studio_load')
    assert.ok(listed.archives.some((archive) => archive.path === 'large.save.json'))
    await eventually(async () => {
      const current = await preview(web)
      return current.activePath === 'large.save.json' && current.name === 'Large MCP save'
    }, 'large MCP save to be discovered and opened')
    assert.equal((await callTool(mcp, 'qxqy_preview_status')).activePath, 'large.save.json')
  } finally {
    await Promise.all([stopProcess(mcp), stopProcess(web)])
    rmSync(workspace, { recursive: true, force: true })
  }
})
