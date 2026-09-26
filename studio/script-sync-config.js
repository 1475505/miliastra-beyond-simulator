import { isAbsolute, win32 } from 'node:path'

export function scriptRelativePath(value, allowEmpty = false) {
  const path = String(value ?? '').trim().replaceAll('\\', '/')
  if (allowEmpty && (!path || path === '.')) return ''
  if (!path || isAbsolute(path) || win32.isAbsolute(path) || path.split('/').some(part => !part || part === '.' || part === '..' || /[<>:"|?*\x00-\x1f]/.test(part) || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) {
    throw new Error('脚本目录/路径必须是有效的相对路径，不能包含 .. 或 Windows 特殊文件名')
  }
  return path
}

export function normalizeScriptSync(value) {
  if (value == null) return null
  if (value.version !== 1) throw new Error('unsupported scriptSync version')
  const clientImportRoot = String(value.clientImportRoot || '').trim()
  if (!isAbsolute(clientImportRoot) && !win32.isAbsolute(clientImportRoot)) throw new Error('实机导入根目录必须是绝对路径')
  return { version: 1, workspaceDir: scriptRelativePath(value.workspaceDir, true), clientImportRoot, clientSubdir: scriptRelativePath(value.clientSubdir, true) }
}
