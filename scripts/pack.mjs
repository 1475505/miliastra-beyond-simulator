import { cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { root, products, cleanGenerated } from './paths.mjs'
import { buildProduct } from './build.mjs'
import { npm } from './npm.mjs'

export async function packProducts({ build = true } = {}) {
  const output = join(root, 'release')
  await mkdir(output, { recursive: true })
  const artifacts = []
  for (const product of products) {
    if (build) await buildProduct(product)
    const source = product === 'dsh-plugin' ? root : join(root, product)
    const manifest = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'))
    const stage = join(output, 'staging', product)
    await cleanGenerated(stage, output)
    await mkdir(stage, { recursive: true })
    for (const entry of manifest.files) await cp(join(source, entry), join(stage, entry), { recursive: true })
    await cp(join(root, 'LICENSE'), join(stage, 'LICENSE'))
    manifest.files = [...new Set([...manifest.files, 'LICENSE'])]
    delete manifest.devDependencies
    delete manifest.private
    // Consumers install prebuilt code; they never need the source build tools.
    manifest.scripts = product === 'web' ? { start: 'node dist/server.js' } : {}
    for (const [name, spec] of Object.entries({ ...manifest.dependencies, ...manifest.peerDependencies })) {
      if (/^(file:|link:|workspace:)/.test(spec)) throw new Error(`Unresolved release dependency: ${name}=${spec}`)
    }
    await writeFile(join(stage, 'package.json'), JSON.stringify(manifest, null, 2) + '\n')
    const result = JSON.parse(npm(['pack', '--ignore-scripts', '--json', '--pack-destination', output], { cwd: stage }))
    const filename = result[0].filename
    const bytes = await readFile(join(output, filename))
    artifacts.push({ product, name: manifest.name, version: manifest.version, filename, sha256: createHash('sha256').update(bytes).digest('hex') })
    console.log(`Packed ${filename}`)
  }
  await writeFile(join(output, 'manifest.json'), JSON.stringify({ artifacts }, null, 2) + '\n')
  await writeFile(join(output, 'SHA256SUMS'), artifacts.map(a => `${a.sha256}  ${a.filename}`).join('\n') + '\n')
  return artifacts
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await packProducts({ build: !process.argv.includes('--no-build') })
