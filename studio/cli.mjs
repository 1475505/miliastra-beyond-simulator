#!/usr/bin/env node
/**
 * Headless play worker. Spawn: node.exe cli.mjs --in job.json --out out.json
 * Do not use resolveExecutable('node') → node.EXE (ENOENT). File I/O avoids Windows pipe EPERM.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { createStudio } from './index.js'

const TIMEOUT_MS = Number(process.env.QXQY_CLI_TIMEOUT_MS || 12000)
const timer = setTimeout(() => {
  try { process.stderr.write('qxqy-studio cli timeout\n') } catch {}
  process.exit(2)
}, TIMEOUT_MS)

function runJob(job) {
  const studio = createStudio(job.project || undefined, job.workspace ? { workspacePath: job.workspace } : undefined)
  if (job.canvasId) studio.patch({ op: 'setCanvas', canvasId: job.canvasId })
  if (job.script) studio.patch({ op: 'addScript', controlId: 'n1', ...job.script })
  if (Array.isArray(job.scripts)) {
    for (const script of job.scripts) studio.patch({ op: 'addScript', ...script })
  }
  const cmd = job.cmd || 'playRun'
  if (cmd === 'get') return studio.get()
  if (cmd === 'patch') {
    if (job.op) studio.patch(job.op)
    return studio.get()
  }
  if (cmd === 'playStart') return studio.playStart()
  if (cmd === 'playRun') return studio.playRun(job.frames || 0)
  if (cmd === 'playStop') return studio.playStop()
  throw new Error(`unknown cmd ${cmd}`)
}

const args = process.argv.slice(2)
const inFlag = args.indexOf('--in')
const outFlag = args.indexOf('--out')
if (inFlag < 0 || outFlag < 0) {
  process.stderr.write('usage: node.exe cli.mjs --in job.json --out out.json\n')
  process.exit(2)
}
const inPath = args[inFlag + 1]
const outPath = args[outFlag + 1]
try {
  const job = JSON.parse(readFileSync(inPath, 'utf8'))
  const data = runJob(job)
  writeFileSync(outPath, JSON.stringify({ ok: true, data, error: null }))
  clearTimeout(timer)
  process.exit(0)
} catch (err) {
  try {
    writeFileSync(outPath, JSON.stringify({
      ok: false,
      data: null,
      error: err && err.message ? err.message : String(err),
    }))
  } catch {}
  clearTimeout(timer)
  process.exit(1)
}
