import {
  CANVAS_PRESETS,
  COLOR,
  DEFAULT_CLICK_AUDIO_ID,
  DEFAULT_SIZE,
  KIND_LABELS,
  PLATFORMS,
} from '../constants.js'
import { createRectTransform, cloneRectTransform, emptyCanvasMap, emptyPlatformMap } from './layout.js'
import { createGiaRaw } from '../gia/raw-fields.js'
import { stampMissingGuids } from '../gia/guid.js'

let _seq = 1
export function nextId(prefix = 'n') {
  const id = `${prefix}${_seq}`
  _seq += 1
  return id
}

export function resetIdSeq(n = 1) {
  _seq = n
}

export function defaultLayoutForKind(kind, { isRootContainer = false } = {}) {
  if (kind === 'server-container' || kind === 'fullscreen' || (kind === 'container' && isRootContainer)) {
    return createRectTransform({ layout: 'stretch' })
  }
  const size = DEFAULT_SIZE[kind] || [80, 80]
  return createRectTransform({ layout: 'center', size })
}

function fourPlatforms(kind, opts) {
  return emptyPlatformMap(() => defaultLayoutForKind(kind, opts))
}

function fiveCanvases(kind, opts) {
  return emptyCanvasMap(() => defaultLayoutForKind(kind, opts))
}

function clonePlatformMap(src, kind, opts) {
  const fallback = defaultLayoutForKind(kind, opts)
  const out = {}
  for (const p of PLATFORMS) {
    out[p] = cloneRectTransform((src && src[p]) || fallback)
  }
  return out
}


function cloneCanvasMap(src, platformMap, kind, opts) {
  const fallback = defaultLayoutForKind(kind, opts)
  const out = {}
  for (const [id, preset] of Object.entries(CANVAS_PRESETS)) {
    out[id] = cloneRectTransform((src && src[id]) || (platformMap && platformMap[preset.platform]) || fallback)
  }
  return out
}

