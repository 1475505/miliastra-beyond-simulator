import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'

const webRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const distServer = join(webRoot, 'dist', 'server.js')
const urlPattern = /QXQY Simulator Web: (http:\/\/\S+)/

// npm installs a global bin as a symlink into lib/node_modules/<package>/, so the entry
// keeps the link path while the ESM loader resolves import.meta.url to the real path.
function installLayout(prefix) {
  const modules = join(prefix, 'lib', 'node_modules')
  const binDir = join(prefix, 'bin')
  mkdirSync(modules, { recursive: true })
  mkdirSync(binDir, { recursive: true })
  symlinkSync(webRoot, join(modules, 'beyond-simulator-web'), 'dir')
  const bin = join(binDir, 'beyond-simulator-web')
  symlinkSync(join('..', 'lib', 'node_modules', 'beyond-simulator-web', 'dist', 'server.js'), bin, 'file')
  return bin
}

function capture(child) {
  let stdout = ''
  let stderr = ''
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', (chunk) => { stdout += chunk })
  child.stderr.on('data', (chunk) => { stderr += chunk })
  return () => stdout + stderr
}

async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return
  const exited = once(child, 'exit', { signal: AbortSignal.timeout(10_000) })
  child.kill()
  try {
    await exited
  } catch {
    child.kill('SIGKILL')
  }
}

async function startEntry(entry, args) {
  const child = spawn(process.execPath, [entry, ...args], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  const output = capture(child)
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const url = output().match(urlPattern)?.[1]
    if (url) return { child, url, output }
    if (child.exitCode !== null || child.signalCode !== null) break
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  await stop(child)
  throw new Error(`entry never started (code=${child.exitCode}, signal=${child.signalCode}): ${JSON.stringify(output())}`)
}

async function runToCompletion(entry, timeoutMs) {
  const child = spawn(process.execPath, [entry], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  const output = capture(child)
  const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs)
  try {
    const [code] = await once(child, 'exit')
    return { code, output: output() }
  } finally {
    clearTimeout(timer)
  }
}

function makeWorkspace(prefix) {
  const workspace = join(prefix, 'workspace')
  mkdirSync(workspace)
  return workspace
}

test('a symlinked bin starts the server', { skip: process.platform === 'win32' }, async (t) => {
  const prefix = mkdtempSync(join(tmpdir(), 'qxqy-bin-link-'))
  const workspace = makeWorkspace(prefix)
  let child
  t.after(async () => {
    if (child) await stop(child)
    rmSync(prefix, { recursive: true, force: true })
  })

  const started = await startEntry(installLayout(prefix), ['--workspace', workspace, '--port', '0'])
  child = started.child
  assert.match(started.url, /^http:\/\/127\.0\.0\.1:\d+$/)

  const health = await fetch(`${started.url}/health`, { signal: AbortSignal.timeout(10_000) })
  assert.equal(health.status, 200)
  assert.deepEqual(await health.json(), { status: 'ok' })
  assert.equal((await fetch(`${started.url}/api/state`, { signal: AbortSignal.timeout(10_000) })).status, 200)
})

test('announcing the real path still starts the server', async (t) => {
  const prefix = mkdtempSync(join(tmpdir(), 'qxqy-bin-real-'))
  const workspace = makeWorkspace(prefix)
  let child
  t.after(async () => {
    if (child) await stop(child)
    rmSync(prefix, { recursive: true, force: true })
  })

  const started = await startEntry(distServer, ['--workspace', workspace, '--port', '0'])
  child = started.child
  assert.equal((await fetch(`${started.url}/health`, { signal: AbortSignal.timeout(10_000) })).status, 200)
})

test('importing the module does not start a server', async (t) => {
  const temp = mkdtempSync(join(tmpdir(), 'qxqy-bin-import-'))
  t.after(() => rmSync(temp, { recursive: true, force: true }))
  const entry = join(temp, 'entry.mjs')
  writeFileSync(entry, `import ${JSON.stringify(pathToFileURL(distServer).href)}\nprocess.stdout.write('imported\\n')\n`)

  const result = await runToCompletion(entry, 30_000)
  assert.equal(result.code, 0, result.output)
  assert.equal(result.output, 'imported\n')
})
