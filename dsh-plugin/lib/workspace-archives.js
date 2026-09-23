import { closeSync, existsSync, openSync, readdirSync, readSync, realpathSync, statSync } from 'node:fs'
import { basename, isAbsolute, join, relative, resolve } from 'node:path'

const SAVE_MARK = 'qxqy-simulator-save'
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.dsh', 'coverage'])
const MAX_FILES = 50
const MAX_BYTES = 8 * 1024 * 1024
const MAX_DEPTH = 8

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

function fileHead(path, size = 4096) {
  const buffer = Buffer.alloc(size)
  const fd = openSync(path, 'r')
  try {
    const bytes = readSync(fd, buffer, 0, size, 0)
    return buffer.subarray(0, bytes).toString('utf8')
  } finally {
    closeSync(fd)
  }
}

function walk(dir, root, out, depth) {
  if (out.length >= MAX_FILES || depth > MAX_DEPTH) return
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (out.length >= MAX_FILES) return
    if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(full, root, out, depth + 1)
      continue
    }
    if (!entry.isFile() || !/\.json$/i.test(entry.name)) continue
    try {
      const stat = statSync(full)
      if (stat.size < 20 || stat.size > MAX_BYTES) continue
      const head = fileHead(full)
      if (!head.includes(SAVE_MARK)) continue
      const name = head.match(/"name"\s*:\s*"([^"]+)"/)?.[1] || basename(entry.name, '.json')
      out.push({
        path: relative(root, full).replaceAll('\\', '/'),
        name,
        bytes: stat.size,
        mtime: stat.mtimeMs,
      })
    } catch {
      // skip unreadable files
    }
  }
}

export function listWorkspaceArchives(workspacePath) {
  if (!workspacePath) return { bound: false, archives: [] }
  const root = resolve(workspacePath)
  if (!existsSync(root)) return { bound: false, archives: [] }
  const archives = []
  walk(root, root, archives, 0)
  archives.sort((a, b) => b.mtime - a.mtime)
  return { bound: true, workspace: root, archives }
}