export function createNode(kind, extras = {}) {
  if (!KIND_LABELS[kind]) throw new Error(`unknown kind: ${kind}`)
  const isRootContainer = extras.isRootContainer === true
  const id = extras.id || nextId(kind === 'server-container' ? 'sc' : 'n')
  const transformByPlatform = extras.transformByPlatform
    ? clonePlatformMap(extras.transformByPlatform, kind, { isRootContainer })
    : fourPlatforms(kind, { isRootContainer })
  const node = {
    id,
    kind,
    name: extras.name || KIND_LABELS[kind],
    guid: extras.guid ?? 0,
    giaRelatedGuids: Array.isArray(extras.giaRelatedGuids)
      ? extras.giaRelatedGuids.filter((guid) => Number.isSafeInteger(Number(guid)) && Number(guid) > 0).map(Number)
      : [],
    ...(Number.isSafeInteger(Number(extras.giaInfoIndex)) && Number(extras.giaInfoIndex) > 0
      ? { giaInfoIndex: Number(extras.giaInfoIndex) }
      : {}),
    active: extras.active !== false,
    visible: extras.visible !== false,
    canControllerFocus: extras.canControllerFocus === true,
    syncAllDevices: extras.syncAllDevices !== false,
    giaRaw: createGiaRaw(kind, extras.giaRaw),
    transformByPlatform,
    transformByCanvas: extras.transformByCanvas
      ? cloneCanvasMap(extras.transformByCanvas, transformByPlatform, kind, { isRootContainer })
      // GIA stores four platform RectTransforms.  Preview/editing reads the
      // five canvas transforms, so an imported GIA must seed each canvas from
      // its corresponding platform slot instead of falling back to defaults.
      : extras.transformByPlatform
        ? cloneCanvasMap(null, transformByPlatform, kind, { isRootContainer })
        : fiveCanvases(kind, { isRootContainer }),
    children: [],
    scriptMappingIds: Array.isArray(extras.scriptMappingIds)
      ? extras.scriptMappingIds.filter((guid) => Number.isSafeInteger(Number(guid)) && Number(guid) > 0).map(Number)
      : [],
  }
  if (kind === 'container') {
    node.isolateNavigation = extras.isolateNavigation === true
    node.disableKeyEventPassthrough = extras.disableKeyEventPassthrough === true
    node.disableCursorEventPassthrough = extras.disableCursorEventPassthrough === true
    node.showCursor = extras.showCursor === true
  }
  if (kind === 'textbox' || kind === 'textwindow') {
    node.fontSize = extras.fontSize ?? 20
    node.adaptiveFontSize = extras.adaptiveFontSize === true
    node.minimumFontSize = extras.minimumFontSize ?? 20
    node.fontColor = extras.fontColor ?? COLOR.font
    node.bgColor = extras.bgColor ?? COLOR.bg
    node.enableOutline = extras.enableOutline !== false
    node.outlineColor = extras.outlineColor ?? COLOR.outline
    node.horizontalAlignment = extras.horizontalAlignment || 'Left'
    node.verticalAlignment = extras.verticalAlignment || 'Top'
    node.text = extras.text ?? ''
    if (!Object.hasOwn(extras.giaRaw || {}, 'textAlign')) {
      node.giaRaw.textAlign = { Left: 0, Middle: 1, Right: 2 }[node.horizontalAlignment] ?? node.giaRaw.textAlign
    }
    if (kind === 'textwindow') {
      node.interactable = extras.interactable !== false
      node.showScrollBar = extras.showScrollBar !== false
    }
  }
  if (kind === 'image') {
    node.imageSource = extras.imageSource || 'StaticReference'
    node.imageId = extras.imageId ?? 100001
    node.imageColor = extras.imageColor ?? COLOR.image
    node.enableMask = extras.enableMask === true
    node.enableSoftEdge = extras.enableSoftEdge === true
    node.softEdgeMode = extras.softEdgeMode || 'Percentage'
    node.softEdgeWidthX = extras.softEdgeWidthX ?? 8
    node.softEdgeWidthY = extras.softEdgeWidthY ?? 8
    node.horizontalSoftRange = extras.horizontalSoftRange ?? 85
    node.verticalSoftRange = extras.verticalSoftRange ?? 85
    node.enableFill = extras.enableFill === true
    node.fillType = extras.fillType || 'Horizontal'
    node.fillHorizontalType = extras.fillHorizontalType || 'Left'
    node.fillVerticalType = extras.fillVerticalType || 'Bottom'
    node.fillRadial90Type = extras.fillRadial90Type || 'BottomLeft'
    node.fillRadialType = extras.fillRadialType || 'Bottom'
    node.fillAmount = extras.fillAmount ?? 1
    node.reverseMaskArea = extras.reverseMaskArea === true || extras.reverseMask === true
    if (!Object.hasOwn(extras.giaRaw || {}, 'imageFillType')) {
      node.giaRaw.imageFillType = { Horizontal: 1, Vertical: 2, Radial90: 3, Radial180: 4, Radial360: 5 }[node.fillType] ?? node.giaRaw.imageFillType
    }
  }
  if (kind === 'button') {
    node.raycastTarget = extras.raycastTarget !== false
    node.interactable = extras.interactable !== false
    node.clickAudioId = extras.clickAudioId ?? DEFAULT_CLICK_AUDIO_ID
    node.unavailableChildId = extras.unavailableChildId ?? null
    node.hoverChildId = extras.hoverChildId ?? null
    node.pressedChildId = extras.pressedChildId ?? null
    node.selectedChildId = extras.selectedChildId ?? null
  }
  if (kind === 'cursor') node.raycastTarget = extras.raycastTarget !== false
  if (kind === 'reference') {
    node.referencedPrefabId = extras.referencedPrefabId ?? extras.giaRaw?.templateRefSlot ?? null
    if (!Object.hasOwn(extras.giaRaw || {}, 'templateRefSlot')) {
      node.giaRaw.templateRefSlot = String(node.referencedPrefabId ?? '')
    }
  }
  if (kind === 'grid') {
    node.itemPrefabId = extras.itemPrefabId ?? null
    node.raycastTarget = extras.raycastTarget !== false
    node.interactable = extras.interactable !== false
    node.showScrollBar = extras.showScrollBar !== false
    node.scrollDirection = extras.scrollDirection || 'Vertical'
    node.layoutConstraint = extras.layoutConstraint || 'AutoWrap'
    node.layoutConstraintFixedCount = extras.layoutConstraintFixedCount ?? null
    node.cellSizeX = extras.cellSizeX ?? 50
    node.cellSizeY = extras.cellSizeY ?? 50
    node.spacingX = extras.spacingX ?? 8
    node.spacingY = extras.spacingY ?? 8
    node.padding1X = extras.padding1X ?? 20
    node.padding1Y = extras.padding1Y ?? 20
    node.padding2X = extras.padding2X ?? 20
    node.padding2Y = extras.padding2Y ?? 20
    node.previewCount = extras.previewCount ?? extras.giaRaw?.gridField511 ?? 5
    if (!Object.hasOwn(extras.giaRaw || {}, 'gridField511')) node.giaRaw.gridField511 = Math.trunc(node.previewCount)
  }
  if (kind === 'keyhint') {
    node.keyboardKeyCode = extras.keyboardKeyCode ?? extras.giaRaw?.keyHintField502 ?? null
    node.controllerKeyCode = extras.controllerKeyCode ?? extras.giaRaw?.keyHintField501 ?? null
    if (!Object.hasOwn(extras.giaRaw || {}, 'keyHintField502')) {
      node.giaRaw.keyHintField502 = Math.trunc(node.keyboardKeyCode ?? 1)
    }
    if (!Object.hasOwn(extras.giaRaw || {}, 'keyHintField501')) {
      node.giaRaw.keyHintField501 = Math.trunc(node.controllerKeyCode ?? 1)
    }
  }
  if (kind === 'animation' || kind === 'fullscreen') {
    const rawAnimationId = kind === 'animation' ? extras.giaRaw?.effectSlot : extras.giaRaw?.fullscreenEffectSlot
    node.animationId = extras.animationId ?? rawAnimationId ?? null
    node.playSoundEffect = extras.playSoundEffect ?? null
    if (kind === 'animation') node.layer = extras.layer ?? null
    const slotKey = kind === 'animation' ? 'effectSlot' : 'fullscreenEffectSlot'
    if (!Object.hasOwn(extras.giaRaw || {}, slotKey)) node.giaRaw[slotKey] = String(node.animationId ?? '')
  }
  if (extras.children) {
    for (const child of extras.children) node.children.push(child)
  }
  return node
}

