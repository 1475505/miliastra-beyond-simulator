import protobuf from 'protobufjs'
import { PLATFORMS, LAYOUT_SCHEMA_VERSION } from '../constants.js'
import { assertPlatformNode } from '../ui/transforms.js'
import { toJson } from '../json.js'
import { createNode, walk } from '../ui/authoring.js'
import { GUID_BASE, collectUsedGuids, isValidGuid, nextFreeGuid } from './guid.js'

export { GUID_BASE, collectUsedGuids, isValidGuid, nextFreeGuid }

const GIA_PROTO = String.raw`
syntax = "proto3";
// Root.graph is singular in the game's canonical schema, but template-list
// assets legally emit field 1 more than once.  Model it as repeated here so
// protobufjs does not discard every template except the last one while reading.
message Root { repeated GraphUnit graph = 1; repeated GraphUnit accessories = 2; string filePath = 3; optional uint32 modeFlag = 4; string gameVersion = 5; }
message GraphUnit {
  message Id { int32 class = 2; int32 type = 3; int32 id = 4; }
  Id id = 1; repeated Id relatedIds = 2; string name = 3; int32 which = 5; UiControlGroup ui = 19;
  ScriptMappingWrapper script = 35;
}
message ScriptMappingWrapper { ScriptMapping mapping = 1; }
message ScriptMapping { uint32 id = 1; string name = 2; string file_path = 3; string source = 5; }
message UiControlGroup {
  ContentWrapper content = 1;
  message ContentWrapper {
    uint32 guid = 501; repeated Info info = 502; repeated uint32 children = 503; uint32 parent = 504; repeated Data data = 505;
    message Info {
      oneof value { WrapperGuid guid = 11; WrapperInt32 index = 12; WrapperGuidList related = 14; string empty15 = 15; string empty16 = 16; }
      int32 field501 = 501; int32 field502 = 502; InfoDetails details = 503;
    }
    message InfoDetails { oneof value { string empty15 = 15; string empty17 = 17; } int32 field501 = 501; int32 field502 = 502; int32 field503 = 503; }
    message Data {
      oneof value {
        Transform transform = 11; WrapperString name = 12; Field14 field14 = 14;
        string empty72 = 72; string empty73 = 73; string empty74 = 74; string empty75 = 75;
        string empty76 = 76; string empty77 = 77; string empty78 = 78; string empty79 = 79;
        string empty80 = 80; string empty81 = 81; string empty82 = 82; string empty83 = 83;
        string empty84 = 84; string empty85 = 85; string empty86 = 86;
      }
      int32 field501 = 501; int32 field502 = 502; Details details = 503;
    }
    message Details {
      oneof value {
        Transform transform = 13; Field14 field14 = 14; RootChildRef rootChildRef = 73;
        GenericSlot genericSlot = 74; TextConfig textConfig = 75; CursorConfig cursorConfig = 76;
        string templateRefSlot = 77; FooterSlot footerSlot = 78; ContainerNodeConfig containerNodeSlot = 79;
        GridViewConfig gridView = 80; ButtonPresetConfig buttonPreset = 81; KeyHintConfig keyHint = 83;
        ImageSlotConfig imageSlot = 84; ImageConfig image = 85; string effectSlot = 86;
        string fullscreenEffectSlot = 87;
      }
      int32 field501 = 501; int32 field502 = 502; int32 field503 = 503; NodeRef nodeRef = 504;
    }
  }
}
message WrapperString { string value = 501; }
message WrapperInt32 { int32 value = 501; }
message WrapperGuid { uint32 value = 501; }
message WrapperGuidList { repeated uint32 value = 501; }
message NodeRef { int32 class = 2; int32 type = 3; int32 id = 4; }
message Field14 { optional string empty15 = 15; ClientInitialState field17 = 17; int32 field501 = 501; bool initiallyInactive = 502; }
message ContainerNodeConfig { bool isolateNavigation = 501; bool disableKeyEventPassthrough = 502; bool disableCursorEventPassthrough = 503; bool showCursor = 504; }
message ClientInitialState { bool initiallyHidden = 503; }
message Vector3 { float x = 1; float y = 2; float z = 3; }
message RectTransform {
  Vector3 scale = 501; Vector2 anchorMin = 502; Vector2 anchorMax = 503; Vector2 offset = 504;
  Vector2 size = 505; Vector2 pivot = 506; Vector3 field508 = 508;
  message Vector2 { float x = 501; float y = 502; }
}
message Transform {
  oneof value { string empty11 = 11; MultiPlatform multiPlatform = 12; }
  int32 type = 501;
  message MultiPlatform {
    repeated Platform platforms = 501; int32 field502 = 502; int32 field504 = 504;
    message Platform { int32 platformType = 501; RectTransform transform = 502; }
  }
}
message RootChildRef { int32 guid = 501; }
message GenericSlot {
  int32 field501 = 501;
  repeated GenericRef field502 = 502;
  message GenericRef { GenericItem field1 = 1; message GenericItem { int64 id = 1; } }
}
message TextConfig {
  int32 field501 = 501; int32 adaptive = 502; int32 field503 = 503; uint32 color = 504;
  uint32 color2 = 505; int32 outlineOff = 506; uint32 color3 = 507; int32 align = 508; int32 verticalAlign = 509;
  WrapperString text = 510; int32 field511 = 511; int32 fontSize = 512; int32 minimumFontSize = 513; ViewFlags viewFlags = 62;
  message ViewFlags { int32 field502 = 502; int32 field503 = 503; }
}
message CursorConfig { int32 field501 = 501; }
message GridViewConfig {
  int32 field501 = 501; GridVector cellSize = 502; GridVector gap = 503; GridVector padding1 = 504;
  GridVector padding2 = 505; int32 field507 = 507; int32 field508 = 508; int32 field509 = 509;
  int32 field511 = 511; int32 field512 = 512;
  message GridVector { float field501 = 501; float field502 = 502; }
}
message ButtonPresetConfig {
  int32 disabledChild = 501; int32 hoverChild = 502; int32 pressedChild = 503;
  int32 selectedChild = 504; int32 interactable = 505; int32 clickAudioId = 506;
  int32 raycastTarget = 507;
}
message KeyHintConfig { int32 field501 = 501; int32 field502 = 502; }
message ImageSlotConfig { uint32 field502 = 502; uint32 assetId = 503; }
message ImageConfig {
  int32 enableMask = 501; int32 field502 = 502; int32 field504 = 504; int32 field505 = 505;
  int32 field507 = 507; int32 field508 = 508; int32 enableSoftEdge = 509; int32 softEdgePixel = 510;
  SliceVector border = 511; float field512 = 512; float field513 = 513; int32 enableFill = 514;
  int32 fillType = 515; int32 reverseMask = 516;
  message SliceVector { float field501 = 501; float field502 = 502; }
}
message FooterSlot { int32 field505 = 505; }
`

const { root: protobufRoot } = protobuf.parse(GIA_PROTO, { keepCase: false })
const RootType = protobufRoot.lookupType('Root')
const HEADER_BYTES = 20
const TAIL_BYTES = 4
const HEAD_TAG = 0x0326
const TAIL_TAG = 0x0679

const PRESET_INDEX = { image: 23, 'server-container': 24, container: 25, grid: 26, reference: 27, button: 28, animation: 29, fullscreen: 30, textbox: 31, textwindow: 32, cursor: 33, keyhint: 34 }
// Info.index is a control-kind discriminator in the verified client-template
// samples. It is not the traversal position of a GraphUnit in the file.
const INFO_INDEX = { 'server-container': 1, container: 2, textbox: 3, cursor: 4, reference: 5, grid: 6, button: 7, textwindow: 8, keyhint: 9, image: 10, animation: 11, fullscreen: 12 }
const PLATFORM_INDEX = { KEYBOARD: 0, TOUCHSCREEN: 1, CONTROLLER_CONSOLE: 2, CONTROLLER_MOBILE: 3 }
const SERVER_CONTROL_ASSET = 'server-control-template'
const CLIENT_CONTROL_ASSET = 'client-control-template'

function finiteNumber(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}
const INDEX_PLATFORM = Object.fromEntries(Object.entries(PLATFORM_INDEX).map(([key, value]) => [value, key]))
const CLIENT_DATA_SCHEMA = Object.freeze({
  container: [
    ['2/15', 'name', null], ['4/86', 'field14', 'field14'], ['1/12', 'transform', 'transform'],
    ['63/83', 'empty73', 'genericSlot'], ['68/91', 'empty78', 'containerNodeSlot'], ['67/90', 'empty77', 'footerSlot'],
  ],
  textbox: [
    ['2/15', 'name', null], ['4/86', 'field14', 'field14'], ['1/12', 'transform', 'transform'],
    ['63/83', 'empty73', 'genericSlot'], ['64/84', 'empty74', 'textConfig'], ['67/90', 'empty77', 'footerSlot'],
  ],
  cursor: [
    ['2/15', 'name', null], ['4/86', 'field14', 'field14'], ['1/12', 'transform', 'transform'],
    ['63/83', 'empty73', 'genericSlot'], ['65/85', 'empty75', 'cursorConfig'], ['67/90', 'empty77', 'footerSlot'],
  ],
  reference: [
    ['2/15', 'name', null], ['4/86', 'field14', 'field14'], ['1/12', 'transform', 'transform'],
    ['63/83', 'empty73', 'genericSlot'], ['66/89', 'empty76', 'templateRefSlot'], ['67/90', 'empty77', 'footerSlot'],
  ],
  grid: [
    ['2/15', 'name', null], ['4/86', 'field14', 'field14'], ['1/12', 'transform', 'transform'],
    ['63/83', 'empty73', 'genericSlot'], ['69/92', 'empty79', 'gridView'], ['67/90', 'empty77', 'footerSlot'],
  ],
  button: [
    ['2/15', 'name', null], ['4/86', 'field14', 'field14'], ['1/12', 'transform', 'transform'],
    ['63/83', 'empty73', 'genericSlot'], ['70/93', 'empty80', 'buttonPreset'], ['67/90', 'empty77', 'footerSlot'],
  ],
  textwindow: [
    ['2/15', 'name', null], ['4/86', 'field14', 'field14'], ['1/12', 'transform', 'transform'],
    ['63/83', 'empty73', 'genericSlot'], ['71/94', 'empty81', 'textConfig'], ['67/90', 'empty77', 'footerSlot'],
  ],
  keyhint: [
    ['2/15', 'name', null], ['4/86', 'field14', 'field14'], ['1/12', 'transform', 'transform'],
    ['63/83', 'empty73', 'genericSlot'], ['72/95', 'empty82', 'keyHint'], ['67/90', 'empty77', 'footerSlot'],
  ],
  image: [
    ['2/15', 'name', null], ['4/86', 'field14', 'field14'], ['1/12', 'transform', 'transform'],
    ['63/83', 'empty73', 'genericSlot'], ['73/96', 'empty83', 'imageSlot'], ['74/97', 'empty84', 'image'],
    ['67/90', 'empty77', 'footerSlot'],
  ],
  animation: [
    ['2/15', 'name', null], ['4/86', 'field14', 'field14'], ['1/12', 'transform', 'transform'],
    ['63/83', 'empty73', 'genericSlot'], ['75/98', 'empty85', 'effectSlot'], ['67/90', 'empty77', 'footerSlot'],
  ],
  fullscreen: [
    ['2/15', 'name', null], ['4/86', 'field14', 'field14'], ['1/12', 'transform', 'transform'],
    ['63/83', 'empty73', 'genericSlot'], ['76/99', 'empty86', 'fullscreenEffectSlot'], ['67/90', 'empty77', 'footerSlot'],
  ],
})
const DETAILS_MARKER = Object.freeze({
  '4/23': 5, '4/86': 5, '1/12': 4, '62/82': 64, '63/83': 65, '64/84': 66, '65/85': 67,
  '66/89': 68, '67/90': 69, '68/91': 70, '69/92': 71, '70/93': 72,
  '71/94': 66, '72/95': 74, '73/96': 75, '74/97': 76, '75/98': 77, '76/99': 78,
})
const SERVER_GROUP_DATA_SCHEMA = Object.freeze([
  ['2/15', 'name', null],
  ['4/23', 'field14', 'field14'],
  ['1/12', 'transform', 'transform'],
  ['62/82', 'empty72', 'rootChildRef'],
])

