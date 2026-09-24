/**
 * Authoring → lua-runtime Control spec (current canvas platform only).
 * Instantiated play-time nodes are never written back.
 * canvasIdOverride lets play sessions run a specific device preset
 * without touching the editor's authoring selection.
 */

import { CANVAS_PRESETS } from '../constants.js'
import { selectedTemplateRoot } from '../ui/authoring.js'
import { readCurrentTransform } from '../ui/sync.js'

const KIND_TO_RUNTIME = {
  container: 'container',
  textbox: 'textbox',
  image: 'image',
  button: 'button',
  cursor: 'cursor',
  grid: 'grid',
  reference: 'reference',
  textwindow: 'textwindow',
  keyhint: 'keyhint',
  animation: 'animation',
  fullscreen: 'fullscreen',
}

export function compileControl(node, canvasId, scriptsByNode = null) {
  const rt = readCurrentTransform(node.transformByPlatform, canvasId)
  const spec = {
    authoringId: node.id,
    kind: KIND_TO_RUNTIME[node.kind] || 'container',
    name: node.name,
    prefabIndex: node.guid || 0,
    active: node.active !== false,
    visible: node.visible !== false,
    canControllerFocus: node.canControllerFocus === true,
    anchoredPositionX: rt.offset.x,
    anchoredPositionY: rt.offset.y,
    sizeDeltaX: rt.size.x,
    sizeDeltaY: rt.size.y,
    anchorMinX: rt.anchorMin.x,
    anchorMinY: rt.anchorMin.y,
    anchorMaxX: rt.anchorMax.x,
    anchorMaxY: rt.anchorMax.y,
    pivotX: rt.pivot.x,
    pivotY: rt.pivot.y,
    localScaleX: rt.scale.x,
    localScaleY: rt.scale.y,
    localScaleZ: rt.scale.z,
    localRotationX: rt.rotation.x,
    localRotationY: rt.rotation.y,
    localRotationZ: rt.rotation.z,
    children: (node.children || []).map((c) => compileControl(c, canvasId, scriptsByNode)),
  }
  const mounted = scriptsByNode?.get(node.id)
  if (mounted?.length) {
    spec.scripts = mounted.map((script) => {
      const scriptMappingId = Number(script.guid)
      return {
        path: script.path || script.id,
        source: script.source || '',
        ...(Number.isSafeInteger(scriptMappingId) && scriptMappingId > 0 ? { scriptMappingId } : {}),
      }
    })
  }
  if (node.kind === 'container') {
    spec.isolateNavigation = node.isolateNavigation === true
    spec.disableKeyEventPassthrough = node.disableKeyEventPassthrough === true
    spec.disableCursorEventPassthrough = node.disableCursorEventPassthrough === true
    spec.showCursor = node.showCursor === true
  }
  if (node.kind === 'textbox' || node.kind === 'textwindow') {
    spec.text = node.text ?? ''
    spec.fontSize = node.fontSize
    spec.adaptiveFontSize = node.adaptiveFontSize === true
    spec.minimumFontSize = node.minimumFontSize
    spec.fontColor = node.fontColor
    spec.bgColor = node.bgColor
    spec.enableOutline = node.enableOutline !== false
    spec.outlineColor = node.outlineColor
    spec.horizontalAlignment = node.horizontalAlignment || 'Left'
    spec.verticalAlignment = node.verticalAlignment || 'Top'
    if (node.kind === 'textwindow') {
      spec.interactable = node.interactable !== false
      spec.showScrollBar = node.showScrollBar !== false
    }
  }
  if (node.kind === 'image') {
    spec.imageSource = node.imageSource
    spec.imageId = node.imageId ?? 0
    spec.imageColor = node.imageColor
    spec.raycastTarget = node.raycastTarget === true
    spec.enableMask = node.enableMask === true
    spec.enableSoftEdge = node.enableSoftEdge === true
    spec.softEdgeMode = node.softEdgeMode
    spec.softEdgeWidthX = node.softEdgeWidthX
    spec.softEdgeWidthY = node.softEdgeWidthY
    spec.horizontalSoftRange = node.horizontalSoftRange
    spec.verticalSoftRange = node.verticalSoftRange
    spec.enableFill = node.enableFill === true
    spec.fillType = node.enableFill ? node.fillType : 'Unused'
    spec.fillHorizontalType = node.fillHorizontalType
    spec.fillVerticalType = node.fillVerticalType
    spec.fillRadial90Type = node.fillRadial90Type
    spec.fillRadialType = node.fillRadialType
    spec.fillAmount = node.fillAmount
    spec.reverseMaskArea = node.reverseMaskArea === true
  }
  if (node.kind === 'button') {
    spec.raycastTarget = node.raycastTarget !== false
    spec.interactable = node.interactable !== false
    spec.clickAudioId = node.clickAudioId
    spec.unavailableChildId = node.unavailableChildId ?? null
    spec.hoverChildId = node.hoverChildId ?? null
    spec.pressedChildId = node.pressedChildId ?? null
    spec.selectedChildId = node.selectedChildId ?? null
  }
  if (node.kind === 'cursor') spec.raycastTarget = node.raycastTarget !== false
  if (node.kind === 'reference') spec.referencedPrefabIndex = node.referencedPrefabId
  if (node.kind === 'grid') {
    spec.itemPrefabIndex = node.itemPrefabId
    spec.raycastTarget = node.raycastTarget !== false
    spec.interactable = node.interactable !== false
    spec.showScrollBar = node.showScrollBar !== false
    spec.scrollDirection = node.scrollDirection
    spec.layoutConstraint = node.layoutConstraint
    spec.layoutConstraintFixedCount = node.layoutConstraintFixedCount
    spec.cellSizeX = node.cellSizeX
    spec.cellSizeY = node.cellSizeY
    spec.spacingX = node.spacingX
    spec.spacingY = node.spacingY
    spec.padding1X = node.padding1X
    spec.padding1Y = node.padding1Y
    spec.padding2X = node.padding2X
    spec.padding2Y = node.padding2Y
    spec.previewCount = node.previewCount
  }
  if (node.kind === 'keyhint') {
    spec.keyboardKeyCode = node.keyboardKeyCode
    spec.controllerKeyCode = node.controllerKeyCode
  }
  if (node.kind === 'animation' || node.kind === 'fullscreen') {
    spec.raycastTarget = false
    spec.animationId = node.animationId
    spec.playSoundEffect = node.playSoundEffect
    if (node.kind === 'animation') spec.layer = node.layer
  }
  return spec
}

export function compileProject(project, scripts = [], canvasIdOverride = '') {
  const canvasId = canvasIdOverride && CANVAS_PRESETS[canvasIdOverride]
    ? canvasIdOverride
    : project.canvasId
  const canvas = CANVAS_PRESETS[canvasId]
  const rootNode = selectedTemplateRoot(project)
  const scriptsByNode = new Map()
  for (const script of scripts) {
    if (!script.controlId) continue
    const list = scriptsByNode.get(script.controlId) || []
    list.push(script)
    scriptsByNode.set(script.controlId, list)
  }
  const templates = project.meta?.assetType === 'client-control-template'
    ? (project.root.children || []).map((node) => compileControl(node, canvasId, scriptsByNode))
    : []
  return {
    canvasId,
    platform: canvas.platform,
    device: canvas.luaDevice,
    canvasWidth: canvas.width,
    canvasHeight: canvas.height,
    root: compileControl(rootNode, canvasId, scriptsByNode),
    templates,
  }
}
