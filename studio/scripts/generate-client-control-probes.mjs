import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createStudio, inspectGia, validateGiaCompatibility } from '../index.js'
import { createNode } from '../ui/authoring.js'

const CONTROL_TYPES = Object.freeze([
  ['container', '容器节点'],
  ['textbox', '文本框'],
  ['cursor', '光标检测区域'],
  ['reference', '模板引用控件'],
  ['grid', '网格视窗'],
  ['button', '预设按钮'],
  ['textwindow', '文本视窗'],
  ['keyhint', '按键提示'],
  ['image', '图片'],
  ['animation', '界面动效'],
  ['fullscreen', '全屏动效'],
])

const here = dirname(fileURLToPath(import.meta.url))
const outputDir = resolve(here, '../../../probes/client-control-gia')
mkdirSync(outputDir, { recursive: true })
const generatedAt = new Date()
const timestamp = Math.floor(generatedAt.getTime() / 1000)

function makeProject(entries, { baseGuid, fileId, fileName, name }) {
  const server = createNode('server-container', { id: 'sc1', name: '客户端控件模板' })
  server.children = entries.map(([kind, label], index) => createNode(kind, {
    id: `n${index + 1}`,
    guid: baseGuid + index,
    name: label,
    // The official default image template has no external asset reference.
    // Keep the image shell self-contained so this probe does not depend on a
    // target sandbox's material library.
    ...(kind === 'image' ? { imageId: 0 } : {}),
  }))
  return {
    version: 1,
    meta: {
      name,
      assetType: 'client-control-template',
      sourceFormat: 'authoring',
      sourceFile: '',
      gameVersion: '7.0.50',
      giaOwnerUid: 114514,
      giaTimestamp: timestamp,
      giaFileId: fileId,
      giaFileName: fileName,
    },
    canvasId: 'pc-16-9',
    selectedId: 'n1',
    script: { controlId: 'n1', path: '', source: '' },
    root: server,
  }
}

function writeProbe(entries, options) {
  const studio = createStudio(makeProject(entries, options))
  const exported = studio.exportData('gia')
  const bytes = Buffer.from(exported.data, 'base64')
  const compatibility = validateGiaCompatibility(bytes)
  if (!compatibility.valid) throw new Error(compatibility.errors.join('\n'))
  const baseName = options.fileName.replace(/\.gia$/iu, '')
  const giaPath = resolve(outputDir, `${baseName}.gia`)
  const manifestPath = resolve(outputDir, `${baseName}.manifest.json`)
  const authoringPath = resolve(outputDir, `${baseName}.authoring.json`)
  const imported = createStudio().importData('gia', exported.data, options.fileName)
  const manifest = {
    generatedAt: generatedAt.toISOString(),
    sha256: createHash('sha256').update(bytes).digest('hex'),
    bytes: bytes.length,
    structure: inspectGia(bytes),
    compatibility,
    importRoundTrip: {
      templateCount: imported.snapshot.asset.templateCount,
      kinds: imported.snapshot.tree.map((row) => row.kind),
      names: imported.snapshot.tree.map((row) => row.name),
    },
    warnings: exported.warnings,
  }
  writeFileSync(giaPath, bytes)
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  writeFileSync(authoringPath, `${JSON.stringify(studio._project, null, 2)}\n`, 'utf8')
  return { giaPath, manifestPath, authoringPath, ...manifest }
}

const all = writeProbe(CONTROL_TYPES, {
  baseGuid: 1073742200,
  fileId: 1073741840,
  fileName: 'qxqy-client-controls-all.gia',
  name: '全部客户端控件',
})

const individual = Object.fromEntries(CONTROL_TYPES.map((entry, index) => {
  const [kind, label] = entry
  return [kind, writeProbe([entry], {
    baseGuid: 1073742300 + index,
    fileId: 1073741841 + index,
    fileName: `qxqy-client-${kind}-only.gia`,
    name: `${label}最小模板`,
  })]
}))

process.stdout.write(`${JSON.stringify({ all, individual }, null, 2)}\n`)
