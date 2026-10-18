import test from 'node:test'
import assert from 'node:assert/strict'
import { createSystemLanguageReader, localLanguageRequest, normalizeSystemLanguage } from '../host/system-language.js'

test('Windows reads UI culture once, without inheriting English shell locale or opening a window', async () => {
  let calls = 0
  const reader = createSystemLanguageReader({ platform: 'win32', env: { SystemRoot: 'C:\\Windows', LANG: 'en_US.UTF-8' },
    execFile: async (executable, args, options) => {
      calls++
      assert.equal(executable, 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')
      assert.ok(args.includes('-NoProfile') && args.includes('-NonInteractive'))
      assert.ok(args.at(-1).includes('Get-UICulture'))
      assert.equal(options.windowsHide, true)
      return { stdout: '\uFEFFzh-CN\r\n' }
    } })
  assert.deepEqual(await reader(), { language: 'zh-CN', source: 'windows-ui' })
  await reader()
  assert.equal(calls, 1)
})

test('macOS preferences, Linux message locales, unavailable commands and C locales have explicit fallbacks', async () => {
  const mac = createSystemLanguageReader({ platform: 'darwin', execFile: async () => ({ stdout: '(\n "zh-Hant-TW",\n en-US\n)' }) })
  assert.deepEqual(await mac(), { language: 'zh-Hant-TW', source: 'macos-ui' })
  const linux = createSystemLanguageReader({ platform: 'linux', env: { LANGUAGE: 'fr_FR:zh_CN', LC_ALL: 'de_DE.UTF-8' } })
  assert.deepEqual(await linux(), { language: 'fr-FR', source: 'host-locale' })
  const empty = createSystemLanguageReader({ platform: 'linux', env: { LANG: 'C.UTF-8' } })
  assert.deepEqual(await empty(), { language: '', source: 'browser' })
  const failed = createSystemLanguageReader({ platform: 'win32', execFile: async () => { throw new Error('blocked') } })
  assert.deepEqual(await failed(), { language: '', source: 'browser' })
  for (const value of ['C', 'POSIX', '../zh-CN', '<script>', '', null]) assert.equal(normalizeSystemLanguage(value), '')
})

test('server language hints are limited to direct loopback viewers, including IPv6', () => {
  const request = { headers: { host: 'localhost:4173' }, socket: { remoteAddress: '127.0.0.1' } }
  assert.equal(localLanguageRequest(request), true)
  assert.equal(localLanguageRequest({ headers: { host: '[::1]:4173' }, socket: { remoteAddress: '::1' } }), true)
  for (const headers of [{ host: 'public.example' }, { 'x-forwarded-for': '127.0.0.1' }, { via: 'proxy' }, { origin: 'https://elsewhere.invalid' }]) {
    assert.equal(localLanguageRequest({ ...request, headers: { ...request.headers, ...headers } }), false)
  }
  assert.equal(localLanguageRequest({ ...request, socket: { remoteAddress: '192.0.2.1' } }), false)
})
