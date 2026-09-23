import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createStudio, inspectGia, validateServerGiaCompatibility } from '../index.js'
import { createNode } from '../ui/authoring.js'

const CONTROL_TYPES = Object.freeze([
  ['container', '子容器节点'],
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
const outputDir = resolve(here, '../../../probes/server-container-gia')
mkdirSync(outputDir, { recursive: true })
const generatedAt = new Date()
const timestamp = Math.floor(generatedAt.getTime() / 1000)

function makeProject({ includeAllControls, fileId, fileName, baseGuid }) {
  const server = createNode('server-container', {
    id: 'sc1', guid: baseGuid, name: '客户端控件容器', giaRelatedGuids: [],
  })
  const root = createNode('container', {
    id: 'n1', guid: baseGuid + 1, name: '容器节点', isRootContainer: true,
  })
  if (includeAllControls) {
    root.children = CONTROL_TYPES.map(([kind, label], index) => createNode(kind, {
      id: `n${index + 2}`,
      guid: baseGuid + 2 + index,
      name: label,
      ...(kind === 'image' ? { imageId: 0 } : {}),
    }))
  }
  server.children = [root]
  return {
    version: 1,
    meta: {
      name: '服务端控件模板-客户端控件容器',
      assetType: 'server-control-template',
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

function writeProbe(options) {
  const studio = createStudio(makeProject(options))
  const exported = studio.exportData('gia')
  const bytes = Buffer.from(exported.data, 'base64')
  const compatibility = validateServerGiaCompatibility(bytes)
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
      controls: imported.snapshot.tree.map((row) => ({ name: row.name, kind: row.kind, depth: row.depth })),
    },
    warnings: exported.warnings,
  }
  writeFileSync(giaPath, bytes)
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  writeFileSync(authoringPath, `${JSON.stringify(studio._project, null, 2)}\n`, 'utf8')
  return { giaPath, manifestPath, authoringPath, ...manifest }
}

const minimal = writeProbe({
  includeAllControls: false,
  baseGuid: 1073742400,
  fileId: 1073741860,
  fileName: 'qxqy-server-client-container-minimal.gia',
})
const allControls = writeProbe({
  includeAllControls: true,
  baseGuid: 1073742420,
  fileId: 1073741861,
  fileName: 'qxqy-server-client-container-all-controls.gia',
})

process.stdout.write(`${JSON.stringify({ minimal, allControls }, null, 2)}\n`)
