#!/usr/bin/env node

import { SimulatorController } from './lib/controller.js'
import { listWorkspaceArchives, resolveWorkspaceRoot } from './lib/workspace.js'
import manifest from './package.json' with { type: 'json' }

const SERVER_NAME = 'qxqy-simulator-mcp'
const SERVER_VERSION = manifest.version
const SUPPORTED_PROTOCOL_VERSIONS = [
  '2025-11-25',
  '2025-06-18',
  '2025-03-26',
  '2024-11-05',
]

function negotiateProtocolVersion(requested) {
  return SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
    ? requested
    : SUPPORTED_PROTOCOL_VERSIONS[0]
}

function workspaceFromArgs() {
  const index = process.argv.indexOf('--workspace')
  return index >= 0 && process.argv[index + 1]
    ? process.argv[index + 1]
    : process.env.QXQY_WORKSPACE || process.cwd()
}

const workspaceRoot = resolveWorkspaceRoot(workspaceFromArgs())
const projects = new Map()
let nextHandle = 1
const requests = new Map()

const objectSchema = (properties, required = []) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
})

const handleProperty = {
  handle: {
    type: 'string',
    description: 'qxqy_project_open 返回的工程句柄；项目级读写和试玩工具需要它。',
  },
}

const tools = [
  {
    name: 'qxqy_project_open',
    description: '打开工作区中的千星模拟器存档，或创建一个新的空工程。返回后续工具使用的工程句柄；path 必须是工作区内相对路径。',
    inputSchema: objectSchema({
      path: { type: 'string', description: '可选的 qxqy-simulator-save JSON 相对路径；省略则创建空工程。' },
    }),
  },
  {
    name: 'qxqy_project_save',
    description: '将工程当前状态保存为 qxqy-simulator-save JSON。会创建缺失的工作区子目录；path 必须是工作区内相对路径。',
    inputSchema: objectSchema({
      ...handleProperty,
      path: { type: 'string', description: '可选输出路径，默认 qxqy-simulator.save.json。' },
    }, ['handle']),
  },
  {
    name: 'qxqy_studio_get',
    description: '读取指定工程的无损 Authoring JSON 快照、当前 revision、脚本挂载、画布和服务端逻辑。写操作前应先调用它获取最新 revision。',
    inputSchema: objectSchema(handleProperty, ['handle']),
  },
  {
    name: 'qxqy_studio_patch',
    description: '修改指定工程。op 对象必须包含 expectedRevision；发生 revision conflict 时先重新 get，再基于新快照重算 patch。',
    inputSchema: objectSchema({
      ...handleProperty,
      op: { type: 'object', description: 'studio.patch 操作对象，例如 {"op":"set","id":"...","key":"text","value":"...","expectedRevision":1}。', additionalProperties: true },
    }, ['handle', 'op']),
  },
  {
    name: 'qxqy_studio_play',
    description: '控制指定工程的确定性 Lua 试玩 Worker：start、step、输入、暂停/继续、设备/多人视角、服务端变量/信号和用例回放。start 后才能进行输入和 step；stop 是确定性回收方式。',
    inputSchema: objectSchema({
      ...handleProperty,
      action: {
        type: 'string',
        enum: ['start', 'device', 'view', 'get', 'step', 'pointer', 'key', 'click', 'pause', 'resume', 'stop', 'serverGet', 'serverSet', 'serverSend', 'history', 'saveCase', 'runCase'],
      },
      args: { type: 'object', description: '动作参数。pointer 使用 type/x/y；step 使用 dt；start/device 使用 canvasId；serverSet 使用 entityType/name/value。', additionalProperties: true },
    }, ['handle', 'action']),
  },
  {
    name: 'qxqy_studio_ui_screenshot',
    description: '获取当前编辑器舞台 PNG，用于检查静态 UI 布局和控件图元；不会启动或步进试玩。',
    inputSchema: objectSchema(handleProperty, ['handle']),
  },
  {
    name: 'qxqy_studio_play_screenshot',
    description: '获取当前试玩 Runtime 画面的 PNG，用于检查 Lua、动画和输入后的实际画面；必须先 start，不会步进时间。',
    inputSchema: objectSchema(handleProperty, ['handle']),
  },
  {
    name: 'qxqy_studio_load',
    description: '列出工作区内的 qxqy-simulator-save JSON，或将指定相对路径的存档载入已有工程句柄。',
    inputSchema: objectSchema({
      ...handleProperty,
      path: { type: 'string', description: '省略时列出存档；传入工作区内相对路径时载入该存档。' },
    }),
  },
]

function jsonText(value) {
  const text = JSON.stringify(value, null, 2)
  return text === undefined ? 'null' : text
}

function toolError(error) {
  return {
    isError: true,
    content: [{ type: 'text', text: jsonText({ error: error?.message || String(error) }) }],
  }
}

function controllerFor(handle) {
  const id = String(handle || '').trim()
  const controller = projects.get(id)
  if (!controller) throw new Error(`unknown project handle: ${id || '(empty)'}`)
  return controller
}

