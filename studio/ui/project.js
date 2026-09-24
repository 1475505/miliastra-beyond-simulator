import { CANVAS_PRESETS, DEFAULT_CANVAS_ID, CANONICAL_CANVAS_BY_PLATFORM, PLATFORMS, LAYOUT_SCHEMA_VERSION } from '../constants.js'
import { toJson } from '../json.js'
import {
  addChild,
  clientRoot,
  createDefaultClientTemplateProject,
  createDefaultProject,
  createNode,
  findNode,
  findParent,
  nextUniqueId,
  removeNode,
  sanitizeNode,
  selectedTemplateRoot,
  walk,
} from './authoring.js'
import {
  applyInspectorToTransform,
  canvasBox,
  computeRect,
  platformOfPreset,
  setAnchorPreset,
} from './layout.js'
import { readCurrentTransform, syncPlatformTransforms } from './sync.js'
import { hitTest, inspectorDto, layoutTree, painterBoxes, treeRows } from './inspector.js'
import { rawFieldDefinition, sanitizeRawFieldValue } from '../gia/raw-fields.js'
import { assignGuids } from '../gia/codec.js'
import { collectUsedGuids, nextFreeGuid } from '../gia/guid.js'
import { migrateLayout } from './migrate-layout.js'

function parentBoxOf(project, nodeId, boxes, canvasId = project.canvasId) {
  const parent = findParent(project.root, nodeId)
  if (!parent || parent.kind === 'server-container') return canvasBox(canvasId)
  return boxes[parent.id] || canvasBox(canvasId)
}

export function createProject(seed, { warnings = [] } = {}) {
  if (!seed) return createDefaultProject()
  seed = migrateLayout(seed, warnings)
  if ((seed.root || seed.layoutSchemaVersion !== undefined) && seed.layoutSchemaVersion !== LAYOUT_SCHEMA_VERSION) {
    throw new Error(`仅支持 layoutSchemaVersion=${LAYOUT_SCHEMA_VERSION} 的四平台布局，不支持旧画布布局或其他版本`)
  }
  const assetType = seed.meta?.assetType === 'client-control-template'
    ? 'client-control-template'
    : 'server-control-template'
  const base = assetType === 'client-control-template' ? createDefaultClientTemplateProject() : createDefaultProject()
  const project = {
    layoutSchemaVersion: LAYOUT_SCHEMA_VERSION,
    version: Number.isSafeInteger(seed.version) && seed.version > 0 ? seed.version : 1,
    meta: {
      name: String(seed.meta?.name || base.meta.name),
      assetType,
      sourceFormat: String(seed.meta?.sourceFormat || base.meta.sourceFormat),
      sourceFile: String(seed.meta?.sourceFile || ''),
      ...(seed.meta?.gameVersion ? { gameVersion: String(seed.meta.gameVersion) } : {}),
      ...(seed.meta?.giaFilePath ? { giaFilePath: String(seed.meta.giaFilePath) } : {}),
      ...(Number.isSafeInteger(Number(seed.meta?.giaOwnerUid)) ? { giaOwnerUid: Number(seed.meta.giaOwnerUid) } : {}),
      ...(Number.isSafeInteger(Number(seed.meta?.giaTimestamp)) ? { giaTimestamp: Number(seed.meta.giaTimestamp) } : {}),
      ...(Number.isSafeInteger(Number(seed.meta?.giaFileId)) ? { giaFileId: Number(seed.meta.giaFileId) } : {}),
      ...(seed.meta?.giaFileName ? { giaFileName: String(seed.meta.giaFileName) } : {}),
      ...(Number.isSafeInteger(Number(seed.meta?.giaModeFlag)) && Number(seed.meta.giaModeFlag) >= 0
        ? { giaModeFlag: Number(seed.meta.giaModeFlag) }
        : {}),
    },
    canvasId: seed.canvasId && CANVAS_PRESETS[seed.canvasId] ? seed.canvasId : DEFAULT_CANVAS_ID,
    selectedId: seed.selectedId || base.selectedId,
    root: sanitizeNode(seed.root || base.root),
  }
  validateProjectReferences(project)
  return project
}

