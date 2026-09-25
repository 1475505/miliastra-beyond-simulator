import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { basename, relative } from 'node:path'
import { SimulatorController as SharedSimulatorController } from 'qxqy-studio/host/controller'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { listWorkspaceArchives, resolveWorkspaceArchive } from './workspace-archives.js'

export const name = 'qxqy-simulator'
export const inject = ['tools', 'webServer']

const API_PREFIX = '/qxqy-simulator/api'
const PLAY_PATH = '/qxqy-simulator/play'
const PLAY_RENDERER_PATH = '/qxqy-simulator/play-renderer.js'
// Pixel-art-heavy QXQY saves can exceed 2 MiB before base64 transport.
// Keep the local import endpoint comfortably above the current paper-theater bundle.
const MAX_BODY_BYTES = 8 * 1024 * 1024
const MAX_SESSIONS = 32
const SCREENSHOT_TIMEOUT_MS = 8_000

// DSH only adapts session-specific concerns (touch bookkeeping, JSON-string
// tool arguments and its localized workspace errors).  The Studio controller
// owns the actual worker lifecycle and play protocol for every host.
export class SimulatorController extends SharedSimulatorController {
  constructor(workspacePath = '') {
    super(workspacePath)
    this.touchedAt = Date.now()
  }

  touch() {
    this.touchedAt = Date.now()
  }

  get() {
    this.touch()
    return super.get()
  }

  patch(op) {
    this.touch()
    // 宿主可能以 JSON 字符串递参；在控制器入口统一收敛，工具层与 HTTP 层共用。
    return super.patch(jsonParam(op))
  }

  exportData(format, assetType) {
    this.touch()
    return this.studio.exportData(format, assetType)
  }

  importData(format, data, filename) {
    this.touch()
    return this.studio.importData(format, data, filename)
  }

  listArchives() {
    this.touch()
    return listWorkspaceArchives(this.studio.get().workspace?.path || '')
  }

  loadArchive(path) {
    this.touch()
    const workspace = this.studio.get().workspace?.path || ''
    const abs = resolveWorkspaceArchive(workspace, path)
    const bytes = readFileSync(abs)
    const result = this.studio.importData('json', bytes.toString('base64'), basename(abs))
    this.archivePath = relative(realpathSync(workspace), abs).replaceAll('\\', '/')
    return result
  }

  async play(action, rawArgs = {}, signal) {
    this.touch()
    return super.play(action, jsonParam(rawArgs) || {}, signal)
  }

  async requestScreenshot(signal) {
    const image = await super.playScreenshot(signal)
    return {
      ...image,
      capturedAt: new Date().toISOString(),
    }
  }

  requestUiScreenshot() {
    this.touch()
    const image = super.uiScreenshot()
    return {
      ...image,
      capturedAt: new Date().toISOString(),
    }
  }

  async dispose() {
    await this.terminateWorker()
  }
}

function sessionIdOf(value) {
  const id = String(value || '').trim()
  if (!id || id.length > 256) throw new Error('sessionId is required')
  return id
}

// 宿主可能把 type:'json' 参数按 JSON 字符串原样递给 execute（不同 dsh-tools 版本行为不一）。
// 统一在这里收敛：对象原样返回，字符串尝试解析，解析失败视为未提供。
export function jsonParam(value) {
  if (value === null || value === undefined) return undefined
  if (typeof value !== 'string') return value
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' ? parsed : undefined
  } catch {
    return undefined
  }
}

function toolSessionId(exec) {
  return sessionIdOf(exec?.agent?.id)
}

export function headerWorkspace(header) {
  const cwd = header?.cwd
  return typeof cwd === 'string' && cwd ? cwd : ''
}

// 会话创建时的工作区（DSH Session.header.cwd）。读取失败或宿主未提供时返回空串，
// 编辑器保持「未绑定」，不再回退到插件进程启动目录。
export function sessionWorkspace(exec) {
  return headerWorkspace(exec?.agent?.session?.header)
}

