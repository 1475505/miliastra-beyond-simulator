import { existsSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { SimulatorController } from 'qxqy-studio/host/controller'
import { resolveWorkspaceFile, resolveWorkspaceOutput } from 'qxqy-studio/host/workspace'

const ACTIONS = new Set(['get', 'patch', 'import', 'export', 'archives', 'load-archive', 'save', 'play', 'script-sync', 'script-sync-apply'])
const stamp = path => createHash('sha256').update(readFileSync(path)).digest('hex')

// One trusted operator, with independent editor tabs and their play windows.
// These identifiers are not tenant authorization; network access is authenticated.
export class EditorSessions {
  constructor(workspace, { initialPath = '', maxSessions = 8 } = {}) {
    this.workspace = workspace
    this.initialPath = initialPath
    this.maxSessions = maxSessions
    this.sessions = new Map()
  }

  getSession(id) {
    if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(id)) throw new Error('Invalid editor sessionId')
    if (!this.sessions.has(id)) {
      if (this.sessions.size >= this.maxSessions) throw new Error('Editor session limit reached; save your work and restart the server')
      const controller = new SimulatorController(this.workspace)
      const row = { controller, path: '', fileStamp: '' }
      if (this.initialPath) this.load(row, this.initialPath)
      this.sessions.set(id, row)
    }
    return this.sessions.get(id)
  }

  snapshot(row) {
    return { ...row.controller.get(), storage: { path: row.path } }
  }

  load(row, path) {
    const absolute = resolveWorkspaceFile(this.workspace, path)
    const result = row.controller.loadArchive(path)
    row.path = String(path).replaceAll('\\', '/')
    row.fileStamp = stamp(absolute)
    return { ...result, snapshot: this.snapshot(row) }
  }

  async call(action, body, signal) {
    if (!ACTIONS.has(action)) throw new Error('Unknown editor action')
    const row = this.getSession(body.sessionId)
    const controller = row.controller
    return controller.exclusive(async () => {
      if (action === 'get') return this.snapshot(row)
      if (action === 'script-sync') return controller.scriptSyncAction(body.action, body.args || {})
      if (action === 'script-sync-apply') return controller.scriptSync.apply(body)
      if (action === 'archives') return controller.listArchives()
      if (action === 'patch') {
        if (!Number.isInteger(body.op?.expectedRevision)) throw new Error('expectedRevision is required')
        controller.patch(body.op)
        return this.snapshot(row)
      }
      if (action === 'export') return controller.studio.exportData(body.format, body.assetType)
      if (action === 'play') return controller.play(body.action, body.args || {}, signal)
      if (action === 'load-archive' || action === 'import') {
        await controller.play('stop')
        if (action === 'load-archive') return this.load(row, body.path)
        const result = controller.studio.importData(body.format, body.data, body.filename)
        row.path = ''
        row.fileStamp = ''
        return { ...result, snapshot: this.snapshot(row) }
      }
      if (action === 'save') {
        if (body.expectedRevision !== controller.get().version) throw new Error('revision conflict: reload before saving')
        const absolute = resolveWorkspaceOutput(this.workspace, body.path)
        if (existsSync(absolute)) {
          const original = row.path ? resolveWorkspaceOutput(this.workspace, row.path) : ''
          if (absolute !== original || stamp(absolute) !== row.fileStamp) {
            throw new Error('File changed or already exists; load it again or save under a new path')
          }
        }
        const result = controller.saveArchive(body.path)
        row.path = result.path
        row.fileStamp = stamp(absolute)
        return result
      }
    })
  }

  async dispose() {
    await Promise.all([...this.sessions.values()].map(row => row.controller.exclusive(() => row.controller.dispose())))
    this.sessions.clear()
  }
}