function validateProjectReferences(project) {
  const ids = new Set()
  walk(project.root, (node) => {
    if (typeof node.id !== 'string' || !node.id) throw new Error('node id must be a non-empty string')
    if (ids.has(node.id)) throw new Error(`duplicate node id: ${node.id}`)
    ids.add(node.id)
  })
  if (!ids.has(project.selectedId)) project.selectedId = clientRoot(project.root).id
}

function nextUniqueGuid(root) {
  return nextFreeGuid(collectUsedGuids(root))
}

function isNodeInside(root, id) {
  let found = false
  walk(root, (node) => { if (node.id === id) found = true })
  return found
}

function reparentPreservingCurrentCanvas(project, node, oldParent, newParent) {
  const before = layoutTree(project.root, project.canvasId)
  const oldBox = before.boxes[node.id]
  const oldIndex = oldParent.children.findIndex((child) => child.id === node.id)
  if (oldIndex < 0) throw new Error('reparent: source node is not attached')
  oldParent.children.splice(oldIndex, 1)
  newParent.children.push(node)
  if (!oldBox) return
  const after = layoutTree(project.root, project.canvasId)
  const newParentBox = newParent.kind === 'server-container'
    ? canvasBox(project.canvasId)
    : after.boxes[newParent.id] || canvasBox(project.canvasId)
  const current = readCurrentTransform(node.transformByPlatform, project.canvasId)
  const next = applyInspectorToTransform(newParentBox, current, {
    posX: oldBox.centerX,
    posY: oldBox.centerY,
    width: oldBox.width,
    height: oldBox.height,
  })
  writeTransform(project, node, next)
}

function rowsForProject(project, guidById) {
  if (project.meta.assetType !== 'client-control-template') return treeRows(project.root, guidById)
  return (project.root.children || []).flatMap((node) => treeRows(node, guidById))
}

function visibleBoxesForProject(project, boxes) {
  const ordered = painterBoxes(project.root, boxes)
  if (project.meta.assetType !== 'client-control-template') return ordered
  const template = selectedTemplateRoot(project)
  const ids = new Set()
  if (template && template.kind !== 'server-container') walk(template, (node) => ids.add(node.id))
  return ordered.filter((box) => ids.has(box.id))
}

export function snapshotProject(project) {
  const { canvas, boxes } = layoutTree(project.root, project.canvasId)
  const guidById = assignGuids(project)
  const selected = findNode(project.root, project.selectedId)
  const selectedBox = selected ? boxes[selected.id] : null
  return toJson({
    layoutSchemaVersion: LAYOUT_SCHEMA_VERSION,
    version: project.version,
    meta: { ...project.meta },
    canvasId: project.canvasId,
    canvas: {
      id: project.canvasId,
      width: canvas.width,
      height: canvas.height,
      platform: CANVAS_PRESETS[project.canvasId].platform,
      label: CANVAS_PRESETS[project.canvasId].label,
      presets: Object.values(CANVAS_PRESETS).map((p) => ({
        id: p.id,
        label: p.label,
        width: p.width,
        height: p.height,
        platform: p.platform,
      })),
    },
    selectedId: project.selectedId,
    asset: {
      type: project.meta.assetType,
      label: project.meta.assetType === 'client-control-template' ? '客户端控件模板' : '服务端控件模板',
      templateCount: project.meta.assetType === 'client-control-template' ? project.root.children.length : 1,
      currentTemplateId: project.meta.assetType === 'client-control-template' ? selectedTemplateRoot(project)?.id || '' : '',
    },
    tree: rowsForProject(project, guidById),
    boxes: visibleBoxesForProject(project, boxes),
    inspector: inspectorDto(selected, project.canvasId, selectedBox || canvas, guidById),
    root: project.root,
  })
}

function writeTransform(project, node, nextRt) {
  const sourceLayout = layoutTree(project.root, project.canvasId)
  const sourceParentBox = parentBoxOf(project, node.id, sourceLayout.boxes)
  const targetParentBoxByPlatform = {}
  if (node.syncAllDevices !== false) {
    for (const platform of PLATFORMS) {
      if (platform === platformOfPreset(project.canvasId)) continue
      const canvasId = CANONICAL_CANVAS_BY_PLATFORM[platform]
      const targetLayout = layoutTree(project.root, canvasId, platform)
      targetParentBoxByPlatform[platform] = parentBoxOf(project, node.id, targetLayout.boxes, canvasId)
    }
  }
  node.transformByPlatform = syncPlatformTransforms({
    transformByPlatform: node.transformByPlatform,
    source: nextRt,
    canvasId: project.canvasId,
    syncAllDevices: node.syncAllDevices !== false,
    sourceParentBox,
    targetParentBoxByPlatform,
  })
}

