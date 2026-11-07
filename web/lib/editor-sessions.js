import { createHash } from 'node:crypto'
import { deflateSync, inflateSync } from 'node:zlib'
import { createStudio } from 'qxqy-studio'
import { SimulatorController } from 'qxqy-studio/host/controller'
import { createQuickStartSource } from 'qxqy-studio/host/quick-start-source'

const ACTIONS = new Set(['get', 'patch', 'import', 'export', 'export-list', 'export-preview', 'archives', 'load-archive', 'save', 'play', 'script-sync', 'script-sync-apply', 'image-refresh'])

// One trusted operator, with independent editor tabs and their play windows.
// These identifiers are not tenant authorization; network access is authenticated.
export class EditorSessions {
  constructor(workspace, options = {}) {
    const { initialPath = '', maxSessions = 8, imageAssets } = options
    this.workspace = workspace
    this.initialPath = initialPath
    // A warm-controller budget, not a lifetime limit on browser tabs.
    this.maxSessions = Math.max(1, Math.floor(Number(maxSessions) || 8))
    this.sequence = 0
    this.sessions = new Map()
    this.imageAssets = imageAssets
    this.quickStart = createQuickStartSource(options)
    this.quickStartPending = new Map()
    this.idleMs = options.sessionIdleMs ?? 15 * 60_000
    this.now = options.now || Date.now
    this.sweeper = setInterval(() => { void this.sweepIdle().catch(error => console.error('Editor session cleanup failed', error)) }, 60_000)
    this.sweeper.unref()
  }