function nodeRef(guid) { return { class: 1, type: 8, id: guid } }
function detail(guid, field501, field502, value) {
  return { ...value, field501, field502, field503: 1, nodeRef: nodeRef(guid) }
}

function guidWalkNodes(project) {
  const nodes = []
  const skipServerContainer = project.meta?.assetType === 'client-control-template'
  walk(project.root, (node) => {
    if (skipServerContainer && node.kind === 'server-container') return
    nodes.push(node)
  })
  return nodes
}

export function assignGuids(project, used = new Set()) {
  const map = new Map()
  const pending = []
  for (const node of guidWalkNodes(project)) {
    const guid = Number(node.guid)
    if (isValidGuid(guid) && !used.has(guid)) {
      used.add(guid)
      node.guid = guid
      map.set(node.id, guid)
    } else {
      pending.push(node)
    }
  }
  for (const node of pending) {
    const guid = nextFreeGuid(used)
    used.add(guid)
    node.guid = guid
    map.set(node.id, guid)
  }
  return map
}

function rectTransform(rt) {
  return {
    scale: { x: rt.scale.x, y: rt.scale.y, z: rt.scale.z },
    anchorMin: { x: rt.anchorMin.x, y: rt.anchorMin.y },
    anchorMax: { x: rt.anchorMax.x, y: rt.anchorMax.y },
    offset: { x: rt.offset.x, y: rt.offset.y },
    size: { x: rt.size.x, y: rt.size.y },
    pivot: { x: rt.pivot.x, y: rt.pivot.y },
    field508: rt.rotation.z ? { z: rt.rotation.z } : {},
  }
}

function transformData(node, guid) {
  const platforms = PLATFORMS.map((platform) => ({
    platformType: PLATFORM_INDEX[platform],
    transform: rectTransform(node.transformByPlatform[platform]),
  }))
  const transform = {
    multiPlatform: {
      platforms,
      field502: PRESET_INDEX[node.kind] || 25,
      ...(node.syncAllDevices === false ? {} : { field504: 1 }),
    },
    type: 2,
  }
  return {
    transform: { multiPlatform: {}, type: 2 },
    field501: 1,
    field502: 12,
    details: detail(guid, 4, 12, { transform }),
  }
}

function commonData(node, guid, isGroup) {
  const marker = isGroup
    ? { empty15: '', field501: 5 }
    : { field17: {}, field501: 7 }
  const stateMarker = isGroup ? marker : {
    ...marker,
    ...(node.visible === false ? { field17: { initiallyHidden: true } } : {}),
    ...(node.active === false ? { initiallyInactive: true } : {}),
  }
  return [
    { name: { value: node.name }, field501: 2, field502: 15 },
    {
      field14: marker,
      field501: 4,
      field502: isGroup ? 23 : 86,
      details: detail(guid, 5, isGroup ? 23 : 86, { field14: stateMarker }),
    },
    transformData(node, guid),
  ]
}

function typeData(node, guid, guidById, warnings) {
  const ref = (field501, field502, outerKey, detailsKey, value) => ({
    [outerKey]: '', field501, field502,
    details: detail(guid, field501 + 2, field502, { [detailsKey]: value }),
  })
  const raw = node.giaRaw || {}
  const genericPayload = Array.isArray(node.scriptMappingIds) && node.scriptMappingIds.length
    ? {
        field501: raw.genericField501 || 1,
        field502: node.scriptMappingIds.map((id) => ({ field1: { id: Number(id) } })),
      }
    : { field501: raw.genericField501 ?? 0 }
  const generic = ref(63, 83, 'empty73', 'genericSlot', genericPayload)
  const footer = ref(67, 90, 'empty77', 'footerSlot', {
    field505: ![undefined, 0, 1].includes(raw.footerField505)
      ? raw.footerField505 : (node.canControllerFocus ? 1 : 0),
  })
  if (node.kind === 'container') {
    return [generic, ref(68, 91, 'empty78', 'containerNodeSlot', {
      ...(node.isolateNavigation ? { isolateNavigation: true } : {}),
      ...(node.disableKeyEventPassthrough ? { disableKeyEventPassthrough: true } : {}),
      ...(node.disableCursorEventPassthrough ? { disableCursorEventPassthrough: true } : {}),
      ...(node.showCursor ? { showCursor: true } : {}),
    }), footer]
  }
  if (node.kind === 'textbox' || node.kind === 'textwindow') {
    // Official 7.1.0 sample confirms Top=0 and Bottom=2. Middle=1 is
    // inferred from the enum sequence and still needs device confirmation.
    if (node.verticalAlignment === 'Middle') warnings.push(`${node.name}: 垂直居中按推定值导出，尚待实机确认。`)
    const semanticAlign = { Left: 0, Middle: 1, Right: 2 }[node.horizontalAlignment] ?? 0
    const align = Number.isFinite(raw.textAlign) ? Math.trunc(raw.textAlign) : semanticAlign
    const textConfig = {
      field501: raw.textField501 ?? 20,
      field503: raw.textField503 ?? 12,
      color: node.fontColor >>> 0,
      color2: node.bgColor >>> 0,
      color3: node.outlineColor >>> 0,
      text: { value: node.text || '' },
      fontSize: Math.trunc(node.fontSize),
      minimumFontSize: Math.trunc(node.minimumFontSize),
      ...(node.adaptiveFontSize ? { adaptive: 1 } : {}),
      ...(node.enableOutline === false ? { outlineOff: 1 } : {}),
      ...(align ? { align } : {}),
      verticalAlign: raw.textVerticalAlign ?? ({ Top: 0, Middle: 1, Bottom: 2 }[node.verticalAlignment] ?? 0),
    }
    if (node.kind === 'textwindow') {
      textConfig.field511 = raw.textField511 ?? 1
      textConfig.viewFlags = {
        field502: raw.textViewField502 ?? 1,
        field503: raw.textViewField503 ?? 1,
      }
      return [generic, {
        empty81: '', field501: 71, field502: 94,
        details: detail(guid, 66, 94, { textConfig }),
      }, footer]
    }
    return [generic, ref(64, 84, 'empty74', 'textConfig', textConfig), footer]
  }
  if (node.kind === 'image') {
    const semanticFillType = { Horizontal: 1, Vertical: 2, Radial90: 3, Radial180: 4, Radial360: 5 }[node.fillType]
    const fillType = Number.isFinite(raw.imageFillType) ? Math.trunc(raw.imageFillType) : (semanticFillType || 1)
    if (node.enableFill && !fillType) warnings.push(`${node.name}: 填充形状原始枚举为 0，已关闭导出文件中的进度填充。`)
    if (node.fillType === 'Horizontal' && node.fillHorizontalType !== 'Left') warnings.push(`${node.name}: 当前横向填充方向暂不支持写入 GIA。`)
    if (node.fillType === 'Radial180' && node.fillRadialType !== 'Bottom') warnings.push(`${node.name}: 当前 180 度填充起点暂不支持写入 GIA。`)
    const image = {
      field502: raw.imageField502 ?? 1,
      field504: raw.imageField504 ?? 1,
      field505: raw.imageField505 ?? 1,
      field507: raw.imageField507 ?? 2,
      field508: Math.round(Math.max(0, Math.min(1, Number(node.fillAmount) || 0)) * 100),
      border: {
        field501: finiteNumber(node.softEdgeWidthX, 8),
        field502: finiteNumber(node.softEdgeWidthY, 8),
      },
      field512: finiteNumber(node.horizontalSoftRange, 85),
      field513: finiteNumber(node.verticalSoftRange, 85),
      fillType,
      ...(node.enableMask ? { enableMask: 1 } : {}),
      ...(node.enableSoftEdge ? { enableSoftEdge: 1 } : {}),
      ...(node.softEdgeMode === 'Pixel' ? { softEdgePixel: 1 } : {}),
      ...(node.enableFill && fillType ? { enableFill: 1 } : {}),
      ...(node.reverseMaskArea ? { reverseMask: 1 } : {}),
    }
    return [
      generic,
      ref(73, 96, 'empty83', 'imageSlot', {
        // 默认白 0xFFFFFFFF 与官方未改色样本一致；非白色写入同一槽，对应检视器「填充色」。
        field502: Number.isFinite(node.imageColor) ? (node.imageColor >>> 0) : 0xffffffff,
        assetId: node.imageId >>> 0,
      }),
      ref(74, 97, 'empty84', 'image', image),
      footer,
    ]
  }
  if (node.kind === 'button') {
    const stateGuid = (key, label) => {
      const childId = node[key]
      if (!childId) return 0
      if (!(node.children || []).some((child) => child.id === childId)) {
        warnings.push(`${node.name}: ${label}状态节点不是按钮的直接子控件，GIA 未写入该状态。`)
        return 0
      }
      return guidById.get(childId) || 0
    }
    const disabledChild = stateGuid('unavailableChildId', '不可用')
    const hoverChild = stateGuid('hoverChildId', '悬停')
    const pressedChild = stateGuid('pressedChildId', '按下')
    const selectedChild = stateGuid('selectedChildId', '选中')
    return [
      generic,
      ref(70, 93, 'empty80', 'buttonPreset', {
        clickAudioId: Math.trunc(node.clickAudioId),
        ...(disabledChild ? { disabledChild } : {}),
        ...(hoverChild ? { hoverChild } : {}),
        ...(pressedChild ? { pressedChild } : {}),
        ...(selectedChild ? { selectedChild } : {}),
        ...(node.interactable ? { interactable: 1 } : {}),
        ...(node.raycastTarget ? { raycastTarget: 1 } : {}),
      }),
      footer,
    ]
  }
  if (node.kind === 'cursor') {
    return [generic, ref(65, 85, 'empty75', 'cursorConfig', {
      field501: ![undefined, 0, 1].includes(raw.cursorField501)
        ? raw.cursorField501 : (node.raycastTarget !== false ? 1 : 0),
    }), footer]
  }
  if (node.kind === 'reference') {
    return [generic, ref(66, 89, 'empty76', 'templateRefSlot', raw.templateRefSlot ?? ''), footer]
  }
  if (node.kind === 'grid') {
    return [generic, ref(69, 92, 'empty79', 'gridView', {
      field501: raw.gridField501 ?? 1,
      cellSize: { field501: node.cellSizeX, field502: node.cellSizeY },
      gap: { field501: node.spacingX, field502: node.spacingY },
      padding1: { field501: node.padding1X, field502: node.padding1Y },
      padding2: { field501: node.padding2X, field502: node.padding2Y },
      field507: raw.gridField507 ?? 1,
      field508: raw.gridField508 ?? 1,
      field509: raw.gridField509 ?? 1,
      field511: raw.gridField511 ?? 5,
      field512: raw.gridField512 ?? 1,
    }), footer]
  }
  if (node.kind === 'keyhint') {
    return [generic, ref(72, 95, 'empty82', 'keyHint', {
      field501: Number.isFinite(raw.keyHintField501) ? Math.trunc(raw.keyHintField501) : (node.controllerKeyCode ?? 1),
      field502: Number.isFinite(raw.keyHintField502) ? Math.trunc(raw.keyHintField502) : (node.keyboardKeyCode ?? 1),
    }), footer]
  }
  if (node.kind === 'animation') {
    return [generic, ref(75, 98, 'empty85', 'effectSlot', raw.effectSlot ?? ''), footer]
  }
  if (node.kind === 'fullscreen') {
    return [generic, ref(76, 99, 'empty86', 'fullscreenEffectSlot', raw.fullscreenEffectSlot ?? ''), footer]
  }
  warnings.push(`${node.name}: ${node.kind} 不是已知 GIA 控件类型，已仅写公共变换。`)
  return [generic, footer]
}

