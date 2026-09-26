import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative } from 'node:path'
import { normalizeScriptSync, scriptRelativePath } from '../script-sync-config.js'
import { resolveWorkspaceFile, resolveWorkspaceOutput } from './workspace.js'

export const contentHash = value => createHash('sha256').update(value).digest('hex')
const fileHash = path => existsSync(path) ? contentHash(readFileSync(path)) : null
const inside = (root, path) => { const rel = relative(root, path); return !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) }

function targetPath(root, name) {
  const target = resolveWorkspaceOutput(root, name)
  // Copy destinations must be real directories/files, never links into sources.
  let part = target
  while (part !== root) {
    try { if (lstatSync(part).isSymbolicLink()) throw new Error('实机目标不能包含符号链接或目录联接') }
    catch (error) { if (error.code !== 'ENOENT') throw error }
    part = dirname(part)
  }
  if (existsSync(target) && !statSync(target).isFile()) throw new Error('实机目标不是普通文件')
  return target
}

export function discoverScriptDirectories(base = join(homedir(), 'AppData', 'LocalLow', 'miHoYo', '原神', 'BeyondLocal')) {
  const directories = path => { try { return readdirSync(path, { withFileTypes: true }).filter(row => row.isDirectory() && /^\d+$/.test(row.name)).map(row => row.name) } catch { return [] } }
  const candidates = []
  for (const uid of directories(base)) {
    const levels = join(base, uid, 'Beyond_Local_Save_Level')
    for (const editorId of directories(levels)) {
      const path = join(levels, editorId, 'external_lua_file', 'default_import_file')
      if (existsSync(path) && statSync(path).isDirectory()) candidates.push({ uid, editorId, path })
    }
  }
  return { candidates }
}

export class ScriptSync {
  constructor(controller) { this.controller = controller; this.plan = null; this.lastResult = null }

  preview() {
    const controller = this.controller
    const archive = controller.studio.archiveData()
    const config = normalizeScriptSync(archive.scriptSync)
    if (!config) throw new Error('请先配置实机脚本目录')
    const workspace = realpathSync(controller.activeWorkspacePath())
    const root = realpathSync(config.clientImportRoot)
    if (!statSync(root).isDirectory()) throw new Error('实机导入根目录不存在')
    const sourceDir = config.workspaceDir ? resolveWorkspaceFile(workspace, config.workspaceDir) : workspace
    if (!statSync(sourceDir).isDirectory()) throw new Error('工作区脚本目录不存在')
    if (inside(sourceDir, root) || inside(root, sourceDir)) throw new Error('工作区脚本目录与实机目录不能重叠')
    const used = new Map()
    const rows = archive.assets.scripts.map(script => {
      const row = { id: script.id, path: script.path, sourceKind: script.source.trim() ? '存档源码' : '工作区文件' }
      try {
        const path = scriptRelativePath(script.path)
        if (!/\.lua$/i.test(path)) throw new Error('脚本路径必须以 .lua 结尾')
        const prefix = config.workspaceDir ? `${config.workspaceDir}/` : ''
        if (!path.startsWith(prefix)) throw new Error('脚本不在所配置的工作区脚本目录中')
        const targetRelative = [config.clientSubdir, path.slice(prefix.length)].filter(Boolean).join('/')
        const target = targetPath(root, targetRelative)
        const key = target.toLowerCase()
        used.set(key, (used.get(key) || 0) + 1)
        let diskSource = null
        let diskError = ''
        try { diskSource = readFileSync(resolveWorkspaceFile(workspace, path), 'utf8') } catch (error) { diskError = error.message }
        if (!script.source.trim() && diskSource === null) throw new Error(diskError)
        const source = script.source.trim() ? script.source : diskSource
        const beforeHash = fileHash(target)
        return { ...row, target, targetRelative, source, diskSource, diskError, sourceMismatch: Boolean(script.source.trim() && diskSource !== null && script.source !== diskSource), beforeSource: beforeHash === null ? '' : readFileSync(target, 'utf8'), beforeHash, sourceHash: contentHash(source), status: beforeHash === null ? '新增' : beforeHash === contentHash(source) ? '未变化' : '覆盖' }
      } catch (error) { return { ...row, status: '错误', error: error.message } }
    })
    for (const row of rows) {
      if (row.target && used.get(row.target.toLowerCase()) > 1) {
        row.status = '错误'
        row.error = '多个脚本映射到同一目标文件'
      }
    }
    const fingerprint = contentHash(JSON.stringify({ archive, workspace, root, rows }))
    this.plan = { id: randomUUID(), fingerprint, root, workspace, rows, pendingGuidChanges: archive.controlGuidChanges.length, createdAt: new Date().toISOString() }
    return this.plan
  }

  apply({ planId, scriptIds, confirmed }) {
    const plan = this.plan
    if (confirmed !== true || !plan || plan.id !== planId) throw new Error('请先检查差异并确认本次复制')
    const current = this.preview()
    this.plan = null
    if (current.fingerprint !== plan.fingerprint) throw new Error('内容已变化，请重新检查')
    if (plan.pendingGuidChanges) throw new Error('请先核对并确认控件索引的 Lua 引用变更')
    if (!Array.isArray(scriptIds) || !scriptIds.length || new Set(scriptIds).size !== scriptIds.length) throw new Error('请选择要复制的脚本')
    const rows = scriptIds.map(id => {
      const row = plan.rows.find(row => row.id === id)
      if (!row || row.error || row.status === '未变化') throw new Error('所选脚本不能复制，请重新检查')
      return row
    })
    this.controller.assertSavedArchive()
    const backupRelative = `.qxqy-script-sync-backups/${plan.id}`
    const backupRoot = resolveWorkspaceOutput(plan.workspace, backupRelative)
    if (inside(plan.root, backupRoot)) throw new Error('备份目录不能位于实机脚本目录中')
    const results = []
    for (const row of rows) {
      let temporary = ''
      try {
        const target = targetPath(plan.root, row.targetRelative)
        if (fileHash(target) !== row.beforeHash) throw new Error('目标文件已变化，请重新检查')
        if (row.beforeHash !== null) {
          const backup = resolveWorkspaceOutput(plan.workspace, `${backupRelative}/${row.targetRelative}`)
          mkdirSync(dirname(backup), { recursive: true })
          writeFileSync(backup, readFileSync(target), { flag: 'wx' })
        }
        mkdirSync(dirname(target), { recursive: true })
        temporary = join(dirname(target), `.${basename(target)}.${randomUUID()}.tmp`)
        writeFileSync(temporary, row.source, { flag: 'wx' })
        if (fileHash(target) !== row.beforeHash) throw new Error('目标文件已变化，请重新检查')
        renameSync(temporary, target)
        results.push({ id: row.id, target, status: '成功' })
      } catch (error) { results.push({ id: row.id, target: row.target, status: '失败', error: error.message }) }
      finally { if (temporary) rmSync(temporary, { force: true }) }
    }
    this.lastResult = { completed: results.every(row => row.status === '成功'), at: new Date().toISOString(), backupRoot, results }
    return this.lastResult
  }
}