  getSession(id) {
    if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(id)) throw new Error('Invalid editor sessionId')
    if (!this.sessions.has(id)) {
      const controller = new SimulatorController(this.workspace, { imageAssets: this.imageAssets })
      const row = { controller, inFlight: 0 }
      if (this.initialPath) this.load(row, this.initialPath)
      this.sessions.set(id, row)
    }
    const row = this.sessions.get(id)
    if (!row.controller) {
      const state = JSON.parse(inflateSync(row.parked).toString('utf8'))
      const controller = new SimulatorController(this.workspace, { imageAssets: this.imageAssets })
      controller.studio = createStudio(state.archive, { workspacePath: this.workspace, restoreSession: true })
      Object.assign(controller, state.storage)
      Object.assign(controller.scriptSync, state.scriptSync)
      controller.controlGuidSync.plan = state.guidPlan
      row.controller = controller
      row.parked = null
    }
    row.used = ++this.sequence
    row.touched = this.now()
    this.trimSessions(row)
    return row
  }

  trimSessions(keep) {
    const warm = [...this.sessions.values()].filter(row => row.controller)
    let excess = warm.length - this.maxSessions
    for (const row of warm.sort((a, b) => a.used - b.used)) {
      if (excess <= 0) break
      const c = row.controller
      // Pending requests and live play windows retain their controller/Worker.
      if (row === keep || row.inFlight || c.worker || c.pending.size) continue
      const parked = deflateSync(Buffer.from(JSON.stringify({
        archive: c.studio.archiveData(),
        storage: { archivePath: c.archivePath, archiveStamp: c.archiveStamp, savedArchive: c.savedArchive },
        scriptSync: { plan: c.scriptSync.plan, lastResult: c.scriptSync.lastResult },
        guidPlan: c.controlGuidSync.plan,
      })))
      row.migrationWarnings ??= c.get().migrationWarnings
      row.parked = parked
      row.controller = null
      excess--
    }
  }

  async sweepIdle() {
    await Promise.all([...this.sessions.values()].map(async row => {
      const c = row.controller
      if (!c?.worker || row.inFlight || this.now() - row.touched < this.idleMs) return
      row.inFlight++
      try { await c.exclusive(() => c.dispose()) } finally { row.inFlight-- }
    }))
    this.trimSessions()
  }

  snapshot(row) {
    return { ...row.controller.get(), ...(row.migrationWarnings ? { migrationWarnings: row.migrationWarnings } : {}), ...(row.quickStart ? { quickStart: row.quickStart } : {}) }
  }

  load(row, path) {
    const result = row.controller.loadArchive(path)
    row.migrationWarnings = null
    row.quickStart = null
    return { ...result, snapshot: this.snapshot(row) }
  }

  async call(action, body, signal) {
    if (action === 'quick-start-info') return this.quickStart.info
    if (action === 'quick-start-open') return this.openQuickStart(body.sessionId, signal)
    if (!ACTIONS.has(action)) throw new Error('Unknown editor action')
    const row = this.getSession(body.sessionId)
    const controller = row.controller
    row.inFlight++
    try { return await controller.exclusive(async () => {
      if (action === 'get') return this.snapshot(row)
      if (action === 'image-refresh') {
        await controller.imageAssets.refresh(body.imageId, { imageSource: body.imageSource })
        return { imageId: body.imageId, imageSource: body.imageSource || 'StaticReference', refreshed: true }
      }
      if (action === 'script-sync') return controller.scriptSyncAction(body.action, body.args || {})
      if (action === 'script-sync-apply') return controller.scriptSync.apply(body)
      if (action === 'archives') return controller.listArchives()
      if (action === 'patch') {
        if (!Number.isInteger(body.op?.expectedRevision)) throw new Error('expectedRevision is required')
        return { ...controller.patch(body.op), ...(row.quickStart ? { quickStart: row.quickStart } : {}) }
      }
      if (action === 'export-list') return controller.exportAction('list')
      if (action === 'export-preview') return controller.exportAction('preview', body)
      if (action === 'export') return controller.exportData(body.format, body.assetType, body)
      if (action === 'play') return controller.play(body.action, body.args || {}, signal)
      if (action === 'load-archive' || action === 'import') {
        await controller.play('stop')
        if (action === 'load-archive') return this.load(row, body.path)
        const result = controller.importData(body.format, body.data, body.filename)
        row.migrationWarnings = null
        row.quickStart = null
        return { ...result, snapshot: this.snapshot(row) }
      }
      if (action === 'save') return controller.saveArchiveChecked(body.path, body.expectedRevision)
    }) } finally {
      row.inFlight--
      row.touched = this.now()
      this.trimSessions()
    }
  }

  async openQuickStart(originalId, signal) {
    const original = this.getSession(originalId)
    if (original.quickStart) return { sessionId: originalId, snapshot: this.snapshot(original) }
    const id = `intro_${createHash('sha256').update(originalId).digest('hex').slice(0, 32)}`
    const existing = this.sessions.get(id)
    if (existing?.quickStart) return { sessionId: id, snapshot: this.snapshot(this.getSession(id)) }
    if (existing) throw new Error('教学会话已用于其他工程，请先保存并重新打开编辑页')
    if (this.quickStartPending.has(id)) return this.quickStartPending.get(id)
    const pending = (async () => {
      const data = await this.quickStart.load(signal)
      if (this.sessions.has(id)) throw new Error('教学会话已用于其他工程，请先保存并重新打开编辑页')
      const controller = new SimulatorController(this.workspace, { imageAssets: this.imageAssets })
      try {
        controller.importData('json', data, 'flappy-fish.save.json')
        const row = { controller, inFlight: 0, used: ++this.sequence, touched: this.now(), quickStart: {
          ...this.quickStart.info, originalId,
          savePath: `tutorials/flappy-fish-${id.slice(-8)}.save.json`,
        } }
        this.sessions.set(id, row)
        this.trimSessions(row)
        return { sessionId: id, snapshot: this.snapshot(row) }
      } catch (error) {
        await controller.dispose()
        throw error
      }
    })().finally(() => this.quickStartPending.delete(id))
    this.quickStartPending.set(id, pending)
    return pending
  }

  async dispose() {
    clearInterval(this.sweeper)
    await Promise.allSettled(this.quickStartPending.values())
    await Promise.all([...this.sessions.values()].filter(row => row.controller).map(({ controller }) => controller.exclusive(() => controller.dispose())))
    this.sessions.clear()
  }
}
