import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import { createStudio } from '../index.js'
import { composeControlGuidChanges, planLuaGuidReplacements } from '../control-guid-lua.js'
import { contentHash } from './script-sync.js'
import { resolveWorkspaceFile, resolveWorkspaceOutput } from './workspace.js'

function replaceFile(path, source) {
  const temp = `${path}.${randomUUID()}.tmp`
  try { writeFileSync(temp, source, { flag: 'wx' }); renameSync(temp, path) }
  finally { rmSync(temp, { force: true }) }
}

// Editing project sources is separate from copying scripts into the game.
// The latter continues to use ScriptSync and its explicit device preview.
export class ControlGuidSync {
  constructor(controller) { this.controller = controller; this.plan = null }

  inspect() {
    const archive = this.controller.studio.archiveData()
    const changes = archive.controlGuidChanges || []
    const scripts = archive.assets.scripts
    const issues = []
    let mapping = new Map()
    if (!changes.length) issues.push('没有待同步的索引变更')
    try { mapping = composeControlGuidChanges(changes) } catch (error) { issues.push(error.message) }
    const workspace = this.controller.activeWorkspacePath()
    if (!workspace) issues.push('请先绑定工作区，以保存同步前的备份')
    const files = new Map()
    const rows = scripts.map(script => {
      const row = { id: script.id, path: script.path, source: script.source, file: '', fileBefore: null, edits: [], issues: [] }
      if (script.path) {
        try {
          if (!workspace) throw new Error('工作区尚未绑定，无法核对项目脚本文件')
          const output = resolveWorkspaceOutput(workspace, script.path)
          if (existsSync(output)) {
            row.file = resolveWorkspaceFile(workspace, script.path)
            const bytes = readFileSync(row.file)
            row.fileBefore = bytes.toString('utf8')
            if (!bytes.equals(Buffer.from(row.fileBefore))) throw new Error('项目脚本不是有效 UTF-8，请交给 AI 核对编码')
            if (script.source.trim() && row.fileBefore !== script.source) throw new Error('存档源码与项目文件不同，请交给 AI 合并后同步')
            if (!script.source.trim()) row.source = row.fileBefore
            if (files.has(row.file)) throw new Error('多个脚本指向同一个项目文件，请交给 AI 核对')
            files.set(row.file, script.id)
          }
        } catch (error) { row.issues.push({ line: 0, reason: error.message }) }
      }
      if (!row.source.trim() && script.path && !row.file) row.issues.push({ line: 0, reason: '找不到此脚本的源码，请交给 AI 核对文件路径' })
      const result = planLuaGuidReplacements(row.source, mapping)
      row.source = result.source
      row.edits = result.edits
      row.issues.push(...result.issues)
      return row
    })
    const fingerprint = contentHash(JSON.stringify({ archive, files: rows.map(r => [r.file, r.fileBefore]) }))
    return { archive, rows, issues, fingerprint }
  }

  preview() {
    const plan = this.inspect()
    plan.id = randomUUID()
    this.plan = plan
    return {
      id: plan.id, canApply: !plan.issues.length && plan.rows.every(row => !row.issues.length),
      issues: plan.issues, changes: plan.archive.controlGuidChanges.length,
      replacements: plan.rows.reduce((sum, row) => sum + row.edits.length, 0),
      rows: plan.rows.map(({ id, path, file, edits, issues }) => ({ id, path, file, edits, issues })),
    }
  }

  apply({ planId, expectedRevision }) {
    const plan = this.plan
    if (!plan || plan.id !== planId) throw new Error('请先预览 Lua 索引同步')
    if (expectedRevision !== this.controller.get().version) throw new Error('revision conflict: 请重新预览')
    const fresh = this.inspect()
    if (fresh.fingerprint !== plan.fingerprint) throw new Error('源码、文件或索引已变化，请重新预览')
    if (plan.issues.length || plan.rows.some(row => row.issues.length)) throw new Error('源码文件或索引映射存在冲突，请交给 AI 核对；本次没有修改脚本')
    // Validate the complete replacement archive before touching any files.
    const candidate = createStudio(plan.archive)
    for (const row of plan.rows.filter(row => row.edits.length)) candidate.patch({ op: 'updateScript', id: row.id, source: row.source })
    candidate.patch({ op: 'acknowledgeControlGuidChanges', changeIds: plan.archive.controlGuidChanges.map(row => row.id) })
    const encoded = Buffer.from(JSON.stringify(candidate.archiveData())).toString('base64')
    const changed = plan.rows.filter(row => row.edits.length && row.file)
    const workspace = this.controller.activeWorkspacePath()
    const backupRoot = changed.length ? resolveWorkspaceOutput(workspace, `.qxqy-guid-sync-backups/${plan.id}`) : ''
    const written = []
    try {
      for (const row of changed) {
        const backup = join(backupRoot, `${row.id}.lua`)
        mkdirSync(dirname(backup), { recursive: true })
        writeFileSync(backup, row.fileBefore, { flag: 'wx' })
      }
      // Include the pending ledger and inline code, even when no file exists.
      const archiveBackup = resolveWorkspaceOutput(workspace, `.qxqy-guid-sync-backups/${plan.id}/before.save.json`)
      mkdirSync(dirname(archiveBackup), { recursive: true })
      writeFileSync(archiveBackup, JSON.stringify(plan.archive), { flag: 'wx' })
      for (const row of changed) { replaceFile(row.file, row.source); written.push(row) }
      this.controller.studio.importData('json', encoded)
    } catch (error) {
      const failed = []
      for (const row of written.reverse()) { try { replaceFile(row.file, row.fileBefore) } catch { failed.push(row.file) } }
      this.plan = null
      throw new Error(`${error.message}${failed.length ? `；回滚失败，请从 ${backupRoot} 恢复：${failed.join('、')}` : '；存档未提交，已写入的项目文件已回滚'}`)
    }
    this.plan = null
    return { ...this.controller.get(), controlGuidSyncResult: {
      replacements: plan.rows.reduce((sum, row) => sum + row.edits.length, 0),
      scripts: plan.rows.filter(row => row.edits.length).length, projectFiles: changed.length,
      backupRoot: `.qxqy-guid-sync-backups/${plan.id}`,
    } }
  }
}
