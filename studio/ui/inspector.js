import { CORE_KINDS, IMAGE_PRIMITIVES, KIND_LABELS } from '../constants.js'
import {
  applyMatrix,
  canvasBox,
  classifyAnchor,
  composeRectMatrix,
  computeRect,
  identityMatrix,
  invertMatrix,
  inspectorFromRect,
  platformOfPreset,
  transformedRectMetrics,
} from './layout.js'
import { readCurrentTransform } from './sync.js'
import { getPlatformTransform } from './transforms.js'

export function painterBoxes(root, boxes) {
  const out = []
  function rec(node) {
    if (boxes[node.id]) out.push(boxes[node.id])
    const children = node.children || []
    for (let i = children.length - 1; i >= 0; i -= 1) rec(children[i])
  }
  rec(root)
  return out
}

export function layoutTree(root, canvasId, platform = platformOfPreset(canvasId)) {
  const canvas = canvasBox(canvasId)
  const boxes = {}
  function rec(node, parentBox, parentMatrix) {
    const transform = getPlatformTransform(node.transformByPlatform, platform)
    const box = computeRect(parentBox, transform)
    // A server container is an authoring-only bridge to the client root: its
    // rect is deliberately skipped for child layout, so skip its visual
    // transform as well.
    const matrix = node.kind === 'server-container'
      ? parentMatrix
      : composeRectMatrix(parentMatrix, box, transform)
    const render = transformedRectMetrics(box, matrix)
    boxes[node.id] = {
      ...box,
      ...inspectorFromRect(box),
      id: node.id,
      kind: node.kind,
      name: node.name,
      visible: node.visible !== false,
      active: node.active !== false,
      rotationZ: transform.rotation.z,
      renderLeft: render.left,
      renderBottom: render.bottom,
      renderWidth: render.width,
      renderHeight: render.height,
      renderRotationZ: render.rotationZ,
      renderMatrix: matrix,
      primitive: node.kind === 'image' ? (IMAGE_PRIMITIVES[node.imageId] || 'missing') : null,
      ...((node.kind === 'textbox' || node.kind === 'textwindow') ? {
        text: node.text ?? '',
        fontSize: node.fontSize,
        fontColor: node.fontColor,
        bgColor: node.bgColor,
        enableOutline: node.enableOutline !== false,
        outlineColor: node.outlineColor,
        horizontalAlignment: node.horizontalAlignment,
        verticalAlignment: node.verticalAlignment,
      } : {}),
      ...(node.kind === 'image' ? {
        imageSource: node.imageSource,
        imageId: node.imageId,
        imageColor: node.imageColor,
        enableMask: node.enableMask === true,
        enableSoftEdge: node.enableSoftEdge === true,
        softEdgeMode: node.softEdgeMode,
        softEdgeWidthX: node.softEdgeWidthX,
        softEdgeWidthY: node.softEdgeWidthY,
        horizontalSoftRange: node.horizontalSoftRange,
        verticalSoftRange: node.verticalSoftRange,
        enableFill: node.enableFill === true,
        fillType: node.fillType,
        fillHorizontalType: node.fillHorizontalType,
        fillVerticalType: node.fillVerticalType,
        fillRadial90Type: node.fillRadial90Type,
        fillRadialType: node.fillRadialType,
        fillAmount: node.fillAmount,
        reverseMaskArea: node.reverseMaskArea === true,
      } : {}),
      ...(node.kind === 'button' ? {
        raycastTarget: node.raycastTarget !== false,
        interactable: node.interactable !== false,
        clickAudioId: node.clickAudioId,
        unavailableChildId: node.unavailableChildId ?? null,
        hoverChildId: node.hoverChildId ?? null,
        pressedChildId: node.pressedChildId ?? null,
        selectedChildId: node.selectedChildId ?? null,
      } : {}),
    }
    const childParent = node.kind === 'server-container' ? parentBox : box
    for (const child of node.children || []) rec(child, childParent, matrix)
  }
  rec(root, canvas, identityMatrix())
  return { canvas, boxes }
}

