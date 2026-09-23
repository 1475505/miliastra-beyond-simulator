// This file is copied outside the source checkout before it is executed.
import assert from 'node:assert/strict'
import { mkdir, readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createRequire } from 'node:module'
import { createWebServer } from 'beyond-simulator-web'
import { SimulatorController } from 'dsh-plugin-beyond-simulator'
import { apply as registerSkill } from 'dsh-plugin-beyond-simulator/skill'

const require = createRequire(import.meta.url)
const workspace = join(process.cwd(), 'workspace')
await mkdir(workspace)
for (const name of ['qxqy-studio', 'qxqy-lua-runtime', 'qxqy-server']) {
  assert.throws(() => require.resolve(name), { code: 'MODULE_NOT_FOUND' })
}
for (const name of ['dsh-plugin-beyond-simulator', 'qxqy-simulator-mcp', 'beyond-simulator-web']) {
  const manifest = JSON.parse(await readFile(join(process.cwd(), 'node_modules', name, 'package.json'), 'utf8'))
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

const child = spawn(process.execPath, [require.resolve('qxqy-simulator-mcp'), '--workspace', workspace], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
let buffer = ''
let diagnostics = ''
let nextId = 0
const pending = new Map()
child.stderr.on('data', chunk => { diagnostics += chunk })
child.stdout.setEncoding('utf8')
child.stdout.on('data', chunk => {
  buffer += chunk
  let end
  while ((end = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, end)
    buffer = buffer.slice(end + 1)
    if (!line.trim()) continue
    const response = JSON.parse(line)
    pending.get(response.id)?.(response)
    pending.delete(response.id)
  }
})
async function request(method, params) {
  const id = ++nextId
  let timer
  try {
    return await Promise.race([
      new Promise(resolve => { pending.set(id, resolve); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n') }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`MCP timeout: ${diagnostics}`)), 15000) }),
    ])
  } finally { clearTimeout(timer); pending.delete(id) }
}
try {
  const init = await request('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'package-smoke', version: '1' } })
  assert.equal(init.result.serverInfo.name, 'qxqy-simulator-mcp')
  const tools = await request('tools/list', {})
  assert.ok(tools.result.tools.some(tool => tool.name === 'qxqy_project_save'))
  const opened = await request('tools/call', { name: 'qxqy_project_open', arguments: { path: 'demo.save.json' } })
  const handle = opened.result.structuredContent.handle
  const played = await request('tools/call', { name: 'qxqy_studio_play', arguments: { handle, action: 'start', args: { view: true } } })
  assert.ok(!played.result.isError, JSON.stringify(played))
  const screenshot = await request('tools/call', { name: 'qxqy_studio_play_screenshot', arguments: { handle } })
  assert.ok(screenshot.result.content.some(item => item.type === 'image'))
} finally {
  if (child.exitCode === null && child.signalCode === null) {
    const exited = once(child, 'exit')
    child.kill()
    await exited
  }
}
console.log('PASS installed MCP: handshake, tools, project open, Worker and image response')