export async function lookupSessionWorkspace(sessionId, services = {}) {
  const live = services.sessions?.get?.(sessionId)
  const liveCwd = headerWorkspace(live?.header)
  if (liveCwd) return liveCwd
  const inspect = services.sessionPersistence?.inspect
  if (typeof inspect !== 'function') return ''
  try {
    const inspection = await inspect.call(services.sessionPersistence, sessionId)
    return headerWorkspace(inspection?.meta)
  } catch {
    return ''
  }
}

function createRegistry() {
  const sessions = new Map()
  function prune() {
    if (sessions.size < MAX_SESSIONS) return
    const oldest = [...sessions.entries()].sort((a, b) => a[1].touchedAt - b[1].touchedAt)[0]
    if (oldest) {
      sessions.delete(oldest[0])
      void oldest[1].dispose()
    }
  }
  return {
    get(sessionId, workspacePath = '') {
      const id = sessionIdOf(sessionId)
      let controller = sessions.get(id)
      if (!controller) {
        prune()
        controller = new SimulatorController(workspacePath)
        sessions.set(id, controller)
      } else if (workspacePath) {
        // 编辑页可能先于任何工具调用创建会话（此时只知道宿主 cwd），
        // 首个工具调用到达时补齐真正的会话工作区。
        controller.studio.setWorkspace(workspacePath)
      }
      controller.touch()
      return controller
    },
    async dispose() {
      await Promise.all([...sessions.values()].map((controller) => controller.dispose()))
      sessions.clear()
    },
  }
}

function sendJson(response, status, body) {
  const text = JSON.stringify(body)
  response.statusCode = status
  response.setHeader('content-type', 'application/json; charset=utf-8')
  response.setHeader('cache-control', 'no-store')
  response.end(text)
}

function loadPlayHtml() {
  if (!playHtmlCache) {
    const candidates = [
      new URL('./play.html', import.meta.url),
      new URL('../lib/play.html', import.meta.url),
    ]
    const hit = candidates.find((url) => existsSync(url))
    if (!hit) throw new Error('standalone play page is missing')
    playHtmlCache = readFileSync(hit, 'utf8')
  }
  return playHtmlCache
}

let playHtmlCache = null

function loadPlayRenderer() {
  // The browser page must consume the bundled ESM output: bare `pixi.js`
  // imports in lib/ are only source code and are not browser-resolvable.
  if (!playRendererCache) {
    const candidates = [
      new URL('../dist/play-renderer.js', import.meta.url),
      new URL('./play-renderer.js', import.meta.url),
    ]
    const hit = candidates.find((url) => existsSync(url))
    if (!hit) throw new Error('standalone play renderer bundle is missing; run npm run build')
    playRendererCache = readFileSync(hit, 'utf8')
  }
  return playRendererCache
}

let playRendererCache = null

function registerPlayPage(ctx) {
  ctx.webServer.register({
    kind: 'prefix',
    path: PLAY_PATH,
    handler(request, response) {
      const path = new URL(request.url, 'http://localhost').pathname.replace(/\/$/, '')
      if (request.method !== 'GET' || path !== PLAY_PATH) {
        response.statusCode = request.method === 'GET' ? 404 : 405
        response.setHeader('content-type', 'text/plain; charset=utf-8')
        response.end(request.method === 'GET' ? 'not found' : 'GET required')
        return
      }
      response.statusCode = 200
      response.setHeader('content-type', 'text/html; charset=utf-8')
      response.setHeader('cache-control', 'no-store')
      response.setHeader('x-content-type-options', 'nosniff')
      response.end(loadPlayHtml())
    },
  })
}

function registerPlayRenderer(ctx) {
  ctx.webServer.register({
    kind: 'exact',
    path: PLAY_RENDERER_PATH,
    handler(request, response) {
      if (request.method !== 'GET') {
        response.statusCode = 405
        response.setHeader('content-type', 'text/plain; charset=utf-8')
        response.end('GET required')
        return
      }
      try {
        response.statusCode = 200
        response.setHeader('content-type', 'text/javascript; charset=utf-8')
        response.setHeader('cache-control', 'no-store')
        response.setHeader('x-content-type-options', 'nosniff')
        response.end(loadPlayRenderer())
      } catch (error) {
        response.statusCode = 500
        response.setHeader('content-type', 'text/plain; charset=utf-8')
        response.end(error?.message || String(error))
      }
    },
  })
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    request.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('request body is too large'))
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8')
        resolve(text ? JSON.parse(text) : {})
      } catch {
        reject(new Error('invalid JSON body'))
      }
    })
    request.on('error', reject)
  })
}

