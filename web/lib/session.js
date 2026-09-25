import { statSync } from 'node:fs'
import manifest from '../package.json' with { type: 'json' }
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
  constructor({ workspace, initialPath = '', watchIntervalMs = 700, discoveryIntervalMs = 5000 } = {}) {
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
    this.discoveryIntervalMs = Math.max(100, Number(discoveryIntervalMs) || 5000)
    this.archiveCache = null
    this.archiveCacheTime = 0
    this.openGeneration = 0
    this.disposed = false
  }

  async initialize() {
    const archives = this.archives().archives
    const path = this.initialPath || archives[0]?.path || ''
    if (path) {
      try { await this.open(path, 'startup') } catch { /* Keep the page available to show the error and retry. */ }
    }
    this.timer = setInterval(() => { void this.refreshFromDisk() }, this.watchIntervalMs)
    return this.state()
  }

  archives(force = false) {
    if (force || !this.archiveCache || Date.now() - this.archiveCacheTime >= this.discoveryIntervalMs) {
      this.archiveCache = listWorkspaceArchives(this.workspace)
      this.archiveCacheTime = Date.now()
    }
    return this.archiveCache
  }

  previewStatus() {
    const snapshot = this.controller.get()
    return {
      service: 'beyond-simulator-web',
      version: manifest.version,
      workspace: this.workspace,
      activePath: this.activePath,
      lastLoadedAt: this.lastLoadedAt,
      lastError: this.lastError,
      revision: this.activePath ? snapshot.version : null,
      name: this.activePath ? snapshot.save?.name || '' : '',
    }
  }

  state() {
    const listing = this.archives()
    return {
      ...this.previewStatus(),
      archives: listing.archives,
      discovery: listing.discovery,
      snapshot: compactSnapshot(this.controller.get()),
      play: this.playState,
    }
  }

  recordError(error) {
    const message = error?.message || String(error)
    const changed = message !== this.lastError
    this.lastError = message
    if (changed) this.emit({ type: 'error', error: message })
  }

  async open(path, reason = 'manual', expectedGeneration = this.openGeneration) {
    const requestedPath = normalizePath(path)
    if (!requestedPath) throw new Error('path is required')
    return this.controller.exclusive(async () => {
      if (this.disposed || (reason === 'external-change' && expectedGeneration !== this.openGeneration)) return this.state()
      try {
        await this.controller.play('stop')
        this.playState = playSummary(this.playState, { running: false, logs: [] }, 'stop')
        // Stamp before reading: a concurrent disk write must trigger another reload.
        const stamp = fileStamp(this.workspace, requestedPath)
        const value = this.controller.loadArchive(requestedPath)
        this.activePath = requestedPath
        this.activeStamp = stamp
        this.initialPath = ''
        this.openGeneration++
        this.lastLoadedAt = new Date().toISOString()
        this.lastError = ''
        this.archiveCache = null
        this.emit({ type: 'archive', reason, path: requestedPath, revision: value.version })
        return this.state()
      } catch (error) {
        this.recordError(error)
        throw error
      }
    })
  }

  async refreshFromDisk() {
    if (this.refreshing || this.disposed) return false
    this.refreshing = true
    try {
      // Startup with an empty workspace leaves activePath blank. The preview
      // promises that a later Codex/MCP save will appear on its own, so keep
      // scanning until the first archive exists. After that, only the open
      // file is watched; switching archives stays manual.
      if (!this.activePath) {
        const newest = this.initialPath || this.archives().archives[0]?.path || ''
        if (!newest) return false
        await this.open(newest, 'external-change')
        return true
      }
      const nextStamp = fileStamp(this.workspace, this.activePath)
      if (nextStamp === this.activeStamp && !this.lastError) return false
      await this.open(this.activePath, 'external-change')
      return true
    } catch (error) {
      this.recordError(error)
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
    this.disposed = true
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.listeners.clear()
    await this.controller.exclusive(() => this.controller.dispose())
  }
}
