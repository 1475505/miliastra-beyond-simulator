import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

const dir = dirname(fileURLToPath(import.meta.url))
const studioDir = join(dir, '..')

/** 通过文件 job 跑一次 cli.mjs（避免 Windows 管道 EPERM），返回 parsed.data。 */
function runCli(job, suffix) {
  const temp = mkdtempSync(join(tmpdir(), 'qxqy-cli-test-'))
  const jobPath = join(temp, `${suffix}-job.json`)
  const outPath = join(temp, `${suffix}-out.json`)
  writeFileSync(jobPath, JSON.stringify(job))
  try {
    const r = spawnSync(process.execPath, ['cli.mjs', '--in', jobPath, '--out', outPath], {
      cwd: studioDir,
      encoding: 'utf8',
      timeout: 15000,
      windowsHide: true,
    })
    assert.equal(r.status, 0, r.stderr || r.stdout || 'cli exit')
    const parsed = JSON.parse(readFileSync(outPath, 'utf8'))
    assert.equal(parsed.ok, true, parsed.error)
    return parsed.data
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
}

test('cli.mjs playRun loads lua path from workspace root, not studio cwd', t => {
  const workspace = mkdtempSync(join(tmpdir(), 'qxqy-cli-workspace-'))
  t.after(() => rmSync(workspace, { recursive: true, force: true }))
  writeFileSync(join(workspace, 'external.lua'), 'function OnStart() print("EXTERNAL-FIXTURE") end')
  const data = runCli({
    cmd: 'playRun',
    frames: 0,
    workspace,
    script: { path: 'external.lua', source: '' },
  }, 'play-job-path')
  assert.equal(data.canvasWidth, 1600)
  assert.match(data.logs.map(line => line.text).join('\n'), /EXTERNAL-FIXTURE/)
})

test('cli.mjs patch then get via file job', () => {
  const data = runCli({
    cmd: 'patch',
    op: { op: 'set', key: 'text', value: 'FROM-CLI' },
  }, 'patch')
  const text = data.root.children[0].children.find((c) => c.kind === 'textbox')
  assert.equal(text.text, 'FROM-CLI')
})

test('cli.mjs playRun via the current Node executable and a file job', () => {
  const data = runCli({
    cmd: 'playRun',
    frames: 0,
    script: {
      path: 'inline',
      source: 'function OnStart()\n  local w,h = game.GetUICanvasSize()\n  print("canvas", w, h)\nend\n',
    },
  }, 'play')
  assert.equal(data.canvasWidth, 1600)
  assert.equal(data.canvasHeight, 900)
  assert.match(data.logs.map((l) => l.text).join('\n'), /canvas\t1600\t900/)
})
