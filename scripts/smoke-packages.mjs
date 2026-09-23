import { mkdtemp, readFile, copyFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { root, cleanGenerated } from './paths.mjs'
import { npm } from './npm.mjs'

const { artifacts } = JSON.parse(await readFile(join(root, 'release/manifest.json'), 'utf8'))
const destination = await mkdtemp(join(tmpdir(), 'qxqy-package-smoke-'))
console.log(`Installing release packages outside checkout: ${destination}`)
try {
  npm(['install', '--ignore-scripts', '--no-audit', '--no-fund', '--no-package-lock',
    ...artifacts.map(a => join(root, 'release', a.filename)),
    '@deepseek-ai/dsh-tools@0.1.0-rc.6', '@deepseek-ai/cordis@4.0.1'], { cwd: destination, stdio: 'inherit', timeout: 180000 })
  await copyFile(join(root, 'scripts/smoke-installed.mjs'), join(destination, 'smoke.mjs'))
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
