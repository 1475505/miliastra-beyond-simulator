import { closeSync, existsSync, openSync, readdirSync, readSync, realpathSync, statSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'

// Shared filesystem boundary for local host adapters such as MCP and Web.

const SAVE_MARK = 'qxqy-simulator-save'
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.dsh', 'coverage'])
const MAX_FILES = 50
const MAX_BYTES = 8 * 1024 * 1024
const MAX_DEPTH = 8

export function resolveWorkspaceRoot(value = '') {
  const candidate = resolve(String(value || process.cwd()))
  if (!existsSync(candidate)) throw new Error(`workspace does not exist: ${candidate}`)
  if (!statSync(candidate).isDirectory()) throw new Error(`workspace is not a directory: ${candidate}`)
  return realpathSync(candidate)
}

function relativePath(root, absolutePath, allowRoot = false) {
  const rel = relative(root, absolutePath)
  if ((!allowRoot && !rel) || rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error('path must stay inside the configured workspace')
  }
  return rel
}

/** Resolve an existing workspace file without allowing traversal or symlink escape. */
export function resolveWorkspaceFile(workspaceRoot, requestedPath) {
  const raw = String(requestedPath || '').trim()
  if (!raw || isAbsolute(raw)) throw new Error('path must be a non-empty workspace-relative path')
  const root = realpathSync(resolve(workspaceRoot))
  const lexical = resolve(root, raw)
  relativePath(root, lexical)
  if (!existsSync(lexical)) throw new Error(`file does not exist: ${raw}`)
  const actual = realpathSync(lexical)
  relativePath(root, actual)
  return actual
}

/** Resolve a workspace path for a new file, validating the nearest existing parent. */
export function resolveWorkspaceOutput(workspaceRoot, requestedPath) {
  const raw = String(requestedPath || '').trim()
  if (!raw || isAbsolute(raw)) throw new Error('path must be a non-empty workspace-relative path')
  const root = realpathSync(resolve(workspaceRoot))
  const target = resolve(root, raw)
  relativePath(root, target)
  let parent = dirname(target)
  while (!existsSync(parent)) {
    const next = dirname(parent)
    if (next === parent) throw new Error('unable to resolve output directory')
    parent = next
  }
  relativePath(root, realpathSync(parent), true)
  if (existsSync(target)) relativePath(root, realpathSync(target))
  return target
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
      // Ignore unreadable files while listing a workspace.
    }
  }
}

export function listWorkspaceArchives(workspaceRoot) {
  const root = resolveWorkspaceRoot(workspaceRoot)
  const archives = []
  walk(root, root, archives, 0)
  archives.sort((a, b) => b.mtime - a.mtime)
  return { bound: true, workspace: root, archives }
}
