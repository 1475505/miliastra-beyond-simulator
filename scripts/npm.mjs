import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { execFileSync } from 'node:child_process'

const require = createRequire(import.meta.url)
export function npm(args, options = {}) {
  let cli
  try { cli = join(dirname(require.resolve('npm/package.json')), 'bin/npm-cli.js') } catch {
    const nodeDir = dirname(process.execPath)
    cli = process.platform === 'win32'
      ? join(nodeDir, 'node_modules/npm/bin/npm-cli.js')
      : join(nodeDir, '../lib/node_modules/npm/bin/npm-cli.js')
  }
  return execFileSync(process.execPath, [cli, ...args], { encoding: 'utf8', windowsHide: true, ...options })
}