export function createDefaultProject() {
  resetIdSeq(1)
  const server = createNode('server-container', { id: 'sc1', name: '客户端控件容器' })
  const root = createNode('container', {
    id: 'n1',
    name: '容器节点',
    isRootContainer: true,
  })
  const text = createNode('textbox', {
    id: 'n2',
    name: '文本框',
    text: '文本',
  })
  const cursor = createNode('cursor', { id: 'n3', name: '光标检测区域' })
  const reference = createNode('reference', { id: 'n4', name: '模板引用控件' })
  const grid = createNode('grid', { id: 'n5', name: '网格视窗' })
  const button = createNode('button', { id: 'n6', name: '预设按钮' })
  const textwindow = createNode('textwindow', { id: 'n7', name: '文本视窗' })
  const keyhint = createNode('keyhint', { id: 'n8', name: '按键提示' })
  const image = createNode('image', { id: 'n9', name: '图片', imageId: 100005 })
  const animation = createNode('animation', { id: 'n10', name: '界面动效' })
  const fullscreen = createNode('fullscreen', { id: 'n11', name: '全屏动效' })
  const place = (node, x, y) => {
    for (const rt of Object.values(node.transformByPlatform)) rt.offset = { x, y }
    for (const rt of Object.values(node.transformByCanvas)) rt.offset = { x, y }
  }
  place(text, -300, 250)
  place(cursor, -300, 140)
  place(reference, -300, 30)
  place(grid, -300, -100)
  place(button, 0, 0)
  place(textwindow, 300, 250)
  place(keyhint, 300, 140)
  place(image, 300, 30)
  place(animation, 300, -100)
  root.children.push(text, cursor, reference, grid, button, textwindow, keyhint, image, animation, fullscreen)
  server.children.push(root)
  resetIdSeq(12)
  stampMissingGuids(server)
  return {
    version: 1,
    meta: {
      name: '未命名界面控件组',
      assetType: 'server-control-template',
      sourceFormat: 'authoring',
      sourceFile: '',
    },
    canvasId: 'pc-16-9',
    selectedId: 'n2',
    root: server,
  }
}

