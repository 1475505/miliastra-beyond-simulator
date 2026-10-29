import { readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { root } from './paths.mjs'
import { buildProduct } from './build.mjs'

await buildProduct('web')
await buildProduct('dsh-plugin')
for (const directory of ['client/lua-runtime', 'server', 'studio', 'dsh-plugin', 'mcp', 'web']) {
  const files = readdirSync(join(root, directory, 'test')).filter(name => name.endsWith('.test.mjs')).map(name => `test/${name}`)
  console.log(`\nTesting ${directory}`)
  // Each browser fixture starts a separate SwiftShader process. Run those
  // serially so CPU/GPU contention cannot turn CDP deadlines into failures.
  const browserArgs = directory === 'web' && (process.env.QXQY_BROWSER || process.env.QXQY_ELECTRON) ? ['--test-concurrency=1'] : []
  const result = spawnSync(process.execPath, ['--test', ...browserArgs, ...files], { cwd: join(root, directory), stdio: 'inherit', windowsHide: true })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status || 1)
}
