import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createStudio, inspectGia, validateGiaCompatibility } from '../index.js'

const here = dirname(fileURLToPath(import.meta.url))
const outputDir = resolve(here, '../../../probes/client-template-import')
mkdirSync(outputDir, { recursive: true })

function generateProbe(studio, baseName, fileId) {
  Object.assign(studio._project.meta, {
    giaOwnerUid: 114514,
    giaTimestamp: Math.floor(Date.now() / 1000),
    giaFileId: fileId,
    giaFileName: `${baseName}.gia`,
  })
  const gia = studio.exportData('gia')
  const json = studio.exportData('json')
  const bytes = Buffer.from(gia.data, 'base64')
  const verifier = createStudio()
  const imported = verifier.importData('gia', gia.data, `${baseName}.gia`)
  const manifest = {
    generatedAt: new Date().toISOString(),
    sha256: createHash('sha256').update(bytes).digest('hex'),
    bytes: bytes.length,
    prefabIds: imported.snapshot.root.children.map((node) => node.guid),
    templateNames: imported.snapshot.root.children.map((node) => node.name),
    structure: inspectGia(bytes),
    compatibility: validateGiaCompatibility(bytes),
    controls: imported.snapshot.tree.map((row) => ({ id: row.id, name: row.name, kind: row.kind, depth: row.depth, parentId: row.parentId })),
    warnings: gia.warnings,
  }
  const giaPath = resolve(outputDir, `${baseName}.gia`)
  const jsonPath = resolve(outputDir, `${baseName}.authoring.json`)
  const manifestPath = resolve(outputDir, `${baseName}.manifest.json`)
  writeFileSync(giaPath, bytes)
  writeFileSync(jsonPath, Buffer.from(json.data, 'base64'))
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8')
  return { giaPath, jsonPath, manifestPath, ...manifest }
}

const composite = createStudio()
composite.patch({ op: 'newAsset', assetType: 'client-control-template' })
const compositeResult = generateProbe(composite, 'qxqy-lua-instantiable-panel', 1073741829)

const multiRoot = createStudio()
multiRoot.patch({ op: 'newAsset', assetType: 'client-control-template' })
multiRoot.patch({ op: 'reparent', id: 'n3', parentId: 'sc1' })
multiRoot.patch({ op: 'reparent', id: 'n4', parentId: 'sc1' })
const multiRootResult = generateProbe(multiRoot, 'qxqy-lua-multi-template', 1073741830)

process.stdout.write(JSON.stringify({ composite: compositeResult, multiRoot: multiRootResult }, null, 2) + '\n')