export function treeRows(root, guidById) {
  const rows = []
  function rec(node, depth, parentId = null, ancestorIds = [], siblingIndex = 0, siblingCount = 1, templateId = root.id) {
    rows.push({
      id: node.id,
      guid: guidById?.get(node.id) ?? (node.guid || 0),
      kind: node.kind,
      name: node.name,
      label: KIND_LABELS[node.kind] || node.kind,
      depth,
      parentId,
      ancestorIds,
      siblingIndex,
      siblingCount,
      templateId,
      childCount: (node.children || []).length,
      incomplete: !CORE_KINDS.includes(node.kind),
    })
    const children = node.children || []
    for (let index = 0; index < children.length; index += 1) {
      rec(children[index], depth + 1, node.id, [...ancestorIds, node.id], index, children.length, templateId)
    }
  }
  rec(root, 0)
  return rows
}

function field(key, label, type, value, extra = {}) {
  return { key, label, type, value, ...extra }
}

export function inspectorDto(node, canvasId, box, guidById) {
  if (!node) return null
  const transform = readCurrentTransform(node.transformByPlatform, canvasId)
  const vis = inspectorFromRect(box)
  const fields = [
    field('name', '名称', 'string', node.name),
    field('active', '初始激活', 'bool', node.active !== false),
    field('visible', '初始可见性', 'bool', node.visible !== false),
    field('canControllerFocus', '可被手柄摇杆导航选中', 'bool', node.canControllerFocus === true),
    field('posX', '位置 X', 'number', vis.posX, { computed: true }),
    field('posY', '位置 Y', 'number', vis.posY, { computed: true }),
    field('width', '大小 W', 'number', vis.width, { computed: true }),
    field('height', '大小 H', 'number', vis.height, { computed: true }),
    field('rotationZ', '旋转 Z', 'number', transform.rotation.z),
    field('syncAllDevices', '同步信息至所有设备', 'bool', node.syncAllDevices !== false),
    field('anchorType', '锚点类型', 'enum', classifyAnchor(transform), {
      options: [
        { value: 'center', label: '居中' },
        { value: 'top-left', label: '左上' },
        { value: 'top', label: '上方' },
        { value: 'top-right', label: '右上' },
        { value: 'left', label: '左侧' },
        { value: 'right', label: '右侧' },
        { value: 'bottom-left', label: '左下' },
        { value: 'bottom', label: '下方' },
        { value: 'bottom-right', label: '右下' },
        { value: 'stretch', label: '双向拉伸' },
        { value: 'stretch-horizontal', label: '水平拉伸' },
        { value: 'stretch-vertical', label: '垂直拉伸' },
        { value: 'custom', label: '自定义' },
      ],
    }),
    field('anchorMinX', '锚点 Min X', 'number', transform.anchorMin.x),
    field('anchorMinY', '锚点 Min Y', 'number', transform.anchorMin.y),
    field('anchorMaxX', '锚点 Max X', 'number', transform.anchorMax.x),
    field('anchorMaxY', '锚点 Max Y', 'number', transform.anchorMax.y),
    field('pivotX', '中心 X', 'number', transform.pivot.x),
    field('pivotY', '中心 Y', 'number', transform.pivot.y),
  ]
  if (node.kind === 'container') {
    fields.push(
      field('isolateNavigation', '隔离手柄导航', 'bool', node.isolateNavigation === true),
      field('disableKeyEventPassthrough', '屏蔽按键事件穿透', 'bool', node.disableKeyEventPassthrough === true),
      field('disableCursorEventPassthrough', '屏蔽区域内点击事件穿透', 'bool', node.disableCursorEventPassthrough === true),
      field('showCursor', '显示常驻光标', 'bool', node.showCursor === true),
    )
  }
  if (node.kind === 'textbox' || node.kind === 'textwindow') {
    const rawTextAlign = node.giaRaw?.textAlign
    const horizontalAlignment = [0, 1, 2].includes(rawTextAlign)
      ? (node.horizontalAlignment || 'Left')
      : `__unrecognized:${rawTextAlign}`
    fields.push(
      field('fontSize', '字号', 'number', node.fontSize),
      field('adaptiveFontSize', '字号自适应', 'bool', node.adaptiveFontSize === true),
      field('minimumFontSize', '最小字号', 'number', node.minimumFontSize),
      field('fontColor', '文本色', 'color', node.fontColor),
      field('bgColor', '背景色', 'color', node.bgColor),
      field('enableOutline', '启用描边', 'bool', node.enableOutline !== false),
      field('outlineColor', '描边色', 'color', node.outlineColor),
      field('horizontalAlignment', '水平对齐', 'enum', horizontalAlignment, {
        ...(![0, 1, 2].includes(rawTextAlign) ? { unknownValue: rawTextAlign } : {}),
        options: [
          { value: 'Left', label: '左对齐' },
          { value: 'Middle', label: '居中' },
          { value: 'Right', label: '右对齐' },
        ],
      }),
      field('verticalAlignment', '垂直对齐', 'enum', node.verticalAlignment || 'Top', {
        options: [
          { value: 'Top', label: '顶部' },
          { value: 'Middle', label: '居中' },
          { value: 'Bottom', label: '底部' },
        ],
      }),
      field('text', '文本', 'text', node.text ?? ''),
    )
  }
  if (node.kind === 'image') {
    const rawFillType = node.giaRaw?.imageFillType
    const fillType = [1, 2, 3, 4, 5].includes(rawFillType)
      ? node.fillType
      : `__unrecognized:${rawFillType}`
    fields.push(
      field('imageSource', '图片源', 'enum', node.imageSource, { readonly: true, evidence: 'W', options: [
        { value: 'StaticReference', label: '静态引用' },
      ] }),
      field('imageId', 'imageId', 'number', node.imageId ?? 0),
      field('imageColor', '填充色', 'color', node.imageColor),
      field('enableMask', '开启遮罩', 'bool', node.enableMask === true),
      field('enableSoftEdge', '边缘羽化', 'bool', node.enableSoftEdge === true, { gia: 'W' }),
      field('softEdgeMode', '羽化模式', 'enum', node.softEdgeMode, { options: [
        { value: 'Percentage', label: '百分比' },
        { value: 'Pixel', label: '像素' },
      ] }),
      field('softEdgeWidthX', '羽化宽度 X', 'number', node.softEdgeWidthX),
      field('softEdgeWidthY', '羽化宽度 Y', 'number', node.softEdgeWidthY),
      field('horizontalSoftRange', '水平羽化范围', 'number', node.horizontalSoftRange),
      field('verticalSoftRange', '垂直羽化范围', 'number', node.verticalSoftRange),
      field('enableFill', '按进度填充', 'bool', node.enableFill === true, { gia: 'W' }),
      field('fillType', '形状', 'enum', fillType, {
        ...(![1, 2, 3, 4, 5].includes(rawFillType) ? { unknownValue: rawFillType } : {}),
        options: [
        { value: 'Horizontal', label: '横向' },
        { value: 'Vertical', label: '纵向' },
        { value: 'Radial90', label: '90度环绕' },
        { value: 'Radial180', label: '180度环绕' },
        { value: 'Radial360', label: '360度环绕' },
        ],
      }),
      field('fillHorizontalType', '方向', 'enum', node.fillHorizontalType, { options: [
        { value: 'Left', label: '从左至右' },
        { value: 'Right', label: '从右至左' },
      ] }),
      field('fillVerticalType', '方向', 'enum', node.fillVerticalType, { options: [
        { value: 'Bottom', label: '从下至上' },
        { value: 'Top', label: '从上至下' },
      ] }),
      field('fillRadial90Type', '起点', 'enum', node.fillRadial90Type, { options: [
        { value: 'BottomLeft', label: '左下' },
        { value: 'TopLeft', label: '左上' },
        { value: 'TopRight', label: '右上' },
        { value: 'BottomRight', label: '右下' },
      ] }),
      field('fillRadialType', '起点', 'enum', node.fillRadialType, { options: [
        { value: 'Bottom', label: '下方' },
        { value: 'Left', label: '左侧' },
        { value: 'Top', label: '上方' },
        { value: 'Right', label: '右侧' },
      ] }),
      field('fillAmount', '进度', 'percent', node.fillAmount),
      field('reverseMaskArea', '遮罩区域反转', 'bool', node.reverseMaskArea === true, { gia: 'W' }),
    )
  }
  if (node.kind === 'button') {
    const childOptions = [
      { value: '', label: '未设置' },
      ...(node.children || []).map((child) => ({ value: child.id, label: `${child.name} · ${child.id}` })),
    ]
    fields.push(
      field('raycastTarget', '可被光标射线检测', 'bool', node.raycastTarget !== false),
      field('interactable', '按钮是否可用', 'bool', node.interactable !== false),
      field('unavailableChildId', '不可用状态节点', 'node', node.unavailableChildId, { options: childOptions, gia: 'W' }),
      field('hoverChildId', '悬停状态节点', 'node', node.hoverChildId, { options: childOptions, gia: 'W' }),
      field('pressedChildId', '按下状态节点', 'node', node.pressedChildId, { options: childOptions, gia: 'W' }),
      field('selectedChildId', '选中状态节点', 'node', node.selectedChildId, { options: childOptions, gia: 'W' }),
      field('clickAudioId', '点击音效', 'number', node.clickAudioId),
    )
  }
  if (node.kind === 'reference') {
    fields.push(field('referencedPrefabId', '引用控件模板索引', 'string', node.referencedPrefabId ?? ''))
  }
  if (node.kind === 'grid') {
    fields.push(
      field('cellSizeX', '列表项大小 W', 'number', node.cellSizeX, { evidence: 'W' }),
      field('cellSizeY', '列表项大小 H', 'number', node.cellSizeY, { evidence: 'W' }),
      field('spacingX', '列表项间隔 X', 'number', node.spacingX, { evidence: 'W' }),
      field('spacingY', '列表项间隔 Y', 'number', node.spacingY, { evidence: 'W' }),
      field('padding1X', '边距向量 1 X', 'number', node.padding1X, { evidence: 'W' }),
      field('padding1Y', '边距向量 1 Y', 'number', node.padding1Y, { evidence: 'W' }),
      field('padding2X', '边距向量 2 X', 'number', node.padding2X, { evidence: 'W' }),
      field('padding2Y', '边距向量 2 Y', 'number', node.padding2Y, { evidence: 'W' }),
      field('previewCount', '预览数量', 'number', node.previewCount),
    )
  }
  if (node.kind === 'keyhint') {
    fields.push(
      field('keyboardKeyCode', '键鼠按键', 'number', node.keyboardKeyCode ?? node.giaRaw?.keyHintField502 ?? 1, { gia: 'W' }),
      field('controllerKeyCode', '手柄按键', 'number', node.controllerKeyCode ?? node.giaRaw?.keyHintField501 ?? 1),
    )
  }
  if (node.kind === 'animation' || node.kind === 'fullscreen') {
    fields.push(field('animationId', node.kind === 'animation' ? '动效索引' : '全屏动效索引', 'string', node.animationId ?? ''))
  }
  if (!CORE_KINDS.includes(node.kind)) {
    fields.push(field('incomplete', '完整度', 'note', '本阶段仅公共变换，业务槽不完整'))
  }
  return {
    id: node.id,
    guid: guidById?.get(node.id) ?? (node.guid || 0),
    kind: node.kind,
    label: KIND_LABELS[node.kind] || node.kind,
    incomplete: !CORE_KINDS.includes(node.kind),
    fields,
  }
}

export function hitTest(boxes, x, y) {
  const list = (Array.isArray(boxes) ? boxes : Object.values(boxes))
    .filter((b) => b.kind !== 'server-container')
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const b = list[index]
    if (!b.visible || !b.active) continue
    const inverse = b.renderMatrix && invertMatrix(b.renderMatrix)
    const local = inverse && applyMatrix(inverse, x, y)
    if (local && local.x >= b.left && local.x <= b.right && local.y >= b.bottom && local.y <= b.top) return b.id
  }
  return null
}
