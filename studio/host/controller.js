import { Worker } from 'node:worker_threads'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname } from 'node:path'
import { createStudio } from '../index.js'
import { renderEditorPng, renderScenePng } from '../host-png.js'
import { CANVAS_PRESETS } from '../constants.js'
import { listWorkspaceArchives, resolveWorkspaceFile, resolveWorkspaceOutput, resolveWorkspaceRoot } from './workspace.js'

// Keep the interactive default short, but allow project replay runners to raise
// it for control-heavy pixel-art scenes and long deterministic golden cases.
const PLAY_TIMEOUT_MS = Math.max(1_000, Number(process.env.QXQY_PLAY_TIMEOUT_MS) || 8_000)
const SCREENSHOT_TIMEOUT_MS = 8_000

function abortError() {
  const error = new Error('operation aborted')
  error.name = 'AbortError'
  return error
}

export class SimulatorController {
  constructor(workspacePath = '') {
    // The DSH adapter can begin before its host exposes a workspace.  Keep the
    // controller usable in that state instead of silently binding it to the
    // process cwd; Web and MCP always pass an explicit workspace.
    this.workspacePath = workspacePath ? resolveWorkspaceRoot(workspacePath) : ''
    this.studio = createStudio(undefined, this.workspacePath ? { workspacePath: this.workspacePath } : undefined)
    this.worker = null
    this.pending = new Map()
    this.sequence = 1
    this.lock = Promise.resolve()
    this.archivePath = ''
  }

  /** Serialize calls for one project handle, including worker operations. */
  async exclusive(task) {
    const previous = this.lock
    let release
    this.lock = new Promise((resolve) => { release = resolve })
    await previous
    try {
      return await task()
    } finally {
      release()
    }
  }

  get() {
    return this.studio.get()
  }

  patch(op) {
    return this.studio.patch(op)
  }

  listArchives() {
    return listWorkspaceArchives(this.workspacePath)
  }

  loadArchive(path) {
    const workspacePath = this.activeWorkspacePath()
    if (!workspacePath) throw new Error('workspace is not bound')
    const absolute = resolveWorkspaceFile(workspacePath, path)
    const bytes = readFileSync(absolute)
    const result = this.studio.importData('json', bytes.toString('base64'), basename(absolute))
    this.archivePath = String(path).trim().replaceAll('\\', '/')
    return result
  }

  saveArchive(path = this.archivePath || 'qxqy-simulator.save.json') {
    const requestedPath = String(path).trim()
    const workspacePath = this.activeWorkspacePath()
    if (!workspacePath) throw new Error('workspace is not bound')
    const absolute = resolveWorkspaceOutput(workspacePath, requestedPath)
    mkdirSync(dirname(absolute), { recursive: true })
    const data = Buffer.from(JSON.stringify(this.studio.archiveData(), null, 2) + '\n', 'utf8')
    writeFileSync(absolute, data)
    this.archivePath = requestedPath.replaceAll('\\', '/')
    return {
      path: this.archivePath,
      bytes: data.length,
      revision: this.studio.get().version,
      name: this.studio.get().save?.name || '',
    }
  }

  activeWorkspacePath() {
    const workspace = this.studio.get().workspace
    return workspace?.bound && workspace.path ? String(workspace.path) : this.workspacePath
  }

  createWorker() {
    const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' })
    worker.on('message', (message) => {
      const pending = this.pending.get(message?.id)
      if (!pending) return
      this.pending.delete(message.id)
      if (message.ok) pending.resolve(message.value)
      else pending.reject(new Error(message.error || 'play worker failed'))
    })
    worker.on('error', (error) => {
      if (this.worker === worker) this.worker = null
      this.rejectPending(error)
    })
    worker.on('exit', (code) => {
      if (this.worker === worker) this.worker = null
      if (code !== 0) this.rejectPending(new Error(`play worker exited with code ${code}`))
    })
    this.worker = worker
    return worker
  }

  rejectPending(error) {
    for (const pending of this.pending.values()) pending.reject(error)
    this.pending.clear()
  }

  async terminateWorker(reason = new Error('play worker terminated')) {
    const worker = this.worker
    this.worker = null
    this.rejectPending(reason)
    if (worker) await worker.terminate().catch(() => {})
  }

  request(action, args, signal, timeoutMs = PLAY_TIMEOUT_MS) {
    const worker = this.worker || this.createWorker()
    const id = this.sequence++
    return new Promise((resolve, reject) => {
      let settled = false
      const finish = (callback, value) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
        callback(value)
      }
      const onAbort = () => {
        this.pending.delete(id)
        finish(reject, abortError())
        void this.terminateWorker(abortError())
      }
      const timer = setTimeout(() => {
        this.pending.delete(id)
        const error = new Error(`play worker timed out after ${timeoutMs}ms`)
        finish(reject, error)
        void this.terminateWorker(error)
      }, timeoutMs)
      this.pending.set(id, {
        resolve: (value) => finish(resolve, value),
        reject: (error) => finish(reject, error),
      })
      if (signal?.aborted) return onAbort()
      signal?.addEventListener('abort', onAbort, { once: true })
      worker.postMessage({ id, action, args })
    })
  }

  async play(action, args = {}, signal) {
    if (action === 'start') {
      await this.terminateWorker()
      return this.request('start', {
        archive: this.studio.archiveData(),
        workspacePath: this.activeWorkspacePath(),
        ...args,
      }, signal)
    }
    if (action === 'device') {
      const canvasId = String(args.canvasId || '').trim()
      if (!CANVAS_PRESETS[canvasId]) {
        throw new Error(`unknown canvas preset: ${canvasId || '(empty)'} (available: ${Object.keys(CANVAS_PRESETS).join(', ')})`)
      }
      await this.terminateWorker()
      return this.request('start', {
        archive: this.studio.archiveData(),
        workspacePath: this.activeWorkspacePath(),
        ...args,
        canvasId,
      }, signal)
    }
    if (action === 'stop') {
      if (!this.worker) return { running: false, tree: [], logs: [] }
      try {
        return await this.request('stop', args, signal)
      } finally {
        await this.terminateWorker()
      }
    }
    if (!this.worker) throw new Error('play session has not started')
    return this.request(action, args, signal)
  }

  async playScreenshot(signal) {
    if (!this.worker) throw new Error('play session has not started')
    const snapshot = await this.request('get', { view: true }, signal, SCREENSHOT_TIMEOUT_MS)
    const image = renderScenePng(snapshot.scene, snapshot.canvasWidth, snapshot.canvasHeight)
    return {
      data: image.data,
      canvasId: String(snapshot.canvasId || ''),
      frame: Number.isFinite(Number(snapshot.frame)) ? Number(snapshot.frame) : 0,
      time: Number.isFinite(Number(snapshot.time)) ? Number(snapshot.time) : 0,
      width: image.width,
      height: image.height,
      pixelWidth: image.pixelWidth,
      pixelHeight: image.pixelHeight,
    }
  }

  uiScreenshot() {
    const image = renderEditorPng(this.studio.get())
    return {
      data: image.data,
      page: image.page,
      width: image.width,
      height: image.height,
      pixelWidth: image.pixelWidth,
      pixelHeight: image.pixelHeight,
    }
  }

  async dispose() {
    await this.terminateWorker()
  }
}