function infoIndex(node, isGroup) {
  if (isGroup) return 1
  return Number.isSafeInteger(Number(node.giaInfoIndex)) && Number(node.giaInfoIndex) > 0
    ? Number(node.giaInfoIndex)
    : (INFO_INDEX[node.kind] || 2)
}

function infoRelatedGuids(node, warnings, assetLabel) {
  const preserved = Array.isArray(node.giaRelatedGuids)
    ? node.giaRelatedGuids.filter((guid) => Number.isSafeInteger(guid) && guid > 0 && guid <= 0x7fffffff)
    : []
  if (preserved.length) return preserved
  // Keep the third Info record present, but do not copy an external GUID from
  // another sandbox. A copied GUID imports as an unresolved blank index when
  // that companion resource is absent in the target sandbox.
  warnings.push(`${node.name}: 新${assetLabel}写入显式空 Info.related，避免跨沙箱复用伴生资源 GUID 产生无法加载的索引。`)
  return []
}

function canonicalFilePath(project, isClientTemplates) {
  const explicit = String(project.meta?.giaFilePath || '').trim()
  if (/^\d+-\d+-\d+-\\.+\.gia$/iu.test(explicit)) return explicit
  const positiveInt = (value, fallback) => Number.isSafeInteger(Number(value)) && Number(value) > 0
    ? Number(value)
    : fallback
  const ownerUid = positiveInt(project.meta?.giaOwnerUid, 114514)
  const timestamp = positiveInt(project.meta?.giaTimestamp, Math.floor(Date.now() / 1000))
  const fileId = positiveInt(project.meta?.giaFileId, isClientTemplates ? 1073741829 : 1073741830)
  const fallbackName = isClientTemplates ? '客户端控件模板列表.gia' : '服务端控件模板-客户端控件容器.gia'
  const fileName = String(project.meta?.giaFileName || fallbackName)
    .replace(/[\\/:*?"<>|]/gu, '-')
    .replace(/\.gia$/iu, '')
    .trim() || fallbackName.replace(/\.gia$/iu, '')
  return `${ownerUid}-${timestamp}-${fileId}-\\${fileName}.gia`
}

function graphUnit(node, parent, guidById, allClientGuids, warnings, isGroup = false, isTemplate = false, includeTypeIndex = isTemplate, reverseSiblings = false) {
  const guid = guidById.get(node.id)
  // 官方服务端容器样本的 children / relatedIds / accessories 与编辑器左树相反。
  // Authoring 保持前序（先出现的在上）；导出服务端容器时倒序对齐官方 wire 样本。
  const sourceChildren = reverseSiblings ? [...(node.children || [])].reverse() : (node.children || [])
  const childGuids = sourceChildren.map((child) => guidById.get(child.id))
  const related = isGroup ? allClientGuids : childGuids
  const data = commonData(node, guid, isGroup)
  if (isGroup) {
    const rootChild = node.children?.[0]
    if (rootChild) {
      data.push({
        empty72: '', field501: 62, field502: 82,
        details: detail(guid, 64, 82, { rootChildRef: { guid: guidById.get(rootChild.id) } }),
      })
    }
  } else {
    data.push(...typeData(node, guid, guidById, warnings))
  }
  return {
    id: nodeRef(guid),
    relatedIds: related.map((id) => nodeRef(id)),
    name: node.name,
    which: isGroup ? 21 : isTemplate ? 70 : 15,
    ui: {
      content: {
        guid,
        info: [
          { guid: { value: guid }, field501: 1, field502: 5 },
          ...((isGroup || includeTypeIndex) ? [{ index: { value: infoIndex(node, isGroup) }, field501: 2, field502: 6 }] : []),
          ...((isGroup || isTemplate) ? [{
            related: { value: infoRelatedGuids(node, warnings, isGroup ? '服务端控件模板' : '客户端控件模板') },
            field501: 4,
            field502: 4,
          }] : []),
        ],
        children: isGroup ? [] : childGuids,
        parent: parent && parent.kind !== 'server-container' ? guidById.get(parent.id) : 0,
        data,
      },
    },
  }
}

function collectClientNodes(project) {
  const clientNodes = []
  walk(project.root, (node, parent) => {
    if (node.kind !== 'server-container') clientNodes.push({ node, parent })
  })
  return clientNodes
}

function scriptMounts(scripts, targetAsset) {
  const mounts = new Map()
  for (const script of scripts || []) {
    if (!script.controlId) continue
    // Older saved scripts have no controlAsset.  They historically targeted
    // the server tree, so retain that interpretation for compatibility.
    const belongs = targetAsset === CLIENT_CONTROL_ASSET
      ? script.controlAsset === CLIENT_CONTROL_ASSET
      : script.controlAsset !== CLIENT_CONTROL_ASSET
    if (!belongs) continue
    const list = mounts.get(script.controlId) || []
    list.push(script.guid)
    mounts.set(script.controlId, list)
  }
  return mounts
}

function withScriptMounts(project, scripts, targetAsset, build) {
  const mounts = scriptMounts(scripts, targetAsset)
  const previousMappings = new Map()
  walk(project.root, (node) => {
    if (!mounts.has(node.id)) return
    previousMappings.set(node, node.scriptMappingIds)
    node.scriptMappingIds = mounts.get(node.id)
  })
  try {
    return build()
  } finally {
    for (const [node, previous] of previousMappings) {
      if (previous === undefined) delete node.scriptMappingIds
      else node.scriptMappingIds = previous
    }
  }
}

function rootModeFields(project) {
  const modeFlag = Number(project.meta?.giaModeFlag)
  return Number.isSafeInteger(modeFlag) && modeFlag >= 0 ? { modeFlag } : {}
}

function buildClientTemplateRootObject(project, guidById, warnings, filePath, scripts = []) {
  const clientNodes = collectClientNodes(project)
  const templateEntries = clientNodes.filter(({ parent }) => parent?.kind === 'server-container')
  if (!templateEntries.length) throw new Error('客户端控件模板列表至少需要一个模板')
  const templateIds = new Set(templateEntries.map(({ node }) => node.id))
  const accessoryEntries = clientNodes.filter(({ node }) => !templateIds.has(node.id))
  const allClientGuids = clientNodes.map(({ node }) => guidById.get(node.id))
  return withScriptMounts(project, scripts, CLIENT_CONTROL_ASSET, () => ({
    graph: templateEntries.map(({ node, parent }) => graphUnit(
      node, parent, guidById, allClientGuids, warnings, false, true,
    )),
    accessories: accessoryEntries.map(({ node, parent }) => graphUnit(
      node, parent, guidById, allClientGuids, warnings, false, false, true,
    )),
    filePath: filePath || canonicalFilePath(project, true),
    gameVersion: project.meta?.gameVersion || '7.0.50',
    ...rootModeFields(project),
  }))
}

function buildServerGroupRootObject(project, guidById, extra, warnings, filePath) {
  const clientNodes = collectClientNodes(project)
  const serverAccessories = [clientNodes[0], ...clientNodes.slice(1).reverse()]
  const allClientGuids = serverAccessories.map(({ node }) => guidById.get(node.id))
  return withScriptMounts(project, extra.scripts, SERVER_CONTROL_ASSET, () => ({
      graph: [graphUnit(project.root, null, guidById, allClientGuids, warnings, true, false, false, true), ...(extra.units || [])],
      accessories: serverAccessories.map(({ node, parent }) => graphUnit(
        node, parent, guidById, allClientGuids, warnings, false, false, false, true,
      )),
      filePath: filePath || canonicalFilePath(project, false),
      gameVersion: project.meta?.gameVersion || '7.0.50',
      ...rootModeFields(project),
    }))
}

function encodeAndValidate(rootObject, validate) {
  const out = encodeGiaEnvelope(rootObject)
  const compatibility = validate(out)
  if (!compatibility.valid) {
    throw new Error(`GIA compatibility validation failed:\n${compatibility.errors.join('\n')}`)
  }
  return out
}

export function exportGia(project, options = {}) {
  walk(project.root, assertPlatformNode)
  const guidById = assignGuids(toJson(project))
  const warnings = []
  const isClientTemplates = project.meta?.assetType === 'client-control-template'
  let rootObject
  if (isClientTemplates) {
    rootObject = buildClientTemplateRootObject(project, guidById, warnings, undefined, options.scripts || [])
  } else {
    const extra = scriptGraphUnits(options.scripts || [], new Set(guidById.values()))
    warnings.push(...extra.warnings)
    rootObject = buildServerGroupRootObject(project, guidById, extra, warnings)
  }
  const out = encodeAndValidate(rootObject, isClientTemplates ? validateGiaCompatibility : validateServerGiaCompatibility)
  return { buffer: out, warnings: [...new Set(warnings)] }
}

export function exportCombinedGia(serverProject, clientProject, options = {}) {
  walk(serverProject.root, assertPlatformNode)
  if (clientProject) walk(clientProject.root, assertPlatformNode)
  const warnings = [
    '整合包把服务端 UIControlGroup 与客户端 UIControlTemplate 并排写入同一 GIA 的 Root.graph；导入时拆回两类资产，模板边界、脚本映射与控件挂载关系会保留。',
  ]
  const templates = clientProject?.root?.children || []
  if (!templates.length) warnings.push('客户端控件模板为空，整合包只包含服务端控件与脚本。')
  const used = new Set()
  const serverCopy = toJson(serverProject)
  const clientCopy = clientProject ? toJson(clientProject) : null
  const serverGuids = assignGuids(serverCopy, used)
  const extra = scriptGraphUnits(options.scripts || [], used)
  // 独立 script.gia 确实不携带控件挂载；整合包会同时把映射 GUID
  // 写回两棵控件树的 GenericSlot，因此不应沿用该警告。
  warnings.push(...extra.warnings.filter((warning) => warning !== SCRIPT_MOUNT_WARNING))
  const fileName = String(options.fileName || `${serverCopy.meta?.name || '整合包'} · 整合包.gia`)
  const filePath = canonicalFilePath({
    ...serverCopy,
    meta: { ...serverCopy.meta, giaFileName: fileName },
  }, false)
  const serverRoot = buildServerGroupRootObject(serverCopy, serverGuids, extra, warnings, filePath)
  let clientRoot = { graph: [], accessories: [] }
  if (templates.length && clientCopy) {
    const clientGuids = assignGuids({
      ...clientCopy,
      meta: { ...clientCopy.meta, assetType: 'client-control-template' },
    }, used)
    clientRoot = buildClientTemplateRootObject(clientCopy, clientGuids, warnings, filePath, extra.scripts)
  }
  const rootObject = {
    graph: [...serverRoot.graph, ...clientRoot.graph],
    accessories: [...serverRoot.accessories, ...clientRoot.accessories],
    filePath,
    gameVersion: serverProject.meta?.gameVersion || clientProject?.meta?.gameVersion || '7.0.50',
    ...rootModeFields(serverProject),
  }
  const out = encodeAndValidate(rootObject, validateServerGiaCompatibility)
  return { buffer: out, warnings: [...new Set(warnings)] }
}

// —— 脚本映射 GIA（官方 script.gia：fileType=3 外壳 + 每条映射一个 which=69 单元，无 accessories）——
// 证据：knowledge/ui/02_UI核心数据结构.md §8、knowledge/ui/template/script.gia 真实样本。
const SCRIPT_MAPPING_WHICH = 69
const SCRIPT_ASSET_CLASS = 30
const SCRIPT_MOUNT_WARNING = '脚本挂载关系不进入 GIA：官方 script.gia 只含映射（ID/名称/路径/源码），导入后需重新挂载。'

function scriptDisplayName(script) {
  const base = String(script.path || '').replace(/\\/g, '/').split('/').pop() || ''
  return base.replace(/\.lua$/iu, '') || `脚本${script.id || ''}`
}

function encodeGiaEnvelope(rootObject) {
  const error = RootType.verify(rootObject)
  if (error) throw new Error(`GIA encode validation failed: ${error}`)
  const payload = RootType.encode(RootType.create(rootObject)).finish()
  const out = Buffer.alloc(HEADER_BYTES + payload.length + TAIL_BYTES)
  out.writeUInt32BE(out.length - 4, 0)
  out.writeUInt32BE(1, 4)
  out.writeUInt32BE(HEAD_TAG, 8)
  out.writeUInt32BE(3, 12)
  out.writeUInt32BE(payload.length, 16)
  Buffer.from(payload).copy(out, HEADER_BYTES)
  out.writeUInt32BE(TAIL_TAG, HEADER_BYTES + payload.length)
  return out
}

function scriptGraphUnits(scripts, used = new Set()) {
  const list = (scripts || []).filter((script) => script.path || script.source).map((script) => ({ ...script }))
  const pending = []
  for (const script of list) {
    const guid = Number(script.guid)
    if (isValidGuid(guid) && !used.has(guid)) {
      used.add(guid)
      script.guid = guid
    } else {
      pending.push(script)
    }
  }
  for (const script of pending) {
    const guid = nextFreeGuid(used)
    used.add(guid)
    script.guid = guid
  }
  const warnings = []
  if ((scripts || []).some((script) => script.controlId)) {
    warnings.push(SCRIPT_MOUNT_WARNING)
  }
  const units = list.map((script) => {
    const name = scriptDisplayName(script)
    // 官方 script.gia 的 file_path 是「名称.lua」形态（knowledge/ui/02 §8、template/script.gia）；
    // 真机 require 时编辑器再自行去掉 .lua。导出必须补全扩展名并统一正斜杠，
    // 否则真机把「data」这类无扩展名值当非法文件路径，导入失败。
    const rawPath = String(script.path || '').replace(/\\/g, '/')
    const filePath = /\.lua$/iu.test(rawPath) ? rawPath : `${rawPath || name}.lua`
    const mapping = {
      id: script.guid,
      name,
      filePath,
    }
    if (String(script.source || '')) mapping.source = String(script.source)
    return {
      id: { class: SCRIPT_ASSET_CLASS, id: script.guid },
      name,
      which: SCRIPT_MAPPING_WHICH,
      script: { mapping },
    }
  })
  return { units, warnings, scripts: list }
}

export function exportScriptGia(scripts) {
  const extra = scriptGraphUnits(scripts)
  if (!extra.units.length) throw new Error('没有可导出的 Lua 脚本，请先在“Lua 脚本”页创建')
  const rootObject = {
    graph: extra.units,
    filePath: `114514-${Math.floor(Date.now() / 1000)}-1073741832-\\script.gia`,
    gameVersion: '7.0.51',
  }
  const out = encodeGiaEnvelope(rootObject)
  const compatibility = validateScriptGiaCompatibility(out)
  if (!compatibility.valid) {
    throw new Error(`GIA compatibility validation failed:\n${compatibility.errors.join('\n')}`)
  }
  return { buffer: out, warnings: [...new Set(extra.warnings)] }
}

function decodeRootObject(input) {
  return RootType.toObject(RootType.decode(decodeEnvelope(input)), {
    longs: Number, enums: Number, bytes: Buffer, defaults: false, arrays: true, objects: true,
  })
}

export function isScriptGia(input) {
  try {
    const root = decodeRootObject(input)
    const units = root.graph || []
    return units.length > 0 && units.every((unit) => Number(unit.which) === SCRIPT_MAPPING_WHICH)
  } catch {
    return false
  }
}

function extractScriptMappings(root) {
  const units = (root.graph || []).filter((unit) => Number(unit.which) === SCRIPT_MAPPING_WHICH)
  const warnings = []
  const scripts = units.map((unit, index) => {
    const mapping = unit.script?.mapping || {}
    const guid = Number(unit.id?.id) || 0
    if (guid <= 0) warnings.push(`第 ${index + 1} 条脚本映射缺少 GraphUnit.id.id，已按 0 处理（导出时会重新分配）。`)
    const mappingId = Number(mapping.id) || 0
    if (mappingId && mappingId !== guid) {
      warnings.push(`第 ${index + 1} 条脚本映射 id(${mappingId}) 与单元 id(${guid}) 不一致，以单元 id 为准。`)
    }
    return {
      guid,
      path: String(mapping.filePath || ''),
      source: String(mapping.source || ''),
    }
  })
  for (const [index, script] of scripts.entries()) {
    if (script.path && !/\.lua$/iu.test(script.path)) {
      warnings.push(`第 ${index + 1} 条脚本映射 file_path 缺少 .lua 后缀（${script.path}），真机可能拒绝导入；模拟器内按归一化路径照常 require。`)
    }
  }
  return { scripts, warnings }
}

export function importScriptGia(input) {
  const root = decodeRootObject(input)
  const extracted = extractScriptMappings(root)
  if (!extracted.scripts.length) throw new Error('GIA 内没有脚本映射单元（which=69）')
  return { scripts: extracted.scripts, warnings: extracted.warnings, metadata: { assetType: 'lua-script' } }
}

export function validateScriptGiaCompatibility(input) {
  const errors = []
  let root
  try {
    root = decodeRootObject(input)
  } catch (err) {
    return { valid: false, errors: [err?.message || String(err)], scriptCount: 0 }
  }
  const units = root.graph || []
  if (!units.length) errors.push('Root.graph 为空')
  if ((root.accessories || []).length) errors.push('script.gia 不应包含 accessories')
  units.forEach((unit, index) => {
    const label = `单元 ${index + 1}`
    if (Number(unit.which) !== SCRIPT_MAPPING_WHICH) errors.push(`${label}: which 应为 69，实际 ${unit.which}`)
    if (Number(unit.id?.class) !== SCRIPT_ASSET_CLASS) errors.push(`${label}: id.class 应为 30，实际 ${unit.id?.class}`)
    if (Number(unit.id?.type ?? 0) !== 0) errors.push(`${label}: id.type 应缺省`)
    const mapping = unit.script?.mapping
    if (!mapping) {
      errors.push(`${label}: 缺少 field35 ScriptMappingWrapper`)
      return
    }
    if (Number(unit.id?.id) <= 0) errors.push(`${label}: GraphUnit.id.id 非法`)
    if (Number(mapping.id) !== Number(unit.id?.id)) errors.push(`${label}: mapping.id 应等于 GraphUnit.id.id`)
    if (String(mapping.name || '') !== String(unit.name || '')) errors.push(`${label}: mapping.name 应等于 GraphUnit.name`)
    if (!String(mapping.filePath || '').trim()) errors.push(`${label}: file_path 为空`)
    else if (!/\.lua$/iu.test(String(mapping.filePath))) errors.push(`${label}: file_path 应以 .lua 结尾（官方 script.gia 样本均为 名称.lua，真机 require 时才去扩展名）`)
  })
  return { valid: errors.length === 0, errors, scriptCount: units.length }
}

function decodeEnvelope(input) {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input)
  if (buffer.length < HEADER_BYTES + TAIL_BYTES) throw new Error('GIA 文件过短')
  if (buffer.readUInt32BE(4) !== 1 || buffer.readUInt32BE(8) !== HEAD_TAG || buffer.readUInt32BE(12) !== 3) {
    throw new Error('不是受支持的 GIA v1 文件')
  }
  const payloadSize = buffer.readUInt32BE(16)
  if (payloadSize !== buffer.length - HEADER_BYTES - TAIL_BYTES) throw new Error('GIA payload 长度不一致')
  if (buffer.readUInt32BE(HEADER_BYTES + payloadSize) !== TAIL_TAG) throw new Error('GIA 尾标记无效')
  return buffer.subarray(HEADER_BYTES, HEADER_BYTES + payloadSize)
}

function dataDetails(unit, key) {
  return unit.ui?.content?.data?.find((entry) => entry.details?.[key])?.details?.[key] || null
}

function transformMaps(unit) {
  const multi = dataDetails(unit, 'transform')?.multiPlatform
  const out = {}
  for (const item of multi?.platforms || []) {
    const platform = INDEX_PLATFORM[item.platformType || 0]
    const rt = item.transform || {}
    out[platform] = {
      // Present protobuf vectors omit zero-valued scalar components. Defaults
      // for a missing vector must not turn an encoded zero into 1 or 0.5.
      scale: rt.scale
        ? { x: rt.scale.x ?? 0, y: rt.scale.y ?? 0, z: rt.scale.z ?? 0 }
        : { x: 1, y: 1, z: 1 },
      rotation: { x: 0, y: 0, z: rt.field508?.z ?? 0 },
      anchorMin: { x: rt.anchorMin?.x ?? 0, y: rt.anchorMin?.y ?? 0 },
      anchorMax: { x: rt.anchorMax?.x ?? 0, y: rt.anchorMax?.y ?? 0 },
      offset: { x: rt.offset?.x ?? 0, y: rt.offset?.y ?? 0 },
      size: { x: rt.size?.x ?? 0, y: rt.size?.y ?? 0 },
      pivot: rt.pivot
        ? { x: rt.pivot.x ?? 0, y: rt.pivot.y ?? 0 }
        : { x: 0.5, y: 0.5 },
    }
  }
  const fallback = out.KEYBOARD || out[Object.keys(out)[0]]
  if (!fallback) throw new Error(`GIA 控件 ${unit.name || unit.id?.id} 缺少多平台变换`)
  for (const platform of PLATFORMS) if (!out[platform]) out[platform] = structuredClone(fallback)
  return out
}

function detectKind(unit) {
  const data = unit.ui?.content?.data || []
  if (data.some((entry) => entry.details?.textConfig)) return data.some((entry) => entry.field501 === 71) ? 'textwindow' : 'textbox'
  if (data.some((entry) => entry.details?.cursorConfig)) return 'cursor'
  if (data.some((entry) => Object.hasOwn(entry.details || {}, 'templateRefSlot'))) return 'reference'
  if (data.some((entry) => entry.details?.gridView)) return 'grid'
  if (data.some((entry) => entry.details?.buttonPreset)) return 'button'
  if (data.some((entry) => entry.details?.keyHint)) return 'keyhint'
  if (data.some((entry) => entry.details?.image || entry.details?.imageSlot)) return 'image'
  if (data.some((entry) => Object.hasOwn(entry.details || {}, 'effectSlot'))) return 'animation'
  if (data.some((entry) => Object.hasOwn(entry.details || {}, 'fullscreenEffectSlot'))) return 'fullscreen'
  if (data.some((entry) => Object.hasOwn(entry.details || {}, 'containerNodeSlot'))) return 'container'
  return 'container'
}

function materializeControlForest(units, { reverseSiblings = false, idOffset = 0 } = {}) {
  if (!units.length) return { nodes: new Map(), rootCandidates: [], warnings: [] }
  const idByGuid = new Map(units.map((unit, index) => [unit.id?.id, `n${idOffset + index + 1}`]))
  const nodes = new Map()
  const pendingStateGuids = new Map()
  const warnings = []
  for (const unit of units) {
    const kind = detectKind(unit)
    const text = dataDetails(unit, 'textConfig')
    const imageSlot = dataDetails(unit, 'imageSlot')
    const image = dataDetails(unit, 'image')
    const button = dataDetails(unit, 'buttonPreset')
    const grid = dataDetails(unit, 'gridView')
    const generic = dataDetails(unit, 'genericSlot')
    const footer = dataDetails(unit, 'footerSlot')
    const cursor = dataDetails(unit, 'cursorConfig')
    const keyHint = dataDetails(unit, 'keyHint')
    const containerNodeSlot = dataDetails(unit, 'containerNodeSlot')
    const templateRefSlot = dataDetails(unit, 'templateRefSlot')
    const effectSlot = dataDetails(unit, 'effectSlot')
    const fullscreenEffectSlot = dataDetails(unit, 'fullscreenEffectSlot')
    const node = createNode(kind, {
      id: idByGuid.get(unit.id?.id),
      guid: unit.id?.id || 0,
      giaInfoIndex: (unit.ui?.content?.info || [])
        .find((entry) => entry.field501 === 2 && entry.field502 === 6)?.index?.value,
      giaRelatedGuids: (unit.ui?.content?.info || [])
        .find((entry) => entry.field501 === 4 && entry.field502 === 4)?.related?.value || [],
      name: unit.name || kind,
      visible: dataDetails(unit, 'field14')?.field17?.initiallyHidden !== true,
      active: dataDetails(unit, 'field14')?.initiallyInactive !== true,
      canControllerFocus: footer?.field505 === 1,
      scriptMappingIds: (generic?.field502 || []).map((entry) => Number(entry?.field1?.id)).filter((id) => Number.isSafeInteger(id) && id > 0),
      transformByPlatform: transformMaps(unit),
      syncAllDevices: dataDetails(unit, 'transform')?.multiPlatform?.field504 === 1,
      giaRaw: {
        genericField501: generic?.field501 ?? 0,
        footerField505: footer?.field505 ?? 0,
        ...((kind === 'textbox' || kind === 'textwindow') ? {
          textField501: text?.field501 ?? 20,
          textField503: text?.field503 ?? 12,
          textAlign: text?.align ?? 0,
          ...(![undefined, 0, 1, 2].includes(text?.verticalAlign) ? { textVerticalAlign: text.verticalAlign } : {}),
          ...(kind === 'textwindow' ? {
            textField511: text?.field511 ?? 1,
            textViewField502: text?.viewFlags?.field502 ?? 1,
            textViewField503: text?.viewFlags?.field503 ?? 1,
          } : {}),
        } : {}),
        ...(kind === 'cursor' ? { cursorField501: cursor?.field501 ?? 0 } : {}),
        ...(kind === 'reference' ? { templateRefSlot: templateRefSlot ?? '' } : {}),
        ...(kind === 'grid' ? {
          gridField501: grid?.field501 ?? 1,
          gridField507: grid?.field507 ?? 1,
          gridField508: grid?.field508 ?? 1,
          gridField509: grid?.field509 ?? 1,
          gridField511: grid?.field511 ?? 5,
          gridField512: grid?.field512 ?? 1,
        } : {}),
        ...(kind === 'keyhint' ? {
          keyHintField501: keyHint?.field501 ?? 1,
          keyHintField502: keyHint?.field502 ?? 1,
        } : {}),
        ...(kind === 'image' ? {
          imageField502: image?.field502 ?? 1,
          imageField504: image?.field504 ?? 1,
          imageField505: image?.field505 ?? 1,
          imageField507: image?.field507 ?? 2,
          imageFillType: image?.fillType ?? 1,
        } : {}),
        ...(kind === 'animation' ? { effectSlot: effectSlot ?? '' } : {}),
        ...(kind === 'fullscreen' ? { fullscreenEffectSlot: fullscreenEffectSlot ?? '' } : {}),
      },
      ...(kind === 'container' ? {
        isolateNavigation: containerNodeSlot?.isolateNavigation === true,
        disableKeyEventPassthrough: containerNodeSlot?.disableKeyEventPassthrough === true,
        disableCursorEventPassthrough: containerNodeSlot?.disableCursorEventPassthrough === true,
        showCursor: containerNodeSlot?.showCursor === true,
      } : {}),
      ...(kind === 'cursor' ? { raycastTarget: cursor?.field501 === 1 } : {}),
      ...((kind === 'textbox' || kind === 'textwindow') ? {
        text: text?.text?.value ?? '', fontSize: text?.fontSize ?? 20,
        minimumFontSize: text?.minimumFontSize ?? 20, adaptiveFontSize: text?.adaptive === 1,
        fontColor: text?.color ?? 0xffffffff, bgColor: text?.color2 ?? 0,
        enableOutline: text?.outlineOff !== 1, outlineColor: text?.color3 ?? 0x33333333,
        horizontalAlignment: text?.align === 1 ? 'Middle' : text?.align === 2 ? 'Right' : 'Left',
        verticalAlignment: { 0: 'Top', 1: 'Middle', 2: 'Bottom' }[text?.verticalAlign ?? 0] || 'Top',
        ...(kind === 'textwindow' ? { interactable: true, showScrollBar: true } : {}),
      } : {}),
      ...(kind === 'image' ? {
        imageSource: 'StaticReference',
        imageId: imageSlot?.assetId ?? 0,
        imageColor: Number.isFinite(imageSlot?.field502) ? (imageSlot.field502 >>> 0) : 0xffffffff,
        enableMask: image?.enableMask === 1,
        enableSoftEdge: image?.enableSoftEdge === 1, enableFill: image?.enableFill === 1,
        softEdgeMode: image?.softEdgePixel === 1 ? 'Pixel' : 'Percentage',
        softEdgeWidthX: image?.border?.field501 ?? 8, softEdgeWidthY: image?.border?.field502 ?? 8,
        horizontalSoftRange: image?.field512 ?? 85, verticalSoftRange: image?.field513 ?? 85,
        fillType: { 1: 'Horizontal', 2: 'Vertical', 3: 'Radial90', 4: 'Radial180', 5: 'Radial360' }[image?.fillType] || 'Horizontal',
        // field508 is a proto3 scalar, so a valid encoded zero is omitted.
        // When filling is enabled, its absence therefore means exactly 0.
        fillAmount: Number.isFinite(image?.field508)
          ? Math.max(0, Math.min(1, image.field508 / 100))
          : image?.enableFill === 1 ? 0 : 1,
        reverseMaskArea: image?.reverseMask === 1,
      } : {}),
      ...(kind === 'button' ? {
        interactable: button?.interactable === 1, raycastTarget: button?.raycastTarget === 1,
        clickAudioId: button?.clickAudioId ?? 50888,
      } : {}),
      ...(kind === 'grid' ? {
        cellSizeX: grid?.cellSize?.field501 ?? 50, cellSizeY: grid?.cellSize?.field502 ?? 50,
        spacingX: grid?.gap?.field501 ?? 8, spacingY: grid?.gap?.field502 ?? 8,
        padding1X: grid?.padding1?.field501 ?? 20, padding1Y: grid?.padding1?.field502 ?? 20,
        padding2X: grid?.padding2?.field501 ?? 20, padding2Y: grid?.padding2?.field502 ?? 20,
        previewCount: grid?.field511 ?? 5,
      } : {}),
      ...(kind === 'reference' ? { referencedPrefabId: templateRefSlot ?? '' } : {}),
      ...(kind === 'keyhint' ? {
        keyboardKeyCode: keyHint?.field502 ?? null,
        controllerKeyCode: keyHint?.field501 ?? null,
      } : {}),
      ...(kind === 'animation' ? { animationId: effectSlot ?? '' } : {}),
      ...(kind === 'fullscreen' ? { animationId: fullscreenEffectSlot ?? '' } : {}),
    })
    nodes.set(unit.id?.id, node)
    if ((kind === 'textbox' || kind === 'textwindow') && ![undefined, 0, 1, 2].includes(text?.align)) warnings.push(`${node.name}: 水平对齐枚举 ${text.align} 的含义未知，已原样保留。`)
    if ((kind === 'textbox' || kind === 'textwindow') && ![undefined, 0, 1, 2].includes(text?.verticalAlign)) warnings.push(`${node.name}: 垂直对齐枚举 ${text.verticalAlign} 的含义未知，已原样保留。`)
    if (kind === 'image' && ![undefined, 0, 1, 2, 3, 4, 5].includes(image?.fillType)) warnings.push(`${node.name}: 填充形状枚举 ${image.fillType} 未识别，已保留原值。`)
    if (kind === 'button') {
      pendingStateGuids.set(node.id, {
        unavailableChildId: button?.disabledChild,
        hoverChildId: button?.hoverChild,
        pressedChildId: button?.pressedChild,
        selectedChildId: button?.selectedChild,
      })
    }
  }
  const rootCandidates = []
  const attached = new Set()
  for (const unit of units) {
    const node = nodes.get(unit.id?.id)
    const listed = (unit.ui?.content?.children || []).map((guid) => nodes.get(guid)).filter(Boolean)
    if (listed.length) {
      node.children = reverseSiblings ? listed.slice().reverse() : listed
      for (const child of listed) attached.add(child.id)
    }
  }
  for (const unit of units) {
    const node = nodes.get(unit.id?.id)
    const parentGuid = unit.ui?.content?.parent || 0
    const parent = nodes.get(parentGuid)
    if (parent) {
      if (!attached.has(node.id)) {
        if (reverseSiblings) parent.children.unshift(node)
        else parent.children.push(node)
      }
    } else {
      rootCandidates.push(node)
    }
  }
  for (const [buttonId, stateGuids] of pendingStateGuids) {
    const button = [...nodes.values()].find((node) => node.id === buttonId)
    for (const [key, guid] of Object.entries(stateGuids)) button[key] = idByGuid.get(guid) || null
  }
  return { nodes, rootCandidates, warnings }
}

export function importGia(input) {
  const payload = decodeEnvelope(input)
  const decoded = RootType.toObject(RootType.decode(payload), {
    longs: Number, enums: Number, bytes: Buffer, defaults: false, arrays: true, objects: true,
  })
  const graphs = decoded.graph || []
  if (!graphs.some((graph) => graph.ui?.content)) throw new Error('GIA 不含可识别的 UIControlGroup 主图')
  const graphGroup = graphs.find((graph) => graph.which === 21) || null
  const templateGraphs = graphs.filter((graph) => Number(graph.which) === 70)
  // Ordinary container assets keep the group in graph and controls in
  // accessories. Template-list assets use repeated graph fields for their
  // top-level controls and accessories only for state children.
  // Combined archives keep the group plus UIControlTemplate(70) graphs.
  const accessories = decoded.accessories || []
  const groupRelated = new Set((graphGroup?.relatedIds || []).map((entry) => entry.id || 0))
  const serverUnits = graphGroup
    ? (groupRelated.size ? accessories.filter((unit) => groupRelated.has(unit.id?.id || 0)) : accessories)
    : []
  const clientUnits = templateGraphs.length
    ? [...templateGraphs, ...accessories.filter((unit) => !groupRelated.has(unit.id?.id || 0))]
    : (graphGroup ? [] : [...graphs, ...accessories])
  if (!serverUnits.length && !clientUnits.length) throw new Error('GIA 不含客户端控件')
  const warnings = ['GIA 导入为已验证 UI 字段的语义导入；未知 protobuf 字段不会进入 Authoring JSON。']
  const extractedScripts = extractScriptMappings(decoded)
  warnings.push(...extractedScripts.warnings)
  let project = null
  let clientProject = null
  if (serverUnits.length) {
    const forest = materializeControlForest(serverUnits, { reverseSiblings: true, idOffset: 0 })
    warnings.push(...forest.warnings)
    const clientRoot = forest.rootCandidates.find((node) => node.kind === 'container') || forest.rootCandidates[0]
    if (!clientRoot) throw new Error('GIA 未找到客户端根控件')
    const server = createNode('server-container', {
      id: 'sc1', guid: graphGroup?.id?.id || 0, name: graphGroup?.name || '客户端控件容器',
      giaRelatedGuids: (graphGroup?.ui?.content?.info || [])
        .find((entry) => entry.field501 === 4 && entry.field502 === 4)?.related?.value || [],
    })
    server.children = [clientRoot]
    if (forest.rootCandidates.length > 1) {
      warnings.push(`检测到 ${forest.rootCandidates.length} 个无父节点控件，仅导入以“${clientRoot.name}”为根的树。`)
    }
    project = {
      version: 1,
      layoutSchemaVersion: LAYOUT_SCHEMA_VERSION,
      meta: {
        name: graphGroup?.name || '导入的界面控件组',
        assetType: 'server-control-template',
        sourceFormat: 'gia',
        sourceFile: '',
        gameVersion: decoded.gameVersion || '',
        giaFilePath: decoded.filePath || '',
        ...(Number.isSafeInteger(Number(decoded.modeFlag)) ? { giaModeFlag: Number(decoded.modeFlag) } : {}),
      },
      canvasId: 'pc-16-9',
      selectedId: clientRoot.id,
      script: { controlId: clientRoot.id, path: '', source: '' },
      root: server,
    }
  }
  if (clientUnits.length) {
    const forest = materializeControlForest(clientUnits, { reverseSiblings: false, idOffset: 1000 })
    warnings.push(...forest.warnings)
    if (!forest.rootCandidates.length) throw new Error('GIA 未找到客户端模板')
    const holder = createNode('server-container', {
      id: 'sc1',
      guid: 0,
      name: '客户端控件模板',
    })
    holder.children = forest.rootCandidates
    clientProject = {
      version: 1,
      layoutSchemaVersion: LAYOUT_SCHEMA_VERSION,
      meta: {
        name: forest.rootCandidates.length === 1 ? forest.rootCandidates[0].name : '客户端控件模板列表',
        assetType: 'client-control-template',
        sourceFormat: 'gia',
        sourceFile: '',
        gameVersion: decoded.gameVersion || '',
        giaFilePath: decoded.filePath || '',
        ...(Number.isSafeInteger(Number(decoded.modeFlag)) ? { giaModeFlag: Number(decoded.modeFlag) } : {}),
      },
      canvasId: 'pc-16-9',
      selectedId: forest.rootCandidates[0].id,
      script: { controlId: forest.rootCandidates[0].id, path: '', source: '' },
      root: holder,
    }
    if (!project) project = clientProject
  }
  return {
    project,
    clientProject: clientProject && project !== clientProject ? clientProject : undefined,
    scripts: extractedScripts.scripts,
    warnings,
    metadata: {
      gameVersion: decoded.gameVersion || '',
      filePath: decoded.filePath || '',
      ...(Number.isSafeInteger(Number(decoded.modeFlag)) ? { modeFlag: Number(decoded.modeFlag) } : {}),
      combined: Boolean(graphGroup && templateGraphs.length),
    },
  }
}

export function inspectGia(input) {
  const payload = decodeEnvelope(input)
  const decoded = RootType.toObject(RootType.decode(payload), { enums: Number, defaults: false, arrays: true })
  const graphs = decoded.graph || []
  const templateCount = graphs.filter((graph) => graph.which === 70).length
  return {
    gameVersion: decoded.gameVersion || '',
    graphName: graphs[0]?.name || '',
    accessories: decoded.accessories?.length || 0,
    assetType: graphs.some((graph) => graph.which === 21) ? 'server-control-template' : 'client-control-template',
    templateCount,
  }
}

export function validateGiaCompatibility(input) {
  const payload = decodeEnvelope(input)
  const decoded = RootType.toObject(RootType.decode(payload), {
    longs: Number, enums: Number, defaults: false, arrays: true, objects: true,
  })
  const graphs = decoded.graph || []
  const accessories = decoded.accessories || []
  const errors = []
  const hasOwn = (object, key) => object != null && Object.prototype.hasOwnProperty.call(object, key)
  const unitByGuid = new Map()
  const unitSummaries = []
  if (!/^\d+-\d+-\d+-\\.+\.gia$/iu.test(decoded.filePath || '')) {
    errors.push(`Root.filePath 不是 UID-TIME-ID-\\文件名.gia：${decoded.filePath || '<missing>'}`)
  }
  const templates = graphs.filter((unit) => unit.which === 70).map((unit) => {
    const kind = detectKind(unit)
    const infos = unit.ui?.content?.info || []
    const actualIndex = infos.find((entry) => entry.field501 === 2 && entry.field502 === 6)?.index?.value
    const expectedIndex = INFO_INDEX[kind]
    const relatedInfo = infos.find((entry) => entry.field501 === 4 && entry.field502 === 4)
    const relatedGuids = relatedInfo?.related?.value || []
    if (!Number.isSafeInteger(actualIndex) || actualIndex <= 0) {
      errors.push(`${unit.name}: Info.index=${actualIndex ?? '<missing>'}，必须是正整数`)
    }
    if (!relatedInfo) errors.push(`${unit.name}: 顶层 UIControlTemplate 缺少 Info.related 记录`)
    return { id: unit.id?.id || 0, name: unit.name || '', kind, actualIndex, expectedIndex, relatedPresent: Boolean(relatedInfo), relatedGuids }
  })
  if (!templates.length) errors.push('Root.graph 不含 UIControlTemplate(70)')
  let explicitField17 = 0
  let explicitRectField508 = 0
  for (const unit of [...graphs, ...accessories]) {
    if (!unit.ui?.content) continue
    const guid = unit.id?.id || 0
    const content = unit.ui.content
    const kind = detectKind(unit)
    const isTemplate = graphs.includes(unit) && unit.which === 70
    const prefix = `${unit.name || '<unnamed>'}(${guid || '<missing-guid>'})`
    if (!Number.isSafeInteger(guid) || guid <= 0 || guid > 0x7fffffff) errors.push(`${prefix}: GraphUnit GUID 非法`)
    else if (unitByGuid.has(guid)) errors.push(`${prefix}: GUID 与 ${unitByGuid.get(guid).name || '<unnamed>'} 重复`)
    else unitByGuid.set(guid, unit)
    if (unit.id?.class !== 1 || unit.id?.type !== 8) errors.push(`${prefix}: GraphUnit.id 必须为 class=1,type=8`)
    if (content.guid !== guid) errors.push(`${prefix}: content.guid=${content.guid ?? '<missing>'} 与 GraphUnit.id.id 不一致`)
    if (isTemplate && unit.which !== 70) errors.push(`${prefix}: 模板根 which 必须为 UIControlTemplate(70)`)
    if (!isTemplate && unit.which !== 15) errors.push(`${prefix}: 附件控件 which 必须为 UIControl(15)`)

    const infos = content.info || []
    const selfInfo = infos.find((entry) => entry.field501 === 1 && entry.field502 === 5)
    const indexInfo = infos.find((entry) => entry.field501 === 2 && entry.field502 === 6)
    if (selfInfo?.guid?.value !== guid) errors.push(`${prefix}: Info.self GUID 缺失或与自身不一致`)
    if (!Number.isSafeInteger(indexInfo?.index?.value) || indexInfo.index.value <= 0) {
      errors.push(`${prefix}: Info.index=${indexInfo?.index?.value ?? '<missing>'}，必须是正整数`)
    }
    const relatedInfo = infos.find((entry) => entry.field501 === 4 && entry.field502 === 4)
    if (isTemplate && !relatedInfo) errors.push(`${prefix}: 顶层模板缺少 Info.related 记录`)
    if (!isTemplate && relatedInfo) errors.push(`${prefix}: 附件控件不应写 Info.related`)

    const expectedSchema = CLIENT_DATA_SCHEMA[kind]
    const data = content.data || []
    const signatures = data.map((entry) => `${entry.field501}/${entry.field502}`)
    const expectedSignatures = expectedSchema?.map(([signature]) => signature) || []
    if (!expectedSchema) errors.push(`${prefix}: 未知客户端控件类型 ${kind}`)
    else if (JSON.stringify(signatures) !== JSON.stringify(expectedSignatures)) {
      errors.push(`${prefix}: Data 槽位顺序 ${signatures.join(',')}，应为 ${expectedSignatures.join(',')}`)
    }
    for (let index = 0; index < Math.min(data.length, expectedSchema?.length || 0); index += 1) {
      const entry = data[index]
      const [signature, outerKey, detailsKey] = expectedSchema[index]
      if (!hasOwn(entry, outerKey)) errors.push(`${prefix}: Data ${signature} 缺少 ${outerKey} 分支`)
      if (!detailsKey) continue
      if (!hasOwn(entry.details, detailsKey)) errors.push(`${prefix}: Details ${signature} 缺少 ${detailsKey} 分支`)
      const expectedMarker = DETAILS_MARKER[signature]
      if (entry.details?.field501 !== expectedMarker || entry.details?.field502 !== entry.field502 || entry.details?.field503 !== 1) {
        errors.push(`${prefix}: Details ${signature} 标记应为 ${expectedMarker}/${entry.field502}/1`)
      }
      const ref = entry.details?.nodeRef
      if (ref?.class !== 1 || ref?.type !== 8 || ref?.id !== guid) errors.push(`${prefix}: Details ${signature} node_ref 未指向自身`)
    }

    const typeDataEntry = (unit.ui.content.data || []).find((entry) => entry.field501 === 4 && entry.field502 === 86)
    if (typeDataEntry) {
      if (!hasOwn(typeDataEntry.field14, 'field17')) errors.push(`${prefix}: 类型 Data 缺少显式 Field14.field17 空串`)
      else explicitField17 += 1
      if (!hasOwn(typeDataEntry.details?.field14, 'field17')) errors.push(`${prefix}: 类型 Details 缺少显式 Field14.field17 空串`)
      else explicitField17 += 1
    }
    const platforms = (unit.ui.content.data || [])
      .find((entry) => entry.details?.transform)?.details?.transform?.multiPlatform?.platforms || []
    if (platforms.length !== 4) errors.push(`${prefix}: 多平台变换数量=${platforms.length}，应为 4`)
    const platformTypes = platforms.map((platform) => platform.platformType || 0)
    if (JSON.stringify(platformTypes) !== JSON.stringify([0, 1, 2, 3])) {
      errors.push(`${prefix}: 平台顺序 ${platformTypes.join(',')}，应为 0,1,2,3`)
    }
    const transform = (unit.ui.content.data || []).find((entry) => entry.details?.transform)?.details?.transform
    if (transform?.multiPlatform?.field502 !== PRESET_INDEX[kind]) {
      errors.push(`${prefix}: 变换 preset=${transform?.multiPlatform?.field502 ?? '<missing>'}，${kind} 应为 ${PRESET_INDEX[kind]}`)
    }
    for (const platform of platforms) {
      if (!hasOwn(platform.transform, 'field508')) errors.push(`${prefix}: RectTransform 缺少显式 field508 空串`)
      else explicitRectField508 += 1
    }
    unitSummaries.push({
      id: guid, name: unit.name || '', kind, template: isTemplate,
      parent: content.parent || 0, children: [...(content.children || [])],
      relatedIds: (unit.relatedIds || []).map((entry) => entry.id || 0), dataSignatures: signatures,
    })
  }
  for (const summary of unitSummaries) {
    const prefix = `${summary.name || '<unnamed>'}(${summary.id})`
    if (JSON.stringify(summary.relatedIds) !== JSON.stringify(summary.children)) {
      errors.push(`${prefix}: GraphUnit.relatedIds 与 content.children 不一致`)
    }
    if (summary.template && summary.parent) errors.push(`${prefix}: 顶层模板不应有 parent`)
    if (!summary.template) {
      const parent = unitByGuid.get(summary.parent)
      if (!parent) errors.push(`${prefix}: parent=${summary.parent || '<missing>'} 不存在`)
      else if (!(parent.ui?.content?.children || []).includes(summary.id)) errors.push(`${prefix}: 父控件 children 未反向包含自身`)
    }
    for (const childGuid of summary.children) {
      const child = unitByGuid.get(childGuid)
      if (!child) errors.push(`${prefix}: child=${childGuid} 不存在`)
      else if ((child.ui?.content?.parent || 0) !== summary.id) errors.push(`${prefix}: child=${childGuid} 的 parent 未指回自身`)
    }
  }
  return {
    valid: errors.length === 0,
    errors,
    filePath: decoded.filePath || '',
    gameVersion: decoded.gameVersion || '',
    templateCount: templates.length,
    accessoryCount: accessories.length,
    templates,
    units: unitSummaries,
    explicitEmpty: { field17: explicitField17, rectField508: explicitRectField508 },
  }
}

export function validateServerGiaCompatibility(input) {
  const payload = decodeEnvelope(input)
  const decoded = RootType.toObject(RootType.decode(payload), {
    longs: Number, enums: Number, defaults: false, arrays: true, objects: true,
  })
  const graphs = (decoded.graph || []).filter((unit) => unit.ui?.content && Number(unit.which) === 21)
  const templateGraphs = (decoded.graph || []).filter((unit) => Number(unit.which) === 70)
  const scriptGraphs = (decoded.graph || []).filter((unit) => Number(unit.which) === SCRIPT_MAPPING_WHICH)
  const accessories = (decoded.accessories || []).filter((unit) => unit.ui?.content)
  const errors = []
  const hasOwn = (object, key) => object != null && Object.prototype.hasOwnProperty.call(object, key)
  if (!/^\d+-\d+-\d+-\\.+\.gia$/iu.test(decoded.filePath || '')) {
    errors.push(`Root.filePath 不是 UID-TIME-ID-\\文件名.gia：${decoded.filePath || '<missing>'}`)
  }
  if (graphs.length !== 1) errors.push(`服务端控件模板 UIControlGroup 数量=${graphs.length}，应为 1`)
  const unknownGraphs = (decoded.graph || []).filter((unit) => {
    const which = Number(unit.which)
    if (which === SCRIPT_MAPPING_WHICH || which === 70 || which === 21) return false
    return !unit.ui?.content
  })
  if (unknownGraphs.length) errors.push(`Root.graph 含 ${unknownGraphs.length} 个无法识别的非控件/非脚本单元`)
  const group = graphs[0]
  if (!group) {
    return {
      valid: false, errors, filePath: decoded.filePath || '', gameVersion: decoded.gameVersion || '',
      accessoryCount: accessories.length, controls: [], scriptCount: scriptGraphs.length, explicitEmpty: { field17: 0, rectField508: 0 },
    }
  }

  const allUnits = [group, ...accessories]
  const unitByGuid = new Map()
  for (const unit of allUnits) {
    const guid = unit.id?.id || 0
    const prefix = `${unit.name || '<unnamed>'}(${guid || '<missing-guid>'})`
    if (!Number.isSafeInteger(guid) || guid <= 0 || guid > 0x7fffffff) errors.push(`${prefix}: GraphUnit GUID 非法`)
    else if (unitByGuid.has(guid)) errors.push(`${prefix}: GUID 重复`)
    else unitByGuid.set(guid, unit)
    if (unit.id?.class !== 1 || unit.id?.type !== 8) errors.push(`${prefix}: GraphUnit.id 必须为 class=1,type=8`)
    if (unit.ui?.content?.guid !== guid) errors.push(`${prefix}: content.guid 与 GraphUnit.id.id 不一致`)
  }

  const groupGuid = group.id?.id || 0
  const groupContent = group.ui.content
  const groupPrefix = `${group.name || '<unnamed>'}(${groupGuid})`
  if (group.which !== 21) errors.push(`${groupPrefix}: which 必须为 UIControlGroup(21)`)
  const groupInfos = groupContent.info || []
  if (groupInfos.find((entry) => entry.field501 === 1 && entry.field502 === 5)?.guid?.value !== groupGuid) {
    errors.push(`${groupPrefix}: Info.self GUID 缺失或不一致`)
  }
  if (groupInfos.find((entry) => entry.field501 === 2 && entry.field502 === 6)?.index?.value !== 1) {
    errors.push(`${groupPrefix}: Info.index 必须为 1`)
  }
  const groupRelatedInfo = groupInfos.find((entry) => entry.field501 === 4 && entry.field502 === 4)
  if (!groupRelatedInfo) errors.push(`${groupPrefix}: 缺少显式 Info.related 记录`)

  let explicitField17 = 0
  let explicitRectField508 = 0
  const validateData = (unit, kind, schema, isGroup = false) => {
    const guid = unit.id?.id || 0
    const prefix = `${unit.name || '<unnamed>'}(${guid})`
    const data = unit.ui.content.data || []
    const signatures = data.map((entry) => `${entry.field501}/${entry.field502}`)
    const expectedSignatures = schema.map(([signature]) => signature)
    if (JSON.stringify(signatures) !== JSON.stringify(expectedSignatures)) {
      errors.push(`${prefix}: Data 槽位顺序 ${signatures.join(',')}，应为 ${expectedSignatures.join(',')}`)
    }
    for (let index = 0; index < Math.min(data.length, schema.length); index += 1) {
      const entry = data[index]
      const [signature, outerKey, detailsKey] = schema[index]
      if (!hasOwn(entry, outerKey)) errors.push(`${prefix}: Data ${signature} 缺少 ${outerKey} 分支`)
      if (!detailsKey) continue
      if (!hasOwn(entry.details, detailsKey)) errors.push(`${prefix}: Details ${signature} 缺少 ${detailsKey} 分支`)
      const expectedMarker = DETAILS_MARKER[signature]
      if (entry.details?.field501 !== expectedMarker || entry.details?.field502 !== entry.field502 || entry.details?.field503 !== 1) {
        errors.push(`${prefix}: Details ${signature} 标记应为 ${expectedMarker}/${entry.field502}/1`)
      }
      const ref = entry.details?.nodeRef
      if (ref?.class !== 1 || ref?.type !== 8 || ref?.id !== guid) errors.push(`${prefix}: Details ${signature} node_ref 未指向自身`)
    }
    const typeEntry = data.find((entry) => entry.field501 === 4 && entry.field502 === (isGroup ? 23 : 86))
    const emptyKey = isGroup ? 'empty15' : 'field17'
    if (!hasOwn(typeEntry?.field14, emptyKey)) errors.push(`${prefix}: 类型 Data 缺少显式 Field14.${emptyKey} 空串`)
    else if (!isGroup) explicitField17 += 1
    if (!hasOwn(typeEntry?.details?.field14, emptyKey)) errors.push(`${prefix}: 类型 Details 缺少显式 Field14.${emptyKey} 空串`)
    else if (!isGroup) explicitField17 += 1
    const transform = data.find((entry) => entry.details?.transform)?.details?.transform
    const platforms = transform?.multiPlatform?.platforms || []
    if (platforms.length !== 4) errors.push(`${prefix}: 多平台变换数量=${platforms.length}，应为 4`)
    const platformTypes = platforms.map((platform) => platform.platformType || 0)
    if (JSON.stringify(platformTypes) !== JSON.stringify([0, 1, 2, 3])) {
      errors.push(`${prefix}: 平台顺序 ${platformTypes.join(',')}，应为 0,1,2,3`)
    }
    const expectedPreset = isGroup ? PRESET_INDEX['server-container'] : PRESET_INDEX[kind]
    if (transform?.multiPlatform?.field502 !== expectedPreset) {
      errors.push(`${prefix}: 变换 preset=${transform?.multiPlatform?.field502 ?? '<missing>'}，应为 ${expectedPreset}`)
    }
    for (const platform of platforms) {
      if (!hasOwn(platform.transform, 'field508')) errors.push(`${prefix}: RectTransform 缺少显式 field508 空串`)
      else explicitRectField508 += 1
    }
    return signatures
  }

  validateData(group, 'server-container', SERVER_GROUP_DATA_SCHEMA, true)
  const groupRelatedIds = (group.relatedIds || []).map((entry) => entry.id || 0)
  const relatedSet = new Set(groupRelatedIds)
  const serverAccessories = accessories.filter((unit) => relatedSet.has(unit.id?.id || 0))
  const accessoryIds = serverAccessories.map((unit) => unit.id?.id || 0)
  if (JSON.stringify(groupRelatedIds) !== JSON.stringify(accessoryIds)) {
    errors.push(`${groupPrefix}: 主图 relatedIds 必须按顺序覆盖本组 accessories`)
  }
  const rootGuid = groupContent.data?.find((entry) => entry.details?.rootChildRef)?.details?.rootChildRef?.guid || 0
  const rootControl = unitByGuid.get(rootGuid)
  if (!rootControl || !serverAccessories.includes(rootControl)) errors.push(`${groupPrefix}: 62/82 根节点引用不存在`)
  if (accessoryIds[0] !== rootGuid) errors.push(`${groupPrefix}: 根容器节点必须是本组 accessories[0]`)

  const controls = []
  for (const unit of serverAccessories) {
    const guid = unit.id?.id || 0
    const content = unit.ui.content
    const prefix = `${unit.name || '<unnamed>'}(${guid})`
    const kind = detectKind(unit)
    if (unit.which !== 15) errors.push(`${prefix}: which 必须为 UIControl(15)`)
    const infos = content.info || []
    if (infos.length !== 1 || infos[0]?.field501 !== 1 || infos[0]?.field502 !== 5 || infos[0]?.guid?.value !== guid) {
      errors.push(`${prefix}: 服务端容器内控件 Info 必须只含自身 GUID`)
    }
    const schema = CLIENT_DATA_SCHEMA[kind]
    if (!schema) errors.push(`${prefix}: 未知客户端控件类型 ${kind}`)
    const signatures = schema ? validateData(unit, kind, schema) : []
    controls.push({
      id: guid, name: unit.name || '', kind, parent: content.parent || 0,
      children: [...(content.children || [])],
      relatedIds: (unit.relatedIds || []).map((entry) => entry.id || 0),
      dataSignatures: signatures,
    })
  }

  const rootSummary = controls.find((control) => control.id === rootGuid)
  if (rootSummary) {
    if (rootSummary.kind !== 'container') errors.push(`${rootSummary.name}(${rootGuid}): 根控件必须为容器节点`)
    if (rootSummary.parent) errors.push(`${rootSummary.name}(${rootGuid}): 根控件不应有 parent`)
  }
  const controlByGuid = new Map(controls.map((control) => [control.id, control]))
  for (const control of controls) {
    const prefix = `${control.name}(${control.id})`
    if (JSON.stringify(control.relatedIds) !== JSON.stringify(control.children)) {
      errors.push(`${prefix}: relatedIds 必须与直接 children 一致`)
    }
    if (control.id !== rootGuid) {
      const parent = controlByGuid.get(control.parent)
      if (!parent) errors.push(`${prefix}: parent=${control.parent || '<missing>'} 不存在`)
      else if (!parent.children.includes(control.id)) errors.push(`${prefix}: 父控件 children 未反向包含自身`)
    }
    for (const childGuid of control.children) {
      const child = controlByGuid.get(childGuid)
      if (!child) errors.push(`${prefix}: child=${childGuid} 不存在`)
      else if (child.parent !== control.id) errors.push(`${prefix}: child=${childGuid} 的 parent 未指回自身`)
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    filePath: decoded.filePath || '',
    gameVersion: decoded.gameVersion || '',
    graph: { id: groupGuid, name: group.name || '', relatedGuids: groupRelatedInfo?.related?.value || [], rootGuid },
    accessoryCount: accessories.length,
    controls,
    scriptCount: scriptGraphs.length,
    explicitEmpty: { field17: explicitField17, rectField508: explicitRectField508 },
  }
}
