import { existsSync, realpathSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'
import { listWorkspaceArchives as listSharedWorkspaceArchives } from 'qxqy-studio/host/workspace'

export function resolveWorkspaceArchive(workspacePath, requestedPath) {
  if (!workspacePath) throw new Error('工作区未绑定，无法从磁盘拉取存档')
  const raw = String(requestedPath || '').trim()
  if (!raw) throw new Error('path is required')
  const root = realpathSync(resolve(workspacePath))
  const abs = isAbsolute(raw) ? resolve(raw) : resolve(root, raw)
  const lexicalRel = relative(root, abs)
  if (!lexicalRel || lexicalRel.startsWith('..') || isAbsolute(lexicalRel)) throw new Error('存档路径必须位于当前工作区内')
  if (!existsSync(abs)) throw new Error(`存档不存在: ${raw}`)
  const real = realpathSync(abs)
  const rel = relative(root, real)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error('存档路径必须位于当前工作区内')
  return real
}

export function listWorkspaceArchives(workspacePath) {
  if (!workspacePath) return { bound: false, archives: [] }
  const root = resolve(workspacePath)
  if (!existsSync(root)) return { bound: false, archives: [] }
  return listSharedWorkspaceArchives(root)
}
