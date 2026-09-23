import { statSync } from 'node:fs'
import { CANVAS_PRESETS } from 'qxqy-studio/constants'
import { SimulatorController } from 'qxqy-studio/host/controller'
import {
  listWorkspaceArchives,
  resolveWorkspaceFile,
  resolveWorkspaceRoot,
} from 'qxqy-studio/host/workspace'

const ASSET_TYPES = new Set(['server-control-template', 'client-control-template'])
const PLAY_ACTIONS = new Set([
  'start', 'device', 'view', 'get', 'step', 'pointer', 'key', 'click', 'pause', 'resume', 'stop',
  'serverGet', 'serverSet', 'serverSend', 'history', 'saveCase', 'runCase',
])
function normalizePath(value) {
  return String(value || '').trim().replaceAll('\\', '/')
}

function fileStamp(workspace, path) {
  const stat = statSync(resolveWorkspaceFile(workspace, path))
  return `${stat.size}:${stat.mtimeMs}`
}

function compactSnapshot(snapshot) {
  return {
    version: snapshot.version,
    selectedId: snapshot.selectedId,
    save: snapshot.save,
    asset: snapshot.asset,
    canvas: snapshot.canvas,
    tree: snapshot.tree,
    workspace: snapshot.workspace,
    scriptCount: Array.isArray(snapshot.scripts) ? snapshot.scripts.length : 0,
  }
}

function playSummary(previous, value, action) {
  const stopped = action === 'stop' || value?.running === false
  const logs = Array.isArray(value?.logs) ? value.logs.slice(-100) : previous.logs
  return {
    running: !stopped,
    paused: stopped ? false : Boolean(value?.paused),
    canvasId: String(value?.canvasId || previous.canvasId || ''),
    width: Number(value?.canvasWidth || previous.width || 0),
    height: Number(value?.canvasHeight || previous.height || 0),
    frame: Number(value?.frame || 0),
    time: Number(value?.time || 0),
    logs,
  }
}

export class WebSession {
  constructor({ workspace, initialPath = '', watchIntervalMs = 700 } = {}) {
    this.workspace = resolveWorkspaceRoot(workspace)
    this.controller = new SimulatorController(this.workspace)
    this.initialPath = normalizePath(initialPath)
    this.watchIntervalMs = Math.max(100, Number(watchIntervalMs) || 700)
    this.activePath = ''
    this.activeStamp = ''
    this.lastLoadedAt = ''
    this.lastError = ''
    this.listeners = new Set()
    this.playState = {
      running: false,
      paused: false,
      canvasId: '',
      width: 0,
      height: 0,
      frame: 0,
      time: 0,
      logs: [],
    }
    this.timer = null
    this.refreshing = false
  }

  async initialize() {
    const archives = this.archives().archives
    const path = this.initialPath || archives[0]?.path || ''
    if (path) await this.open(path, 'startup')
    this.timer = setInterval(() => { void this.refreshFromDisk() }, this.watchIntervalMs)
    return this.state()
  }

  archives() {
    return listWorkspaceArchives(this.workspace)
  }

  state() {
    return {
      workspace: this.workspace,
      activePath: this.activePath,
      lastLoadedAt: this.lastLoadedAt,
      lastError: this.lastError,
      archives: this.archives().archives,
      snapshot: compactSnapshot(this.controller.get()),
      play: this.playState,
    }
  }

  async open(path, reason = 'manual') {
    const requestedPath = normalizePath(path)
    if (!requestedPath) throw new Error('path is required')
    this.playState = { ...this.playState, running: false, paused: false }
    const value = await this.controller.exclusive(async () => {
      await this.controller.play('stop')
      return this.controller.loadArchive(requestedPath)
    })
    this.activePath = requestedPath
    this.activeStamp = fileStamp(this.workspace, requestedPath)
    this.lastLoadedAt = new Date().toISOString()
    this.lastError = ''
    this.playState = playSummary(this.playState, { running: false, logs: [] }, 'stop')
    this.emit({ type: 'archive', reason, path: requestedPath, revision: value.version })
    return this.state()
  }

  async refreshFromDisk() {
    if (!this.activePath || this.refreshing) return false
    this.refreshing = true
    try {
      const nextStamp = fileStamp(this.workspace, this.activePath)
      if (nextStamp === this.activeStamp) return false
      await this.open(this.activePath, 'external-change')
      return true
    } catch (error) {
      const message = error?.message || String(error)
      if (message !== this.lastError) this.emit({ type: 'error', error: message })
      this.lastError = message
      return false
    } finally {
      this.refreshing = false
    }
  }

  async setView({ assetType, canvasId } = {}) {
    if (assetType && !ASSET_TYPES.has(assetType)) throw new Error(`unknown asset type: ${assetType}`)
    if (canvasId && !CANVAS_PRESETS[canvasId]) throw new Error(`unknown canvas preset: ${canvasId}`)
    await this.controller.exclusive(async () => {
      if (assetType) this.controller.patch({ op: 'selectAsset', assetType })
      if (canvasId) {
        const revision = this.controller.get().version
        this.controller.patch({ op: 'setCanvas', canvasId, expectedRevision: revision })
      }
    })
    this.emit({ type: 'view' })
    return this.state()
  }

  async play(action, args = {}, signal) {
    if (!PLAY_ACTIONS.has(action)) throw new Error(`unknown play action: ${action || '(empty)'}`)
    const value = await this.controller.exclusive(() => this.controller.play(action, args, signal))
    this.playState = playSummary(this.playState, value, action)
    this.lastError = ''
    this.emit({ type: 'play', action, frame: this.playState.frame })
    // Match the DSH standalone play page: return only the worker snapshot.
    // Editor tree / archive listing stay on /api/state, not the 30 FPS path.
    return value
  }

  async currentState(_signal) {
    return this.state()
  }

  editorScreenshot() {
    return this.controller.uiScreenshot()
  }

  playScreenshot(signal) {
    return this.controller.exclusive(() => this.controller.playScreenshot(signal))
  }

  subscribe(listener) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  emit(event) {
    for (const listener of this.listeners) listener(event)
  }

  async dispose() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.listeners.clear()
    await this.controller.dispose()
  }
}
