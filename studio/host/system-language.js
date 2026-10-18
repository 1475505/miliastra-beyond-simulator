import { execFile } from 'node:child_process'
import { win32 } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)
const loopback = value => ['localhost', '127.0.0.1', '::1', '[::1]', '::ffff:127.0.0.1'].includes(value)

export function normalizeSystemLanguage(value) {
  if (typeof value !== 'string') return ''
  const tag = value.trim().replace(/^\uFEFF/, '').split(/[.@]/)[0].replaceAll('_', '-')
  if (!tag || /^(?:C|POSIX)$/i.test(tag) || tag.length > 80) return ''
  try { return Intl.getCanonicalLocales(tag)[0] || '' } catch { return '' }
}

// A remote viewer must not inherit the server operator's desktop language.
export function localLanguageRequest(request) {
  try {
    return loopback(request.socket?.remoteAddress) && loopback(new URL('http://' + request.headers.host).hostname)
      && !request.headers.forwarded && !request.headers['x-forwarded-for'] && !request.headers['x-forwarded-host'] && !request.headers.via
      && request.headers['sec-fetch-site'] !== 'cross-site'
      && (!request.headers.origin || new URL(request.headers.origin).host === request.headers.host)
  } catch { return false }
}

export function createSystemLanguageReader({ platform = process.platform, env = process.env, execFile: execute = run } = {}) {
  let pending
  return () => pending ||= (async () => {
    try {
      let language = '', source = 'browser'
      const options = { windowsHide: true, timeout: 2500, maxBuffer: 4096, encoding: 'utf8' }
      if (platform === 'win32') {
        const executable = win32.join(env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
        const { stdout } = await execute(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8;(Get-UICulture).Name'], options)
        language = normalizeSystemLanguage(stdout)
        source = 'windows-ui'
      } else if (platform === 'darwin') {
        const { stdout } = await execute('/usr/bin/defaults', ['read', '-g', 'AppleLanguages'], options)
        const tags = stdout.match(/\b[a-z]{2,3}(?:[-_][a-zA-Z0-9]{2,8})*\b/g) || []
        language = tags.map(normalizeSystemLanguage).find(Boolean) || ''
        source = 'macos-ui'
      } else {
        const candidates = [env.LANGUAGE?.split(':')[0], env.LC_ALL, env.LC_MESSAGES, env.LANG]
        language = candidates.map(normalizeSystemLanguage).find(Boolean) || ''
        source = 'host-locale'
      }
      return { language, source: language ? source : 'browser' }
    } catch { return { language: '', source: 'browser' } }
  })()
}

export const systemLanguage = createSystemLanguageReader()
