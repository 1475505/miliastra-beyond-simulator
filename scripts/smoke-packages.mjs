import { mkdtemp, readFile, copyFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { root, cleanGenerated } from './paths.mjs'
import { npm } from './npm.mjs'

const { artifacts } = JSON.parse(await readFile(join(root, 'release/manifest.json'), 'utf8'))
// Keep the original host baseline and exercise the 0.2 API in separate installs.
const harnessVersions = [
  { tools: '0.1.0-rc.6', cordis: '4.0.1' },
  { tools: '0.2.0-rc.2', cordis: '4.0.4' },
]
for (const harness of harnessVersions) {
  const destination = await mkdtemp(join(tmpdir(), 'qxqy-package-smoke-'))
  console.log(`Installing release packages with dsh-tools ${harness.tools} outside checkout: ${destination}`)
  try {
    // Stop npm's project-root lookup at this disposable consumer, even when
    // the system temporary directory lives inside another npm project.
    await writeFile(join(destination, 'package.json'), JSON.stringify({ private: true, type: 'module' }))
    npm(['install', '--ignore-scripts', '--no-audit', '--no-fund', '--no-package-lock',
      ...artifacts.map(a => join(root, 'release', a.filename)),
      `@deepseek-ai/dsh-tools@${harness.tools}`, `@deepseek-ai/cordis@${harness.cordis}`], { cwd: destination, stdio: 'inherit', timeout: 180000 })
    await copyFile(join(root, 'scripts/smoke-installed.mjs'), join(destination, 'smoke.mjs'))
    await copyFile(join(root, 'scripts/smoke-dsh-tools.mjs'), join(destination, 'smoke-dsh-tools.mjs'))
    const license = await readFile(join(root, 'LICENSE'), 'utf8')
    for (const artifact of artifacts) {
      const installed = join(destination, 'node_modules', artifact.name)
      const manifest = JSON.parse(await readFile(join(installed, 'package.json'), 'utf8'))
      if (manifest.license !== 'GPL-3.0-only' || await readFile(join(installed, 'LICENSE'), 'utf8') !== license) {
        throw new Error(`Missing or inconsistent GPL license: ${artifact.name}`)
      }
    }
    execFileSync(process.execPath, ['smoke.mjs'], { cwd: destination, stdio: 'inherit', windowsHide: true, timeout: 90000 })
  } finally {
    await cleanGenerated(destination, tmpdir())
  }
}
