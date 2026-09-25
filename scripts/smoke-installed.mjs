// This file is copied outside the source checkout before it is executed.
import assert from 'node:assert/strict'
import { mkdir, readFile, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createRequire } from 'node:module'
import { createWebServer } from 'beyond-simulator-web'
import { SimulatorController } from 'dsh-plugin-beyond-simulator'
import { apply as registerSkill } from 'dsh-plugin-beyond-simulator/skill'

const require = createRequire(import.meta.url)
let clientModule
new Function('window', await readFile(require.resolve('dsh-plugin-beyond-simulator/client'), 'utf8'))({
  __ModuleLoader__: { load(value) { clientModule = value } },
})
assert.equal(clientModule.id, 'dsh-plugin-beyond-simulator')
const clientExports = clientModule.factory(name => { assert.equal(name, 'react'); return { createElement() {} } })
assert.deepEqual(clientExports.inject, ['slots'])
assert.equal(typeof clientExports.apply, 'function')
const workspace = join(process.cwd(), 'workspace')
await mkdir(workspace)
for (const name of ['qxqy-studio', 'qxqy-lua-runtime', 'qxqy-server']) {
  assert.throws(() => require.resolve(name), { code: 'MODULE_NOT_FOUND' })
}
const manifests = new Map()
for (const name of ['dsh-plugin-beyond-simulator', 'beyond-simulator-mcp', 'beyond-simulator-web']) {
  const manifest = JSON.parse(await readFile(join(process.cwd(), 'node_modules', name, 'package.json'), 'utf8'))
  manifests.set(name, manifest)
  assert.equal(manifest.devDependencies, undefined)
  for (const script of ['prepare', 'preinstall', 'install', 'postinstall', 'prepack']) assert.equal(manifest.scripts?.[script], undefined)
  assert.ok(!JSON.stringify(manifest.dependencies).match(/workspace:|file:|link:/))
}

const controller = new SimulatorController(workspace)
try {
  controller.patch({ op: 'renameSave', name: 'Installed package' })
  const save = controller.saveArchive('demo.save.json')
  assert.ok(save.bytes > 0)
  const image = controller.requestUiScreenshot()
  assert.equal(image.data.subarray(1, 4).toString(), 'PNG')
  assert.equal((await controller.play('start', { view: true })).running, true)
  const playImage = await controller.requestScreenshot()
  assert.equal(playImage.data.subarray(1, 4).toString(), 'PNG')
  const gia = controller.exportData('gia')
  assert.ok(controller.importData('gia', gia.data, gia.filename).snapshot)
  let skill
  registerSkill({ skills: { register(value) { skill = value } } })
  assert.equal(skill.name, 'qxqy-simulator')
  assert.ok(skill.content.length > 1000)
  assert.ok((await readdir(join(process.cwd(), 'node_modules/dsh-plugin-beyond-simulator/dsh-plugin/presets/wonderland-lua-builder'))).includes('preset.yml'))
} finally { await controller.dispose() }
console.log('PASS installed DSH: controller, Worker, PNG, GIA, Skill and preset assets')

