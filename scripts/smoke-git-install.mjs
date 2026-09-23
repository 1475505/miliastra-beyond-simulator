// Exercise a real Git dependency from a source-only snapshot, without changing
// the user's repository history, remote, or Harness profile.
import assert from 'node:assert/strict'
import { copyFile, mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'
import { root, cleanGenerated } from './paths.mjs'

const temporary = await mkdtemp(join(tmpdir(), 'qxqy-git-install-'))
const source = join(temporary, 'source')
const dshCli = process.argv[2]
const dshHome = join(temporary, 'dsh-home')
const consumer = dshCli ? join(dshHome, 'profiles/web') : join(temporary, 'consumer')
const run = (command, args, cwd, extra = {}) => execFileSync(command, args, {
  cwd, encoding: 'utf8', windowsHide: true, timeout: 300000, ...extra,
})
const pnpm = process.platform === 'win32' ? 'pnpm.exe' : 'pnpm'
try {
  await mkdir(source)
  await mkdir(consumer, { recursive: true })
  const files = run('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], root).split('\0').filter(Boolean)
  for (const file of files) {
    const from = join(root, file)
    const info = await stat(from).catch(error => { if (error.code !== 'ENOENT') throw error })
    if (!info?.isFile()) continue // Deleted tracked files are absent in this snapshot.
    const to = join(source, file)
    await mkdir(dirname(to), { recursive: true })
    await copyFile(from, to)
  }
  assert.equal(await stat(join(source, 'dsh-plugin/dist')).catch(() => null), null, 'Git test must start without built assets')
  run('git', ['init', '-b', 'master'], source)
  run('git', ['-c', 'core.autocrlf=false', 'add', '.'], source)
  const hooks = join(temporary, 'empty-hooks')
  await mkdir(hooks)
  run('git', ['-c', 'user.name=Package smoke test', '-c', 'user.email=package-smoke@example.invalid',
    '-c', 'commit.gpgsign=false', '-c', `core.hooksPath=${hooks}`, 'commit', '-qm', 'Source-only install fixture'], source)

  const dshEnv = { ...process.env, DSH_HOME: dshHome }
  if (dshCli) {
    run(process.execPath, [dshCli, 'plugin', '--profile', 'web', 'list'], temporary, { env: dshEnv, stdio: 'inherit' })
  } else {
    await writeFile(join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module' }))
  }
  await writeFile(join(consumer, 'pnpm-workspace.yaml'), 'onlyBuiltDependencies:\n  - dsh-plugin-beyond-simulator\n  - esbuild\n')
  const spec = `git+${pathToFileURL(source).href}#master`
  console.log(`Installing Git source in an isolated consumer: ${spec}`)
  if (dshCli) {
    run(process.execPath, [dshCli, 'plugin', '--profile', 'web', 'add', spec], temporary, { env: dshEnv, stdio: 'inherit' })
    const profile = JSON.parse(await readFile(join(consumer, 'package.json'), 'utf8'))
    assert.ok(profile.dsh.profile.bundles.includes('dsh-plugin-beyond-simulator'))
    const config = run(process.execPath, [dshCli, '--profile', 'web', '--dump-config'], temporary, { env: dshEnv })
    for (const entry of ['qxqy-simulator', 'qxqy-simulator-skill', 'qxqy-simulator-preset']) assert.ok(config.includes(entry), entry)
    console.log('PASS Harness plugin add and --dump-config in isolated DSH_HOME')
  } else {
    run(pnpm, ['add', spec, '@deepseek-ai/dsh-tools@0.1.0-rc.6', '@deepseek-ai/cordis@4.0.1'], consumer, { stdio: 'inherit' })
  }
  await copyFile(join(root, 'scripts/smoke-git-installed.mjs'), join(consumer, 'smoke.mjs'))
  run(process.execPath, ['smoke.mjs'], consumer, { stdio: 'inherit' })
  const lockfile = await readFile(join(consumer, 'pnpm-lock.yaml'), 'utf8')
  assert.ok(lockfile.includes('git+file:'), 'Expected a Git install, not a linked source directory')
  console.log('PASS source-only Git install: prepare build, bundle, client, Skill, presets, Worker and PNG')
} finally {
  await cleanGenerated(temporary, tmpdir())
}