function projectSummary(handle, controller, openedPath = '') {
  const snapshot = controller.get()
  return {
    handle,
    workspace: workspaceRoot,
    path: openedPath ? openedPath.replaceAll('\\', '/') : '',
    name: snapshot.save?.name || '',
    revision: snapshot.version,
    activeAssetType: snapshot.asset?.type || '',
  }
}

async function callTool(name, args = {}, signal) {
  if (name === 'qxqy_project_open') {
    const handle = `project-${nextHandle++}`
    const controller = new SimulatorController(workspaceRoot)
    try {
      const path = String(args.path || '').trim()
      if (path) controller.loadArchive(path)
      projects.set(handle, controller)
      return projectSummary(handle, controller, path)
    } catch (error) {
      await controller.dispose()
      throw error
    }
  }

  if (name === 'qxqy_studio_load' && !args.handle && !args.path) {
    return listWorkspaceArchives(workspaceRoot)
  }

  const controller = controllerFor(args.handle)
  return controller.exclusive(async () => {
    if (name === 'qxqy_project_save') return controller.saveArchive(args.path)
    if (name === 'qxqy_studio_get') return controller.get()
    if (name === 'qxqy_studio_patch') return controller.patch(args.op)
    if (name === 'qxqy_studio_play') return controller.play(args.action, args.args || {}, signal)
    if (name === 'qxqy_studio_ui_screenshot') return controller.uiScreenshot()
    if (name === 'qxqy_studio_play_screenshot') return controller.playScreenshot(signal)
    if (name === 'qxqy_studio_load') {
      return args.path ? controller.loadArchive(args.path) : controller.listArchives()
    }
    throw new Error(`unknown tool: ${name}`)
  })
}

function contentFor(value) {
  if (value && Buffer.isBuffer(value.data)) {
    const { data, ...metadata } = value
    return {
      content: [
        { type: 'text', text: jsonText(metadata) },
        { type: 'image', data: data.toString('base64'), mimeType: 'image/png' },
      ],
      structuredContent: metadata,
    }
  }
  const result = { content: [{ type: 'text', text: jsonText(value) }] }
  if (value && typeof value === 'object' && !Array.isArray(value)) result.structuredContent = value
  return result
}

async function handleRequest(request) {
  const method = request?.method
  const params = request?.params || {}
  if (method === 'initialize') {
    return {
      protocolVersion: negotiateProtocolVersion(params.protocolVersion),
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
      instructions: 'Optionally call qxqy_studio_load without a handle to find saves, then use qxqy_project_open. Keep the returned handle and call qxqy_project_save after edits. Paths are workspace-relative.',
    }
  }
  if (method === 'ping') return {}
  if (method === 'tools/list') return { tools }
  if (method === 'tools/call') {
    const name = String(params.name || '')
    if (!tools.some((tool) => tool.name === name)) throw new Error(`unknown tool: ${name || '(empty)'}`)
    return contentFor(await callTool(name, params.arguments || {}, params.signal))
  }
  throw Object.assign(new Error(`method not found: ${method || '(empty)'}`), { code: -32601 })
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

function sendError(id, error, code = -32603) {
  send({ jsonrpc: '2.0', id: id ?? null, error: { code, message: error?.message || String(error) } })
}

async function dispatch(request) {
  if (!request || request.jsonrpc !== '2.0' || typeof request.method !== 'string') {
    sendError(request?.id, new Error('invalid JSON-RPC request'), -32600)
    return
  }
  if (request.method === 'notifications/initialized' || request.method === 'notifications/cancelled') {
    if (request.method === 'notifications/cancelled') {
      const cancelled = requests.get(request.params?.requestId)
      cancelled?.abort()
    }
    return
  }
  if (request.id === undefined || request.id === null) return
  const abort = new AbortController()
  requests.set(request.id, abort)
  try {
    const result = await handleRequest({ ...request, params: { ...(request.params || {}), signal: abort.signal } })
    send({ jsonrpc: '2.0', id: request.id, result })
  } catch (error) {
    if (error?.code === -32601) sendError(request.id, error, -32601)
    else if (request.method === 'tools/call') send({ jsonrpc: '2.0', id: request.id, result: toolError(error) })
    else sendError(request.id, error)
  } finally {
    requests.delete(request.id)
  }
}

let input = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  input += chunk
  let newline
  while ((newline = input.indexOf('\n')) >= 0) {
    const line = input.slice(0, newline).trim()
    input = input.slice(newline + 1)
    if (!line) continue
    try {
      void dispatch(JSON.parse(line))
    } catch {
      sendError(null, new Error('invalid JSON'), -32700)
    }
  }
})

async function dispose() {
  await Promise.all([...projects.values()].map((controller) => controller.dispose()))
  projects.clear()
}

process.once('SIGINT', () => { void dispose().finally(() => process.exit(0)) })
process.once('SIGTERM', () => { void dispose().finally(() => process.exit(0)) })
process.stdin.on('end', () => { void dispose() })