const app = await createWebServer({ workspace, port: 0 })
try {
  const state = await (await fetch(`${app.url}/api/state`)).json()
  assert.equal(state.value.snapshot.save.name, 'Installed package')
  for (const path of ['/', '/app.js', '/play-renderer.js', '/api/editor.png', '/editor', '/editor.js', '/editor/play', '/editor/play.js', '/editor/play.css']) assert.equal((await fetch(`${app.url}${path}`)).status, 200, path)
  const response = await fetch(`${app.url}/api/play`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'start', args: { view: true } }) })
  assert.equal((await response.json()).value.scene.format, 'tree-v1')
  const edit = async (action, body = {}) => (await (await fetch(`${app.url}/editor/api/${action}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: 'smoke', ...body }) })).json())
  const snapshot = (await edit('get')).value
  const saved = await edit('save', { path: 'editor.save.json', expectedRevision: snapshot.version })
  assert.equal(saved.ok, true, JSON.stringify(saved))
  assert.equal((await edit('play', { action: 'start', args: { view: true } })).value.scene.format, 'tree-v1')
} finally { await app.close() }
console.log('PASS installed Web: HTTP, editor save, static resources, PNG and Worker')

// Exercise the installed Web bundle and installed MCP executable together.
// Starting on a different file makes accidental process-local "opens" visible.
const previewApp = await createWebServer({ workspace, port: 0, initialPath: 'editor.save.json', password: '' })
const child = spawn(process.execPath, [require.resolve('beyond-simulator-mcp'), '--workspace', workspace, '--web-url', previewApp.url], {
  env: { ...process.env, QXQY_WEB_PASSWORD: '' },
  stdio: ['pipe', 'pipe', 'pipe'],
  windowsHide: true,
})
let buffer = ''
let diagnostics = ''
let nextId = 0
const pending = new Map()
child.stderr.on('data', chunk => { diagnostics += chunk })
child.on('error', error => {
  for (const request of pending.values()) request.reject(error)
})
child.stdin.on('error', error => {
  for (const request of pending.values()) request.reject(error)
})
child.on('exit', (code, signal) => {
  for (const request of pending.values()) request.reject(new Error(`MCP exited (${code ?? signal}): ${diagnostics}`))
})
child.stdout.setEncoding('utf8')
child.stdout.on('data', chunk => {
  buffer += chunk
  let end
  while ((end = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, end)
    buffer = buffer.slice(end + 1)
    if (!line.trim()) continue
    const response = JSON.parse(line)
    pending.get(response.id)?.resolve(response)
    pending.delete(response.id)
  }
})
async function request(method, params) {
  const id = ++nextId
  let timer
  try {
    return await Promise.race([
      new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n') }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`MCP timeout: ${diagnostics}`)), 15000) }),
    ])
  } finally { clearTimeout(timer); pending.delete(id) }
}
async function callTool(name, args = {}) {
  const response = await request('tools/call', { name, arguments: args })
  assert.equal(response.error, undefined, JSON.stringify(response))
  assert.notEqual(response.result.isError, true, JSON.stringify(response))
  assert.ok(response.result.structuredContent, name)
  return response.result.structuredContent
}
try {
  const init = await request('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'package-smoke', version: '1' } })
  assert.equal(init.result.serverInfo.name, 'beyond-simulator-mcp')
  assert.equal(init.result.serverInfo.version, manifests.get('beyond-simulator-mcp').version)
  const tools = await request('tools/list', {})
  for (const name of ['qxqy_project_save', 'qxqy_preview_status', 'qxqy_preview_open']) {
    assert.ok(tools.result.tools.some(tool => tool.name === name), name)
  }
  const initialPreview = await callTool('qxqy_preview_status')
  assert.equal(initialPreview.status, 'connected')
  assert.equal(initialPreview.service, 'beyond-simulator-web')
  assert.equal(initialPreview.version, manifests.get('beyond-simulator-web').version)
  assert.equal(initialPreview.activePath, 'editor.save.json')

  const { handle } = await callTool('qxqy_project_open', { path: 'demo.save.json' })
  assert.equal((await callTool('qxqy_preview_status')).activePath, 'editor.save.json')
  const snapshot = await callTool('qxqy_studio_get', { handle })
  await callTool('qxqy_studio_patch', { handle, op: { op: 'renameSave', name: 'Installed MCP update', expectedRevision: snapshot.version } })
  const saved = await callTool('qxqy_project_save', { handle })
  assert.equal(saved.path, 'demo.save.json')
  assert.equal(saved.preview.status, 'not-requested')
  assert.equal(JSON.parse(await readFile(join(workspace, saved.path), 'utf8')).meta.name, 'Installed MCP update')
  assert.ok(!(await readdir(workspace)).includes('qxqy-simulator.save.json'))
  assert.equal((await callTool('qxqy_preview_status')).activePath, 'editor.save.json')

  const savePath = join(workspace, saved.path)
  const beforeBytes = await readFile(savePath)
  const beforeMtime = (await stat(savePath, { bigint: true })).mtimeNs
  const openedPreview = await callTool('qxqy_preview_open', { path: saved.path })
  assert.equal(openedPreview.status, 'opened')
  assert.equal(openedPreview.activePath, saved.path)
  assert.equal(openedPreview.name, 'Installed MCP update')
  assert.equal(openedPreview.version, manifests.get('beyond-simulator-web').version)
  const webResponse = await fetch(`${previewApp.url}/api/preview`, { signal: AbortSignal.timeout(5_000) })
  assert.equal(webResponse.status, 200)
  const webPreview = (await webResponse.json()).value
  assert.equal(webPreview.activePath, saved.path)
  assert.equal(webPreview.name, 'Installed MCP update')
  assert.equal(webPreview.lastError, '')
  assert.deepEqual(await readFile(savePath), beforeBytes)
  assert.equal((await stat(savePath, { bigint: true })).mtimeNs, beforeMtime)
  const played = await request('tools/call', { name: 'qxqy_studio_play', arguments: { handle, action: 'start', args: { view: true } } })
  assert.ok(!played.result.isError, JSON.stringify(played))
  const screenshot = await request('tools/call', { name: 'qxqy_studio_play_screenshot', arguments: { handle } })
  assert.ok(screenshot.result.content.some(item => item.type === 'image'))
} finally {
  try {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit', { signal: AbortSignal.timeout(5_000) })
      child.kill()
      try { await exited } catch (error) { child.kill('SIGKILL'); throw error }
    }
  } finally { await previewApp.close() }
}
console.log('PASS installed MCP + Web: package versions, default save path, explicit preview without rewriting, Worker and image response')