export function createDefaultClientTemplateProject() {
  resetIdSeq(1)
  const server = createNode('server-container', { id: 'sc1', name: '客户端控件模板' })
  const root = createNode('container', {
    id: 'n1',
    guid: 1073742100,
    name: 'Lua实例化面板',
  })
  const title = createNode('textbox', {
    id: 'n2',
    guid: 1073742101,
    name: '模板标题',
    text: '客户端模板已实例化',
    fontSize: 28,
    horizontalAlignment: 'Middle',
  })
  const icon = createNode('image', {
    id: 'n3',
    guid: 1073742102,
    name: '模板图标',
    imageId: 100005,
  })
  const button = createNode('button', {
    id: 'n4',
    guid: 1073742103,
    name: '确认按钮',
  })
  const buttonText = createNode('textbox', {
    id: 'n5',
    guid: 1073742104,
    name: '按钮文字',
    text: '确认',
    horizontalAlignment: 'Middle',
    verticalAlignment: 'Top',
  })
  const place = (node, x, y) => {
    for (const rt of Object.values(node.transformByPlatform)) rt.offset = { x, y }
    for (const rt of Object.values(node.transformByCanvas)) rt.offset = { x, y }
  }
  const resize = (node, x, y) => {
    for (const rt of Object.values(node.transformByPlatform)) rt.size = { x, y }
    for (const rt of Object.values(node.transformByCanvas)) rt.size = { x, y }
  }
  resize(root, 520, 320)
  place(title, 0, 110)
  place(icon, 0, 0)
  place(button, 0, -110)
  button.children.push(buttonText)
  root.children.push(title, icon, button)
  server.children.push(root)
  resetIdSeq(6)
  return {
    version: 1,
    meta: {
      name: 'Lua实例化面板',
      assetType: 'client-control-template',
      sourceFormat: 'authoring',
      sourceFile: '',
      gameVersion: '7.0.50',
      giaOwnerUid: 114514,
      giaFileId: 1073741829,
      giaFileName: '客户端控件模板列表.gia',
    },
    canvasId: 'pc-16-9',
    selectedId: 'n1',
    root: server,
  }
}

export function walk(node, fn, parent = null) {
  fn(node, parent)
  for (const child of node.children || []) walk(child, fn, node)
}

export function findNode(root, id) {
  let hit = null
  walk(root, (node) => {
    if (node.id === id) hit = node
  })
  return hit
}

export function nextUniqueId(root, prefix = 'n') {
  let id = nextId(prefix)
  while (findNode(root, id)) id = nextId(prefix)
  return id
}

export function findParent(root, id) {
  let hit = null
  walk(root, (node, parent) => {
    if (node.id === id) hit = parent
  })
  return hit
}

export function clientRoot(serverOrProject) {
  const root = serverOrProject.root || serverOrProject
  if (root.kind === 'container') return root
  return (root.children || []).find((c) => c.kind === 'container') || (root.children || [])[0] || root
}

export function selectedTemplateRoot(project) {
  if (project.meta?.assetType !== 'client-control-template') return clientRoot(project)
  let selected = findNode(project.root, project.selectedId)
  if (!selected || selected.kind === 'server-container') return project.root.children?.[0] || project.root
  let parent = findParent(project.root, selected.id)
  while (parent && parent.kind !== 'server-container') {
    selected = parent
    parent = findParent(project.root, selected.id)
  }
  return selected
}

