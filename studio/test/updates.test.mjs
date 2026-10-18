import test from 'node:test'
import assert from 'node:assert/strict'
import { createUpdateChecker, releaseForPackage, REPOSITORY_URL } from '../host/updates.js'
const name = 'dsh-plugin-beyond-simulator'
const release = (entries, overrides = {}) => ({
  html_url: REPOSITORY_URL + '/releases/tag/test',
  published_at: '2026-10-18T00:00:00Z', assets: entries.map(([pkg, version]) => ({
    name: pkg + '-' + version + '.tgz',
    browser_download_url: REPOSITORY_URL + '/releases/download/test/' + pkg + '-' + version + '.tgz',
  })), ...overrides,
})

test('updates select the matching product and highest stable version independently of release order', () => {
  const rows = [
    release([['beyond-simulator-mcp', '9.9.9']]),
    release([[name, '2.9.0']]), release([[name, '2.10.0']]),
    release([[name, '3.0.0']], { prerelease: true }),
    release([[name, '4.0.0']], { draft: true }),
    release([[name, '8.0.0-rc.1']]),
  ]
  assert.equal(releaseForPackage(rows, name).version, '2.10.0')
  assert.equal(releaseForPackage(rows, 'beyond-simulator-web'), null)
  assert.equal(releaseForPackage([release([[name, '9.9.9']], { html_url: 'https://evil.invalid/release' })], name), null)
  const bad = release([[name, '9.9.9']]); bad.assets[0].browser_download_url = 'javascript:alert(1)'
  assert.equal(releaseForPackage([bad], name), null)
})

test('checks coalesce, cache briefly and report update/current/ahead/unavailable accurately', async () => {
  let calls = 0, clock = 1000
  const fetch = async () => { calls++; return { ok: true, json: async () => [release([[name, '2.10.0']])] } }
  const check = createUpdateChecker({ packageName: name, currentVersion: '2.9.0', fetch, now: () => clock })
  const results = await Promise.all([check(), check(), check()])
  assert.equal(calls, 1)
  assert.ok(results.every(value => value.status === 'available'))
  assert.equal((await check()).latestVersion, '2.10.0')
  assert.equal(calls, 1)
  clock += 5 * 60_000; await check()
  assert.equal(calls, 2)
  for (const [currentVersion, expected] of [['2.10.0', 'current'], ['2.11.0', 'ahead'], ['2.10.0-rc.1', 'available']]) {
    assert.equal((await createUpdateChecker({ packageName: name, currentVersion, fetch })()).status, expected)
  }
  assert.equal((await createUpdateChecker({ packageName: 'beyond-simulator-web', currentVersion: '0.4.1', fetch })()).status, 'unavailable')
})

test('network/rate-limit failures never become a false up-to-date result and can be retried', async () => {
  let calls = 0
  const check = createUpdateChecker({ packageName: name, currentVersion: '2.1.1', fetch: async () => {
    if (++calls === 1) return { ok: false, status: 403 }
    return { ok: true, json: async () => [release([[name, '2.1.2']])] }
  } })
  await assert.rejects(check(), /HTTP 403/)
  assert.equal((await check()).status, 'available')
})
