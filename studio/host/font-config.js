import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { dirname, join, win32 } from 'node:path'

export function defaultFontPaths(platform = process.platform, env = process.env) {
  if (platform !== 'win32') return []
  const drive = env.SystemDrive || 'C:'
  const programFiles = env.ProgramFiles || `${drive}\\Program Files`
  const suffix = 'YuanShen_Data\\StreamingAssets\\MiHoYoSDKRes\\HttpServerResources\\font\\zh-cn.ttf'
  return [...new Set([
    win32.join(programFiles, 'Genshin Impact', 'Genshin Impact Game', suffix),
    win32.join(drive + '\\', 'Mihoyo', 'Genshin Impact', 'Genshin Impact Game', suffix),
    win32.join(programFiles, 'HoYoPlay', 'games', 'Genshin Impact game', suffix),
    win32.join(programFiles, 'miHoYo Launcher', 'games', 'Genshin Impact Game', suffix),
  ])]
}

export function fontConfigPath() {
  if (process.env.QXQY_FONT_CONFIG_PATH) return process.env.QXQY_FONT_CONFIG_PATH
  const base = process.platform === 'win32' ? (process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'))
    : process.platform === 'darwin' ? join(homedir(), 'Library', 'Application Support')
      : (process.env.XDG_CONFIG_HOME || join(homedir(), '.config'))
  return join(base, 'beyond-simulator', 'font.json')
}

export function normalizeFontConfig(value) {
  if (!value || !['auto', 'custom', 'system'].includes(value.mode)) throw new Error('请选择自动查找、指定文件或系统字体')
  const scope = value.scope === undefined ? 'all' : value.scope
  if (!['game', 'all'].includes(scope)) throw new Error('请选择字体应用范围')
  let path = typeof value.path === 'string' ? value.path.trim() : ''
  if (path.length > 4096) throw new Error('字体路径过长')
  if ((path.startsWith('"') && path.endsWith('"')) || (path.startsWith("'") && path.endsWith("'"))) path = path.slice(1, -1)
  if (value.mode === 'custom' && !path) throw new Error('请填写字体文件的绝对路径')
  return { mode: value.mode, path: value.mode === 'custom' ? path : '', scope }
}

export function readFontConfig(file = fontConfigPath()) {
  if (!existsSync(file)) return { mode: 'auto', path: '', scope: 'all' }
  try { return normalizeFontConfig(JSON.parse(readFileSync(file, 'utf8'))) }
  catch { throw new Error('本机字体设置无法读取，请在「字体设置」中重新保存') }
}

export function writeFontConfig(config, file = fontConfigPath()) {
  const temporary = `${file}.${randomUUID()}.tmp`
  try {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(temporary, JSON.stringify(config, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
    renameSync(temporary, file)
  } catch (cause) { throw new Error('无法保存本机字体设置，请检查配置目录的写入权限', { cause }) }
  finally { rmSync(temporary, { force: true }) }
}
