import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { root } from './paths.mjs'
import { npm } from './npm.mjs'

const registry = 'https://registry.npmjs.org'
const { values } = parseArgs({ options: { check: { type: 'boolean' }, product: { type: 'string' } } })
const checkOnly = values.check === true
const product = values.product
if (product !== undefined && !['dsh-plugin', 'mcp', 'web'].includes(product)) {
  throw new Error('--product must be dsh-plugin, mcp, or web')
}
if (!checkOnly && (process.env.GITHUB_ACTIONS !== 'true'
  || process.env.GITHUB_REPOSITORY !== '1475505/miliastra-beyond-simulator'
  || !process.env.GITHUB_REF?.startsWith('refs/tags/npm-'))) {
  throw new Error('Staging is allowed only from this repository’s npm-* GitHub Actions tag workflow')
}

const { artifacts } = JSON.parse(await readFile(join(root, 'release/manifest.json'), 'utf8'))
if (artifacts.length !== 3 || new Set(artifacts.map(artifact => artifact.product)).size !== 3) {
  throw new Error('Expected exactly one DSH, MCP, and Web artifact')
}
const expectedProducts = new Set(['dsh-plugin', 'mcp', 'web'])
for (const artifact of artifacts) {
  if (!expectedProducts.delete(artifact.product)) throw new Error(`Unexpected artifact: ${artifact.product}`)
}

const pending = []
for (const artifact of artifacts.filter(artifact => product === undefined || artifact.product === product)) {
  const { name, version, filename, sha256 } = artifact
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name) || filename !== `${name}-${version}.tgz`) {
    throw new Error(`Invalid artifact identity: ${name}@${version} (${filename})`)
  }
  const path = join(root, 'release', filename)
  const bytes = await readFile(path)
  const localSha256 = createHash('sha256').update(bytes).digest('hex')
  if (localSha256 !== sha256) throw new Error(`Manifest checksum mismatch: ${filename}`)
  const localShasum = createHash('sha1').update(bytes).digest('hex')
  let remoteShasum
  try {
    remoteShasum = JSON.parse(npm(['view', `${name}@${version}`, 'dist.shasum', '--json', `--registry=${registry}`, '--prefer-online'], { timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] }))
  } catch (error) {
    if (error.status !== 1 || !String(error.stderr).includes('E404')) throw error
    remoteShasum = null
  }
  if (remoteShasum) {
    if (remoteShasum !== localShasum) throw new Error(`${name}@${version} already exists with different tarball content; bump its version`)
    console.log(`Already published: ${name}@${version}`)
  } else {
    pending.push({ name, version, path })
    console.log(`Ready to stage: ${name}@${version}`)
  }
}

if (checkOnly) {
  console.log('Check only; no packages staged')
} else {
  for (const artifact of pending) {
    npm(['stage', 'publish', artifact.path, '--access', 'public', `--registry=${registry}`], { stdio: 'inherit', timeout: 180000 })
    console.log(`Staged for maintainer approval: ${artifact.name}@${artifact.version}`)
  }
}
