import { closeSync, existsSync, openSync, opendirSync, readSync, realpathSync, statSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'

// Shared filesystem boundary for local host adapters such as MCP and Web.

const SAVE_MARK = 'qxqy-simulator-save'
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.dsh', 'coverage'])
const MAX_FILES = 50
const HEAD_BYTES = 4096
const MAX_ENTRIES = 10000
const MAX_DIRECTORIES = 1000
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

function fileHead(path, size = HEAD_BYTES) {
  const buffer = Buffer.alloc(size)
  const fd = openSync(path, 'r')
  try {
    const bytes = readSync(fd, buffer, 0, size, 0)
    return buffer.subarray(0, bytes).toString('utf8')
  } finally {
    closeSync(fd)
  }
}

function walk(dir, root, out, depth, discovery) {
  if (depth > MAX_DEPTH) {
    discovery.depthLimitedDirectories += 1
    return
  }
  if (discovery.scannedDirectories >= MAX_DIRECTORIES) {
    discovery.directoryLimitReached = true
    return
  }
  let entries
  try {
    // Stream directory entries so a single large directory cannot bypass the
    // traversal budget by allocating an unbounded readdir array first.
    discovery.scannedDirectories += 1
    entries = opendirSync(dir)
  } catch {
    discovery.unreadableEntries += 1
    return
  }
  try {
    let entry
    while ((entry = entries.readSync())) {
      if (discovery.scannedEntries >= MAX_ENTRIES) {
        discovery.entryLimitReached = true
        return
      }
      discovery.scannedEntries += 1
      if (entry.name.startsWith('.') || (entry.isDirectory() && SKIP_DIRS.has(entry.name))) {
        discovery.skippedEntries += 1
        if (entry.isDirectory()) discovery.skippedDirectories += 1
        continue
      }
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full, root, out, depth + 1, discovery)
        if (discovery.entryLimitReached || discovery.directoryLimitReached) return
        continue
      }
      // Symlinks are deliberately not followed during discovery. Explicit file
      // opens still use resolveWorkspaceFile's workspace boundary validation.
      if (!entry.isFile() || !/\.json$/i.test(entry.name)) continue
      discovery.scannedJsonFiles += 1
      try {
        const stat = statSync(full)
        const head = fileHead(full)
        if (!head.includes(SAVE_MARK)) continue
        const encodedName = head.match(/"name"\s*:\s*("(?:\\.|[^"\\])*")/)?.[1]
        let name = basename(entry.name, '.json')
        if (encodedName) {
          // Discovery is intentionally a header probe, not full validation.
          // Keep malformed candidates visible so opening them reports errors.
          try { name = JSON.parse(encodedName) || name } catch {}
        }
        out.push({
          path: relative(root, full).replaceAll('\\', '/'),
          name,
          bytes: stat.size,
          mtime: stat.mtimeMs,
        })
      } catch {
        discovery.unreadableEntries += 1
      }
    }
  } catch {
    discovery.unreadableEntries += 1
  } finally {
    try { entries.closeSync() } catch { discovery.unreadableEntries += 1 }
  }
}

export function listWorkspaceArchives(workspaceRoot) {
  const root = resolveWorkspaceRoot(workspaceRoot)
  const archives = []
  const discovery = {
    truncated: false,
    warnings: [],
    scannedDirectories: 0,
    scannedEntries: 0,
    scannedJsonFiles: 0,
    matchedArchives: 0,
    skippedDirectories: 0,
    skippedEntries: 0,
    unreadableEntries: 0,
    depthLimitedDirectories: 0,
    entryLimitReached: false,
    directoryLimitReached: false,
    limits: { archives: MAX_FILES, entries: MAX_ENTRIES, directories: MAX_DIRECTORIES, depth: MAX_DEPTH, headBytes: HEAD_BYTES },
    policy: { excludedDirectories: [...SKIP_DIRS], hiddenEntries: false, symlinks: false, validatesJson: false },
  }
  walk(root, root, archives, 0, discovery)
  // Select the newest files only after scanning the bounded workspace, instead
  // of keeping whichever 50 files the filesystem happens to enumerate first.
  archives.sort((a, b) => b.mtime - a.mtime || a.path.localeCompare(b.path))
  discovery.matchedArchives = archives.length
  if (archives.length > MAX_FILES) discovery.warnings.push(`发现 ${archives.length} 个存档，仅显示修改时间最新的 ${MAX_FILES} 个；其他存档可通过指定路径打开。`)
  if (discovery.entryLimitReached || discovery.directoryLimitReached) discovery.warnings.push(`自动发现达到扫描上限（${MAX_ENTRIES} 项 / ${MAX_DIRECTORIES} 个目录），列表可能不完整；可通过指定路径打开存档。`)
  if (discovery.depthLimitedDirectories) discovery.warnings.push(`自动发现跳过 ${discovery.depthLimitedDirectories} 个超过 ${MAX_DEPTH} 层的目录；可通过指定路径打开其中的存档。`)
  if (discovery.skippedEntries) discovery.warnings.push('自动发现跳过隐藏项及生成目录（如 node_modules、dist）；可通过指定路径打开其中的存档。')
  if (discovery.unreadableEntries) discovery.warnings.push(`自动发现无法读取 ${discovery.unreadableEntries} 个文件或目录；请检查访问权限，或通过指定路径查看具体错误。`)
  discovery.truncated = archives.length > MAX_FILES || discovery.entryLimitReached || discovery.directoryLimitReached || discovery.depthLimitedDirectories > 0
  return { bound: true, workspace: root, archives: archives.slice(0, MAX_FILES), discovery }
}