const DIRECT_FIELDS = new Set([
  'name', 'active', 'visible', 'canControllerFocus',
  'isolateNavigation', 'disableKeyEventPassthrough', 'disableCursorEventPassthrough', 'showCursor',
  'fontSize', 'adaptiveFontSize', 'minimumFontSize', 'fontColor', 'bgColor',
  'enableOutline', 'outlineColor', 'horizontalAlignment', 'verticalAlignment', 'text',
  'imageId', 'imageColor', 'enableMask', 'enableSoftEdge', 'softEdgeMode',
  'softEdgeWidthX', 'softEdgeWidthY', 'horizontalSoftRange', 'verticalSoftRange',
  'enableFill', 'fillType', 'fillHorizontalType', 'fillVerticalType',
  'fillRadial90Type', 'fillRadialType', 'fillAmount', 'reverseMaskArea',
  'raycastTarget', 'interactable', 'clickAudioId', 'unavailableChildId',
  'hoverChildId', 'pressedChildId', 'selectedChildId',
  'showScrollBar', 'cellSizeX', 'cellSizeY', 'spacingX', 'spacingY',
  'padding1X', 'padding1Y', 'padding2X', 'padding2Y', 'previewCount',
  'scrollDirection', 'layoutConstraint', 'referencedPrefabId', 'animationId',
  'keyboardKeyCode', 'controllerKeyCode',
])

const COMPUTED = new Set(['posX', 'posY', 'width', 'height'])
const ANCHOR_KEYS = new Set(['anchorMinX', 'anchorMinY', 'anchorMaxX', 'anchorMaxY', 'pivotX', 'pivotY'])

function parseColor(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v >>> 0
  if (typeof v === 'string') {
    const s = v.trim()
    if (s.startsWith('#')) {
      const hex = s.slice(1)
      if (hex.length === 6) return (0xff000000 | parseInt(hex, 16)) >>> 0
      if (hex.length === 8) return parseInt(hex, 16) >>> 0
    }
    const n = Number(s)
    if (Number.isFinite(n)) return n >>> 0
  }
  throw new Error('color must be an ARGB integer or #RRGGBB/#AARRGGBB string')
}

function finiteNumber(value, key) {
  const number = Number(value)
  if (!Number.isFinite(number)) throw new Error(`${key} must be a finite number`)
  return number
}

function booleanValue(value) {
  if (value === true || value === 1 || value === '1' || value === 'true') return true
  if (value === false || value === 0 || value === '0' || value === 'false') return false
  throw new Error('boolean field requires true or false')
}

const NUMBER_FIELDS = new Set([
  'fontSize', 'minimumFontSize', 'imageId', 'clickAudioId', 'softEdgeWidthX',
  'softEdgeWidthY', 'horizontalSoftRange', 'verticalSoftRange', 'fillAmount',
  'cellSizeX', 'cellSizeY', 'spacingX', 'spacingY', 'padding1X', 'padding1Y',
  'padding2X', 'padding2Y', 'previewCount', 'keyboardKeyCode', 'controllerKeyCode',
])
const BOOLEAN_FIELDS = new Set([
  'active', 'visible', 'canControllerFocus', 'isolateNavigation',
  'disableKeyEventPassthrough', 'disableCursorEventPassthrough', 'showCursor',
  'adaptiveFontSize', 'enableOutline', 'enableMask', 'enableSoftEdge',
  'enableFill', 'reverseMaskArea', 'raycastTarget', 'interactable', 'showScrollBar',
])
const STRING_FIELDS = new Set([
  'name', 'horizontalAlignment', 'verticalAlignment', 'text', 'softEdgeMode',
  'fillType', 'fillHorizontalType', 'fillVerticalType', 'fillRadial90Type', 'fillRadialType',
  'scrollDirection', 'layoutConstraint', 'referencedPrefabId', 'animationId',
])
const STATE_NODE_FIELDS = new Set([
  'unavailableChildId', 'hoverChildId', 'pressedChildId', 'selectedChildId',
])
const ENUM_VALUES = {
  softEdgeMode: ['Percentage', 'Pixel'],
  fillType: ['Horizontal', 'Vertical', 'Radial90', 'Radial180', 'Radial360'],
  fillHorizontalType: ['Left', 'Right'],
  fillVerticalType: ['Bottom', 'Top'],
  fillRadial90Type: ['BottomLeft', 'TopLeft', 'TopRight', 'BottomRight'],
  fillRadialType: ['Bottom', 'Left', 'Top', 'Right'],
}

