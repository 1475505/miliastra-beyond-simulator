// Boot the actual 0.2 CLI with a release tarball in a disposable profile.
// An optional CLI path reuses an existing installation; DSH_HOME stays isolated.
import assert from 'node:assert/strict'
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync, spawn } from 'node:child_process'
import { once } from 'node:events'
import { setTimeout as delay } from 'node:timers/promises'
import { root, cleanGenerated } from './paths.mjs'
import { npm } from './npm.mjs'

const temporary = await mkdtemp(join(tmpdir(), 'qxqy-harness-smoke-'))
const home = join(temporary, 'home')
const profile = join(home, 'profiles/web')
const env = { ...process.env, DSH_HOME: home, DSH_AGENTS_HOME: join(temporary, 'agents') }
delete env.DSH_BUNDLED_SKILL_DIR
let child
let output = ''
try {
  let cli = process.argv[2] && resolve(process.argv[2])
  if (!cli) {
    npm(['install', '--no-audit', '--no-fund', '--no-package-lock', '@deepseek-ai/dsh@0.2.0-rc.2'], {
      cwd: temporary, stdio: 'inherit', timeout: 300_000,
    })
    cli = join(temporary, 'node_modules/@deepseek-ai/dsh/lib/bin.js')
  }
  const harness = JSON.parse(await readFile(join(dirname(cli), '../package.json'), 'utf8'))
  assert.match(harness.version, /^0\.2\./, 'test:harness expects a 0.2 CLI')
  const { artifacts } = JSON.parse(await readFile(join(root, 'release/manifest.json'), 'utf8'))
  const artifact = artifacts.find(entry => entry.product === 'dsh-plugin')
  execFileSync(process.execPath, [cli, 'plugin', '--profile', 'web', 'add', join(root, 'release', artifact.filename)], {
    cwd: temporary, env, stdio: 'inherit', windowsHide: true, timeout: 180_000,
  })
  await copyFile(join(root, 'scripts/smoke-harness-probe.mjs'), join(profile, 'smoke-probe.mjs'))
  await mkdir(join(temporary, 'game'))
  await writeFile(join(profile, 'smoke.patch.yml'), [
    '- id: workspace-controller', '  config:', `    documentsDirectory: ${JSON.stringify(join(temporary, 'documents'))}`,
    '- insert:', '    - id: simulator-smoke-probe', '      name: ./smoke-probe.mjs',
    '      config:', `        workspace: ${JSON.stringify(join(temporary, 'game'))}`, '',
  ].join('\n'))
  child = spawn(process.execPath, [cli, '--profile', 'web', '--patch', join(profile, 'smoke.patch.yml'), '--no-open', '--port', '0'], {
    cwd: temporary, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  })
  let spawnError
  child.on('error', error => { spawnError = error })
  child.stdout.on('data', chunk => { output += chunk })
  child.stderr.on('data', chunk => { output += chunk })
  const deadline = Date.now() + 60_000
  let url
  while (Date.now() < deadline) {
    if (spawnError) throw spawnError
    if (child.exitCode !== null || child.signalCode !== null) throw new Error('Harness exited before readiness')
    url = output.match(/dsh web: (http:\/\/127\.0\.0\.1:\d+)/)?.[1]
    if (url) break
    await delay(100)
  }
  assert.ok(url, 'Harness did not become ready within 60 seconds')
  const response = await fetch(`${url}/qxqy-smoke`, { signal: AbortSignal.timeout(30_000) })
  const report = await response.json()
  assert.equal(response.status, 200, JSON.stringify(report))
  assert.equal(report.ok, true, JSON.stringify(report))
  console.log(`PASS Harness ${harness.version}: CLI tarball admission, full Web boot, preset/Skill discovery, real tool calls, attachments and HTTP play`)
} catch (error) {
  // Do not print the launch URL's temporary authentication token.
  if (output) console.error(output.replace(/token=[^\s]+/g, 'token=<redacted>'))
  throw error
} finally {
  if (child && child.exitCode === null && child.signalCode === null) {
    const exited = once(child, 'exit', { signal: AbortSignal.timeout(10_000) })
    child.kill()
    await exited
  }
  await cleanGenerated(temporary, tmpdir())
}