export function sanitizeNode(node) {
  const extras = {
    id: node.id,
    name: node.name,
    guid: node.guid,
    giaRelatedGuids: node.giaRelatedGuids,
    giaInfoIndex: node.giaInfoIndex,
    scriptMappingIds: node.scriptMappingIds,
    giaRaw: node.giaRaw,
    active: node.active,
    visible: node.visible,
    canControllerFocus: node.canControllerFocus,
    syncAllDevices: node.syncAllDevices,
    transformByPlatform: {},
    transformByCanvas: {},
  }
  for (const [plat, rt] of Object.entries(node.transformByPlatform || {})) {
    extras.transformByPlatform[plat] = cloneRectTransform(rt)
  }
  for (const [canvasId, rt] of Object.entries(node.transformByCanvas || {})) {
    extras.transformByCanvas[canvasId] = cloneRectTransform(rt)
  }
  if (node.kind === 'container') {
    extras.isolateNavigation = node.isolateNavigation
    extras.disableKeyEventPassthrough = node.disableKeyEventPassthrough
    extras.disableCursorEventPassthrough = node.disableCursorEventPassthrough
    extras.showCursor = node.showCursor
  }
  if (node.kind === 'textbox' || node.kind === 'textwindow') {
    extras.fontSize = node.fontSize
    extras.adaptiveFontSize = node.adaptiveFontSize
    extras.minimumFontSize = node.minimumFontSize
    extras.fontColor = node.fontColor
    extras.bgColor = node.bgColor
    extras.enableOutline = node.enableOutline
    extras.outlineColor = node.outlineColor
    extras.horizontalAlignment = node.horizontalAlignment
    extras.verticalAlignment = node.verticalAlignment
    extras.text = node.text ?? ''
    if (node.kind === 'textwindow') {
      extras.interactable = node.interactable
      extras.showScrollBar = node.showScrollBar
    }
  }
  if (node.kind === 'image') {
    extras.imageSource = node.imageSource
    extras.imageId = node.imageId
    extras.imageColor = node.imageColor
    extras.enableMask = node.enableMask
    extras.enableSoftEdge = node.enableSoftEdge
    extras.softEdgeMode = node.softEdgeMode
    extras.softEdgeWidthX = node.softEdgeWidthX
    extras.softEdgeWidthY = node.softEdgeWidthY
    extras.horizontalSoftRange = node.horizontalSoftRange
    extras.verticalSoftRange = node.verticalSoftRange
    extras.enableFill = node.enableFill
    extras.fillType = node.fillType
    extras.fillHorizontalType = node.fillHorizontalType
    extras.fillVerticalType = node.fillVerticalType
    extras.fillRadial90Type = node.fillRadial90Type
    extras.fillRadialType = node.fillRadialType
    extras.fillAmount = node.fillAmount
    extras.reverseMaskArea = node.reverseMaskArea ?? node.reverseMask
  }
  if (node.kind === 'button') {
    extras.raycastTarget = node.raycastTarget
    extras.interactable = node.interactable
    extras.clickAudioId = node.clickAudioId
    extras.unavailableChildId = node.unavailableChildId ?? null
    extras.hoverChildId = node.hoverChildId ?? null
    extras.pressedChildId = node.pressedChildId ?? null
    extras.selectedChildId = node.selectedChildId ?? null
  }
  if (node.kind === 'cursor') extras.raycastTarget = node.raycastTarget
  if (node.kind === 'reference') extras.referencedPrefabId = node.referencedPrefabId ?? null
  if (node.kind === 'grid') {
    extras.itemPrefabId = node.itemPrefabId ?? null
    extras.raycastTarget = node.raycastTarget
    extras.interactable = node.interactable
    extras.showScrollBar = node.showScrollBar
    extras.scrollDirection = node.scrollDirection
    extras.layoutConstraint = node.layoutConstraint
    extras.layoutConstraintFixedCount = node.layoutConstraintFixedCount ?? null
    extras.cellSizeX = node.cellSizeX
    extras.cellSizeY = node.cellSizeY
    extras.spacingX = node.spacingX
    extras.spacingY = node.spacingY
    extras.padding1X = node.padding1X
    extras.padding1Y = node.padding1Y
    extras.padding2X = node.padding2X
    extras.padding2Y = node.padding2Y
    extras.previewCount = node.previewCount
  }
  if (node.kind === 'keyhint') {
    extras.keyboardKeyCode = node.keyboardKeyCode ?? null
    extras.controllerKeyCode = node.controllerKeyCode ?? null
  }
  if (node.kind === 'animation' || node.kind === 'fullscreen') {
    extras.animationId = node.animationId ?? null
    extras.playSoundEffect = node.playSoundEffect ?? null
    if (node.kind === 'animation') extras.layer = node.layer ?? null
  }
  extras.isRootContainer = node.kind === 'container' && looksFullscreen(node.transformByPlatform)
  const clean = createNode(node.kind, extras)
  clean.children = (node.children || []).map((c) => sanitizeNode(c))
  return clean
}

function looksFullscreen(map) {
  const rt = map && (map.KEYBOARD || Object.values(map)[0])
  if (!rt) return false
  return Math.abs((rt.anchorMin?.x ?? 0.5)) < 1e-4
    && Math.abs((rt.anchorMin?.y ?? 0.5)) < 1e-4
    && Math.abs((rt.anchorMax?.x ?? 0.5) - 1) < 1e-4
    && Math.abs((rt.anchorMax?.y ?? 0.5) - 1) < 1e-4
}

export function addChild(parent, kind, extras = {}) {
  if (parent.kind === 'server-container' && kind !== 'container') {
    throw new Error('server container only accepts container nodes')
  }
  const child = createNode(kind, extras)
  parent.children.push(child)
  return child
}

export function removeNode(root, id) {
  if (root.id === id) throw new Error('cannot remove root')
  const parent = findParent(root, id)
  if (!parent) return false
  const i = parent.children.findIndex((c) => c.id === id)
  if (i < 0) return false
  parent.children.splice(i, 1)
  return true
}