function applyPatchMutating(project, op) {
  if (!op || typeof op !== 'object') throw new Error('patch requires op')
  const type = op.op
  if (type === 'select') {
    if (op.id && findNode(project.root, op.id)) project.selectedId = op.id
    return project
  }
  if (type === 'pick') {
    const { boxes } = layoutTree(project.root, project.canvasId)
    const visible = visibleBoxesForProject(project, boxes)
    const id = hitTest(visible, Number(op.x), Number(op.y))
    if (id) project.selectedId = id
    return project
  }
  if (type === 'setCanvas') {
    if (op.canvasId && CANVAS_PRESETS[op.canvasId]) project.canvasId = op.canvasId
    return project
  }
  if (type === 'setScript') {
    throw new Error('脚本由存档统一管理，请使用 addScript / updateScript / removeScript 操作')
  }
  if (type === 'newAsset') {
    const next = op.assetType === 'client-control-template'
      ? createDefaultClientTemplateProject()
      : createDefaultProject()
    project.version = next.version
    project.meta = next.meta
    project.canvasId = next.canvasId
    project.selectedId = next.selectedId
    project.root = next.root
    return project
  }
  if (type === 'addTemplate') {
    if (project.meta.assetType !== 'client-control-template') throw new Error('只有客户端控件模板工程可以新增模板')
    const child = createNode(op.kind, {
      id: nextUniqueId(project.root),
      guid: nextUniqueGuid(project.root),
      name: op.name || `新${op.kind === 'container' ? '容器节点' : op.kind}模板`,
    })
    project.root.children.push(child)
    project.selectedId = child.id
    return project
  }
  if (type === 'add') {
    const parent = findNode(project.root, op.parentId || project.selectedId)
    if (!parent) throw new Error('add: parent not found')
    const child = addChild(parent, op.kind, {
      id: nextUniqueId(project.root),
      guid: nextUniqueGuid(project.root),
      name: op.name,
    })
    project.selectedId = child.id
    return project
  }
  if (type === 'reparent') {
    if (project.meta.assetType !== 'client-control-template') throw new Error('层级调整仅适用于客户端控件模板工程')
    const node = findNode(project.root, op.id || project.selectedId)
    const oldParent = node ? findParent(project.root, node.id) : null
    const newParent = findNode(project.root, op.parentId)
    if (!node || node.kind === 'server-container' || !oldParent) throw new Error('reparent: node not found')
    if (!newParent) throw new Error('reparent: parent not found')
    if (newParent.id === node.id || isNodeInside(node, newParent.id)) throw new Error('控件不能移动到自身或其后代下面')
    if (newParent.kind === 'server-container' && oldParent.kind === 'server-container') return project
    if (oldParent.kind === 'server-container' && newParent.kind !== 'server-container' && project.root.children.length <= 1) {
      throw new Error('客户端控件模板列表至少保留一个顶层模板')
    }
    reparentPreservingCurrentCanvas(project, node, oldParent, newParent)
    project.selectedId = node.id
    return project
  }
  if (type === 'moveSibling') {
    const node = findNode(project.root, op.id || project.selectedId)
    const parent = node ? findParent(project.root, node.id) : null
    if (!node || !parent) throw new Error('moveSibling: node not found')
    const from = parent.children.findIndex((child) => child.id === node.id)
    const delta = op.direction === 'up' ? -1 : op.direction === 'down' ? 1 : 0
    const to = from + delta
    if (!delta || to < 0 || to >= parent.children.length) return project
    parent.children.splice(from, 1)
    parent.children.splice(to, 0, node)
    project.selectedId = node.id
    return project
  }
  if (type === 'remove') {
    const id = op.id || project.selectedId
    const parent = findParent(project.root, id)
    if (parent?.kind === 'server-container') {
      if (project.meta.assetType !== 'client-control-template') throw new Error('服务端控件模板的客户端根节点不能删除')
      if ((project.root.children || []).length <= 1) throw new Error('客户端控件模板列表至少保留一个模板')
    }
    if (removeNode(project.root, id)) {
      walk(project.root, (node) => {
        if (node.kind !== 'button') return
        for (const key of STATE_NODE_FIELDS) {
          if (node[key] && !findNode(project.root, node[key])) node[key] = null
        }
      })
      project.selectedId = parent ? parent.id : project.root.id
    }
    return project
  }
  if (type === 'set') {
    const node = findNode(project.root, op.id || project.selectedId)
    if (!node) throw new Error('set: node not found')
    let key = op.key
    if (key === 'reverseMask') key = 'reverseMaskArea'
    let value = op.value
    if (key.startsWith('giaRaw.')) {
      const rawKey = key.slice('giaRaw.'.length)
      if (!rawKey || rawKey.includes('.')) throw new Error('invalid raw GIA field path')
      const definition = rawFieldDefinition(node.kind, rawKey)
      if (!definition) throw new Error(`unknown raw GIA field for ${node.kind}: ${rawKey}`)
      node.giaRaw ||= {}
      node.giaRaw[rawKey] = sanitizeRawFieldValue(definition, value)
      if ((node.kind === 'textbox' || node.kind === 'textwindow') && rawKey === 'textAlign') {
        const alignment = { 0: 'Left', 1: 'Middle', 2: 'Right' }[node.giaRaw[rawKey]]
        if (alignment) node.horizontalAlignment = alignment
      }
      if (node.kind === 'image' && rawKey === 'imageFillType') {
        const fillType = { 1: 'Horizontal', 2: 'Vertical', 3: 'Radial90', 4: 'Radial180', 5: 'Radial360' }[node.giaRaw[rawKey]]
        if (fillType) node.fillType = fillType
      }
      if (node.kind === 'keyhint' && rawKey === 'keyHintField502') node.keyboardKeyCode = node.giaRaw[rawKey]
      if (node.kind === 'keyhint' && rawKey === 'keyHintField501') node.controllerKeyCode = node.giaRaw[rawKey]
      return project
    }
    if (key === 'syncAllDevices') {
      node.syncAllDevices = booleanValue(value)
      if (node.syncAllDevices) {
        const current = readCurrentTransform(node.transformByPlatform, project.canvasId)
        writeTransform(project, node, current)
      }
      return project
    }
    if (DIRECT_FIELDS.has(key)) {
      if (key.endsWith('Color')) value = parseColor(value)
      if (NUMBER_FIELDS.has(key)) {
        value = finiteNumber(value, key)
        if (value < 0) throw new Error(`${key} must not be negative`)
        if (key === 'imageId' || key === 'clickAudioId' || key === 'keyboardKeyCode' || key === 'controllerKeyCode') value = Math.trunc(value)
        if (key === 'fillAmount' && value > 1) throw new Error('fillAmount must be between 0 and 1')
      }
      if (BOOLEAN_FIELDS.has(key)) value = booleanValue(value)
      if (STRING_FIELDS.has(key)) value = String(value ?? '')
      if (key === 'horizontalAlignment' && !['Left', 'Middle', 'Right'].includes(value)) {
        throw new Error('invalid horizontalAlignment')
      }
      if (key === 'verticalAlignment' && !['Top', 'Middle', 'Bottom'].includes(value)) {
        throw new Error('invalid verticalAlignment')
      }
      if (ENUM_VALUES[key] && !ENUM_VALUES[key].includes(value)) {
        throw new Error(`invalid ${key}`)
      }
      if (STATE_NODE_FIELDS.has(key)) {
        if (value === '' || value === undefined || value === null) value = null
        else {
          value = String(value)
          const stateNode = findNode(project.root, value)
          if (!stateNode || stateNode === node || stateNode.kind === 'server-container' || !(node.children || []).some((child) => child.id === value)) {
            throw new Error(`${key} must reference a direct child of this button`)
          }
        }
      }
      node[key] = value
      if ((node.kind === 'textbox' || node.kind === 'textwindow') && key === 'horizontalAlignment') {
        node.giaRaw.textAlign = { Left: 0, Middle: 1, Right: 2 }[value]
      }
      if (node.kind === 'image' && key === 'fillType') {
        const rawFillType = { Horizontal: 1, Vertical: 2, Radial90: 3, Radial180: 4, Radial360: 5 }[value]
        if (rawFillType) node.giaRaw.imageFillType = rawFillType
      }
      if (node.kind === 'reference' && key === 'referencedPrefabId') node.giaRaw.templateRefSlot = value
      if (node.kind === 'grid' && key === 'previewCount') node.giaRaw.gridField511 = Math.trunc(value)
      if (node.kind === 'keyhint' && key === 'keyboardKeyCode') node.giaRaw.keyHintField502 = Math.trunc(value)
      if (node.kind === 'keyhint' && key === 'controllerKeyCode') node.giaRaw.keyHintField501 = Math.trunc(value)
      if ((node.kind === 'animation' || node.kind === 'fullscreen') && key === 'animationId') {
        node.giaRaw[node.kind === 'animation' ? 'effectSlot' : 'fullscreenEffectSlot'] = value
      }
      return project
    }
    const { boxes } = layoutTree(project.root, project.canvasId)
    const pBox = parentBoxOf(project, node.id, boxes)
    const current = readCurrentTransform(node.transformByPlatform, project.canvasId)
    if (key === 'anchorType') {
      const vis = inspectorFromRectSafe(boxes[node.id])
      let next = setAnchorPreset(current, value)
      next = applyInspectorToTransform(pBox, next, vis)
      writeTransform(project, node, next)
      return project
    }
    if (key === 'rotationZ') {
      const next = {
        ...current,
        rotation: { ...current.rotation, z: finiteNumber(value, key) },
      }
      writeTransform(project, node, next)
      return project
    }
    if (ANCHOR_KEYS.has(key)) {
      const vis = inspectorFromRectSafe(boxes[node.id])
      const next = { ...current, anchorMin: { ...current.anchorMin }, anchorMax: { ...current.anchorMax }, pivot: { ...current.pivot } }
      if (key === 'anchorMinX') next.anchorMin.x = finiteNumber(value, key)
      if (key === 'anchorMinY') next.anchorMin.y = finiteNumber(value, key)
      if (key === 'anchorMaxX') next.anchorMax.x = finiteNumber(value, key)
      if (key === 'anchorMaxY') next.anchorMax.y = finiteNumber(value, key)
      if (key === 'pivotX') next.pivot.x = finiteNumber(value, key)
      if (key === 'pivotY') next.pivot.y = finiteNumber(value, key)
      writeTransform(project, node, applyInspectorToTransform(pBox, next, vis))
      return project
    }
    if (COMPUTED.has(key)) {
      const vis = inspectorFromRectSafe(boxes[node.id])
      const numeric = finiteNumber(value, key)
      if ((key === 'width' || key === 'height') && numeric < 0) throw new Error(`${key} must not be negative`)
      vis[key] = numeric
      writeTransform(project, node, applyInspectorToTransform(pBox, current, vis))
      return project
    }
    throw new Error(`set: unknown key ${key}`)
  }
  if (type === 'replace') {
    const next = createProject(op.project)
    project.version = next.version
    project.meta = next.meta
    project.canvasId = next.canvasId
    project.selectedId = next.selectedId
    project.root = next.root
    return project
  }
  throw new Error(`unknown op ${type}`)
}

export function applyPatch(project, op) {
  if (!op || typeof op !== 'object') throw new Error('patch requires op')
  if (op.expectedRevision !== undefined && Number(op.expectedRevision) !== project.version) {
    throw new Error(`revision conflict: expected ${op.expectedRevision}, current ${project.version}`)
  }
  const previousVersion = project.version
  const next = JSON.parse(JSON.stringify(project))
  applyPatchMutating(next, op)
  validateProjectReferences(next)
  next.version = previousVersion + 1
  Object.keys(project).forEach((key) => { delete project[key] })
  Object.assign(project, next)
  return project
}

function inspectorFromRectSafe(box) {
  if (!box) return { posX: 0, posY: 0, width: 0, height: 0 }
  return { posX: box.centerX, posY: box.centerY, width: box.width, height: box.height }
}