function registerTools(ctx, registry) {
  ctx.tools.register(defineTool({
    name: 'qxqy_studio_get',
    description: '读取当前 DeepSeek Harness 会话的千星 UI 编辑器无损 JSON 快照。',
    parameters: {},
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    timeoutMs: 5_000,
    isConcurrencySafe: () => true,
    async execute(_args, exec) {
      return registry.get(toolSessionId(exec), sessionWorkspace(exec)).get()
    },
  }))

  ctx.tools.register(defineTool({
    name: 'qxqy_studio_play_screenshot',
    description: '获取当前试玩 Runtime 画面的 PNG。Host 与独立试玩页共用 Runtime scene 树（同级先出现的子节点在上）再画成 PNG，不需要打开试玩页或切换标签。仅在需要观察运行时画面、动画或交互结果时调用；若要看编辑器舞台，请改用 qxqy_studio_ui_screenshot。不会步进时间，也不替代 get {inspect:true} 的结构化断言。',
    parameters: {},
    output: {
      schema: { type: 'json' },
      render: (_args, value) => {
        const text = `试玩截图：${value.canvasId || 'unknown'}，Frame ${value.frame ?? 0}，${value.width || 0}×${value.height || 0}`
        const content = [{ type: 'text', text }]
        if (value.image) content.push({ type: 'image', attachment: value.image })
        return content
      },
    },
    timeoutMs: SCREENSHOT_TIMEOUT_MS + 1_000,
    isConcurrencySafe: () => false,
    async execute(_args, exec) {
      const controller = registry.get(toolSessionId(exec), sessionWorkspace(exec))
      const captured = await controller.requestScreenshot(exec.signal)
      const attachments = ctx.get?.('attachments')
      if (!attachments?.saveImage) throw new Error('Harness attachment service is unavailable; cannot return screenshot to AI')
      const ref = await attachments.saveImage({
        data: captured.data,
        mediaType: 'image/png',
        name: `qxqy-play-${captured.canvasId || 'canvas'}-f${captured.frame}.png`,
      })
      const { data, ...metadata } = captured
      return {
        ...metadata,
        image: {
          attachmentId: ref.attachmentId,
          mediaType: ref.mediaType,
          bytes: ref.bytes,
          width: ref.width,
          height: ref.height,
          ...(ref.name === undefined ? {} : { name: ref.name }),
        },
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'qxqy_studio_ui_screenshot',
    description: '获取当前编辑器舞台的 PNG。Host 根据 boxes 在进程内渲染，不需要打开或保持“模拟器”标签。用于检查静态 UI 布局、选中项和控件图元；不含完整 Chrome DOM 工具栏/检视器。若要看 Lua Runtime 试玩画面，请改用 qxqy_studio_play_screenshot。',
    parameters: {},
    output: {
      schema: { type: 'json' },
      render: (_args, value) => {
        const page = value.page || '模拟器'
        const text = `编辑器截图：${page}，${value.width || 0}×${value.height || 0}`
        const content = [{ type: 'text', text }]
        if (value.image) content.push({ type: 'image', attachment: value.image })
        return content
      },
    },
    timeoutMs: SCREENSHOT_TIMEOUT_MS + 1_000,
    isConcurrencySafe: () => false,
    async execute(_args, exec) {
      const controller = registry.get(toolSessionId(exec), sessionWorkspace(exec))
      const captured = controller.requestUiScreenshot()
      const attachments = ctx.get?.('attachments')
      if (!attachments?.saveImage) throw new Error('Harness attachment service is unavailable; cannot return screenshot to AI')
      const ref = await attachments.saveImage({
        data: captured.data,
        mediaType: 'image/png',
        name: `qxqy-ui-${captured.page || 'editor'}.png`,
      })
      const { data, ...metadata } = captured
      return {
        ...metadata,
        image: {
          attachmentId: ref.attachmentId,
          mediaType: ref.mediaType,
          bytes: ref.bytes,
          width: ref.width,
          height: ref.height,
          ...(ref.name === undefined ? {} : { name: ref.name }),
        },
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'qxqy_studio_patch',
    description: '修改当前会话的千星 UI 工程。op 必须携带 expectedRevision 以防止陈旧写入。',
    parameters: {
      op: { type: 'json', required: true, description: '编辑器 patch 对象。' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    timeoutMs: 5_000,
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const op = jsonParam(args.op)
      if (!op) throw new Error('patch requires op')
      return registry.get(toolSessionId(exec), sessionWorkspace(exec)).patch(op)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'qxqy_studio_play',
    description: '控制当前会话的千星 UI 试玩 Worker：启动、步进、输入、暂停、停止、多设备画布切换、多人视角、服务端变量/信号，以及录制回放用例。',
    parameters: {
      action: {
        type: 'string',
        enum: [
          'start', 'device', 'view', 'get', 'step', 'pointer', 'key', 'click', 'pause', 'resume', 'stop',
          'serverGet', 'serverSet', 'serverSend', 'history', 'saveCase', 'runCase',
        ],
        required: true,
      },
      args: { type: 'json', description: '动作参数；pointer 使用 type/x/y，step 使用 dt；get/start 可用 inspect:true 拉运行树；start/device 用 canvasId 切换设备画布（如 pc-16-9 / mobile-19.5-9）；start 可用 playerCount(1-8)；view 用 playerIndex 切换当前玩家视角；runCase 可带 canvasId/playerCount；serverSet 使用 entityType/name/value；runCase 使用 case。' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    timeoutMs: 10_000,
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const playArgs = jsonParam(args.args) || {}
      return registry.get(toolSessionId(exec), sessionWorkspace(exec)).play(args.action, playArgs, exec.signal)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'qxqy_studio_load',
    description: '从当前会话工作区拉取千星模拟器存档。不传 path 时列出工作区内的 qxqy-simulator-save；传入相对路径则加载该存档。',
    parameters: {
      path: { type: 'string', description: '工作区内相对路径，例如 workspace/flappy-fish/flappy-fish.save.json。省略则只列出可拉取存档。' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    timeoutMs: 8_000,
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const controller = registry.get(toolSessionId(exec), sessionWorkspace(exec))
      if (!args.path) return controller.listArchives()
      return controller.loadArchive(args.path)
    },
  }))
}

function registerApi(ctx, registry) {
  ctx.webServer.register({
    kind: 'prefix',
    path: API_PREFIX,
    async handler(request, response) {
      if (request.method !== 'POST') {
        sendJson(response, 405, { ok: false, value: null, error: 'POST required' })
        return
      }
      const path = new URL(request.url, 'http://localhost').pathname
      const action = path.slice(API_PREFIX.length).replace(/^\/+/, '')
      if (action === 'health') {
        sendJson(response, 200, { ok: true, value: { status: 'ok' }, error: null })
        return
      }
      const abort = new AbortController()
      request.once('aborted', () => abort.abort())
      try {
        const body = await readBody(request)
        const workspacePath = await lookupSessionWorkspace(body.sessionId, {
          sessions: ctx.get?.('sessions'),
          sessionPersistence: ctx.get?.('sessionPersistence'),
        })
        const controller = registry.get(body.sessionId, workspacePath)
        let value
        if (action === 'get') value = controller.get()
        else if (action === 'patch') value = controller.patch(body.op)
        else if (action === 'export') value = controller.exportData(body.format, body.assetType)
        else if (action === 'import') value = controller.importData(body.format, body.data, body.filename)
        else if (action === 'archives') value = controller.listArchives()
        else if (action === 'load-archive') value = controller.loadArchive(body.path)
        else if (action === 'play') value = await controller.play(body.action, body.args || {}, abort.signal)
        else throw new Error('unknown API action')
        sendJson(response, 200, { ok: true, value, error: null })
      } catch (error) {
        sendJson(response, 400, { ok: false, value: null, error: error?.message || String(error) })
      }
    },
  })
}

export function apply(ctx) {
  const registry = createRegistry()
  registerTools(ctx, registry)
  registerApi(ctx, registry)
  registerPlayPage(ctx)
  registerPlayRenderer(ctx)
  ctx.effect(() => () => {
    void registry.dispose()
  }, 'qxqy-simulator: dispose sessions')
}
