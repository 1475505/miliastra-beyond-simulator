/**
 * Unity-style RectTransform layout.
 * Origin: parent bottom-left. Anchors/pivot in 0–1 of the parent/self.
 * Inspector position is the visual center (official docs), not the pivot.
 */

import { CANVAS_PRESETS, DEFAULT_CANVAS_ID, PLATFORMS } from '../constants.js'

export function getCanvasPreset(id) {
  const preset = CANVAS_PRESETS[id] || CANVAS_PRESETS[DEFAULT_CANVAS_ID]
  return preset
}

export function cloneVec2(v, fallbackX = 0, fallbackY = 0) {
  if (!v || typeof v !== 'object') return { x: fallbackX, y: fallbackY }
  return {
    x: Number(v.x ?? fallbackX),
    y: Number(v.y ?? fallbackY),
  }
}

export function cloneVec3(v) {
  if (!v || typeof v !== 'object') return { x: 1, y: 1, z: 1 }
  return {
    x: Number(v.x ?? 1),
    y: Number(v.y ?? 1),
    z: Number(v.z ?? 1),
  }
}

export function cloneRotation(v) {
  if (!v || typeof v !== 'object') return { x: 0, y: 0, z: 0 }
  return {
    x: Number(v.x ?? 0),
    y: Number(v.y ?? 0),
    z: Number(v.z ?? 0),
  }
}

export function createRectTransform({
  layout = 'center',
  size = [100, 40],
  offset = [0, 0],
} = {}) {
  if (layout === 'stretch') {
    return {
      scale: { x: 1, y: 1, z: 1 },
      rotation: { x: 0, y: 0, z: 0 },
      anchorMin: { x: 0, y: 0 },
      anchorMax: { x: 1, y: 1 },
      offset: { x: 0, y: 0 },
      size: { x: 0, y: 0 },
      pivot: { x: 0.5, y: 0.5 },
    }
  }
  return {
    scale: { x: 1, y: 1, z: 1 },
    rotation: { x: 0, y: 0, z: 0 },
    anchorMin: { x: 0.5, y: 0.5 },
    anchorMax: { x: 0.5, y: 0.5 },
    offset: { x: Number(offset[0] ?? 0), y: Number(offset[1] ?? 0) },
    size: { x: Number(size[0] ?? 0), y: Number(size[1] ?? 0) },
    pivot: { x: 0.5, y: 0.5 },
  }
}

export function cloneRectTransform(rt) {
  const src = rt || createRectTransform()
  return {
    scale: cloneVec3(src.scale),
    rotation: cloneRotation(src.rotation),
    anchorMin: cloneVec2(src.anchorMin ?? src.anchor_min, 0.5, 0.5),
    anchorMax: cloneVec2(src.anchorMax ?? src.anchor_max, 0.5, 0.5),
    offset: cloneVec2(src.offset, 0, 0),
    size: cloneVec2(src.size, 0, 0),
    pivot: cloneVec2(src.pivot, 0.5, 0.5),
  }
}

function num(value, fallback = 0) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

/**
 * Axis-aligned box in parent space. `transform` may be a RectTransform or a
 * runtime Control (flat local* / anchored* fields).
 */
export function computeRect(parentBox, transform) {
  const pw = parentBox.width
  const ph = parentBox.height
  const pl = parentBox.left
  const pb = parentBox.bottom
  const anchorMin = transform.anchorMin || { x: transform.anchorMinX, y: transform.anchorMinY }
  const anchorMax = transform.anchorMax || { x: transform.anchorMaxX, y: transform.anchorMaxY }
  const offset = transform.offset || { x: transform.anchoredPositionX, y: transform.anchoredPositionY }
  const size = transform.size || { x: transform.sizeDeltaX, y: transform.sizeDeltaY }
  const pivot = transform.pivot || { x: transform.pivotX, y: transform.pivotY }
  const aMinX = num(anchorMin?.x, 0.5) * pw
  const aMinY = num(anchorMin?.y, 0.5) * ph
  const aMaxX = num(anchorMax?.x, 0.5) * pw
  const aMaxY = num(anchorMax?.y, 0.5) * ph
  const sizeX = num(size?.x)
  const sizeY = num(size?.y)
  const pivotX = num(pivot?.x, 0.5)
  const pivotY = num(pivot?.y, 0.5)
  // size = sizeDelta; offset = anchoredPosition (Unity).
  // Pivot offset uses sizeDelta, not the stretched visual size.
  const width = (aMaxX - aMinX) + sizeX
  const height = (aMaxY - aMinY) + sizeY
  const left = pl + aMinX + num(offset?.x) - sizeX * pivotX
  const bottom = pb + aMinY + num(offset?.y) - sizeY * pivotY
  return {
    left,
    bottom,
    width,
    height,
    right: left + width,
    top: bottom + height,
    centerX: left + width / 2,
    centerY: bottom + height / 2,
  }
}

/**
 * A 2D affine matrix in the UI's bottom-left coordinate system.
 *
 * RectTransform layout is solved before transforms are applied: a child's
 * anchors continue to use its parent's unscaled rect, while the parent's
 * scale/rotation changes the child's final display and hit-test space.
 */
export function identityMatrix() {
  return { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 }
}

/** Returns outer ∘ inner (apply inner first, then outer). */
function multiplyMatrix(outer, inner) {
  return {
    a: outer.a * inner.a + outer.c * inner.b,
    b: outer.b * inner.a + outer.d * inner.b,
    c: outer.a * inner.c + outer.c * inner.d,
    d: outer.b * inner.c + outer.d * inner.d,
    tx: outer.a * inner.tx + outer.c * inner.ty + outer.tx,
    ty: outer.b * inner.tx + outer.d * inner.ty + outer.ty,
  }
}

export function applyMatrix(matrix, x, y) {
  return {
    x: matrix.a * x + matrix.c * y + matrix.tx,
    y: matrix.b * x + matrix.d * y + matrix.ty,
  }
}

export function invertMatrix(matrix) {
  const determinant = matrix.a * matrix.d - matrix.b * matrix.c
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-8) return null
  return {
    a: matrix.d / determinant,
    b: -matrix.b / determinant,
    c: -matrix.c / determinant,
    d: matrix.a / determinant,
    tx: (matrix.c * matrix.ty - matrix.d * matrix.tx) / determinant,
    ty: (matrix.b * matrix.tx - matrix.a * matrix.ty) / determinant,
  }
}

/**
 * Maps a node's untransformed parent-space rectangle to its own transformed
 * space. Scale and rotation are both about the RectTransform pivot.
 */
export function localRectMatrix(box, transform) {
  const rotation = transform.rotation || { z: transform.localRotationZ }
  const scale = transform.scale || { x: transform.localScaleX, y: transform.localScaleY }
  const pivot = transform.pivot || { x: transform.pivotX, y: transform.pivotY }
  const radians = num(rotation?.z) * Math.PI / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  const scaleX = num(scale?.x, 1)
  const scaleY = num(scale?.y, 1)
  const pivotX = box.left + box.width * num(pivot?.x, 0.5)
  const pivotY = box.bottom + box.height * num(pivot?.y, 0.5)
  const a = cos * scaleX
  const b = sin * scaleX
  const c = -sin * scaleY
  const d = cos * scaleY
  return {
    a,
    b,
    c,
    d,
    tx: pivotX - a * pivotX - c * pivotY,
    ty: pivotY - b * pivotX - d * pivotY,
  }
}

/**
 * Produces a world matrix for one RectTransform. `parentMatrix` is the final
 * transform of its parent; its layout rect remains deliberately unscaled.
 */
export function composeRectMatrix(parentMatrix, box, transform) {
  return multiplyMatrix(parentMatrix || identityMatrix(), localRectMatrix(box, transform))
}

/**
 * Editor-facing dimensions for a transformed rectangle. These retain a
 * center/width/height representation for the DOM editor; the standalone
 * Pixi player consumes the full matrix when nested transforms introduce
 * shear.
 */
export function transformedRectMetrics(box, matrix) {
  const center = applyMatrix(matrix, box.centerX, box.centerY)
  const width = Math.abs(box.width * Math.hypot(matrix.a, matrix.b))
  const height = Math.abs(box.height * Math.hypot(matrix.c, matrix.d))
  return {
    left: center.x - width / 2,
    bottom: center.y - height / 2,
    width,
    height,
    centerX: center.x,
    centerY: center.y,
    rotationZ: Math.atan2(matrix.b, matrix.a) * 180 / Math.PI,
  }
}

export function canvasBox(presetOrId) {
  const preset = typeof presetOrId === 'string' ? getCanvasPreset(presetOrId) : presetOrId
  return {
    left: 0,
    bottom: 0,
    width: preset.width,
    height: preset.height,
    right: preset.width,
    top: preset.height,
    centerX: preset.width / 2,
    centerY: preset.height / 2,
  }
}

/** Inspector display: official "center vs canvas origin" numbers. */
export function inspectorFromRect(box) {
  return {
    posX: box.centerX,
    posY: box.centerY,
    width: box.width,
    height: box.height,
  }
}

/**
 * Invert inspector center/size into offset/sizeDelta, keeping current anchors/pivot.
 */
export function applyInspectorToTransform(parentBox, transform, inspector) {
  const rt = cloneRectTransform(transform)
  const pw = parentBox.width
  const ph = parentBox.height
  const aMinX = rt.anchorMin.x * pw
  const aMinY = rt.anchorMin.y * ph
  const aMaxX = rt.anchorMax.x * pw
  const aMaxY = rt.anchorMax.y * ph
  const width = Number(inspector.width)
  const height = Number(inspector.height)
  const centerX = Number(inspector.posX)
  const centerY = Number(inspector.posY)
  const left = centerX - width / 2
  const bottom = centerY - height / 2
  rt.size = {
    x: width - (aMaxX - aMinX),
    y: height - (aMaxY - aMinY),
  }
  rt.offset = {
    x: left - parentBox.left - aMinX + rt.size.x * rt.pivot.x,
    y: bottom - parentBox.bottom - aMinY + rt.size.y * rt.pivot.y,
  }
  return rt
}

export function setAnchorPreset(transform, preset) {
  const rt = cloneRectTransform(transform)
  const table = {
    'bottom-left': [[0, 0], [0, 0], [0, 0]],
    'bottom': [[0.5, 0], [0.5, 0], [0.5, 0]],
    'bottom-right': [[1, 0], [1, 0], [1, 0]],
    'left': [[0, 0.5], [0, 0.5], [0, 0.5]],
    center: [[0.5, 0.5], [0.5, 0.5], [0.5, 0.5]],
    right: [[1, 0.5], [1, 0.5], [1, 0.5]],
    'top-left': [[0, 1], [0, 1], [0, 1]],
    top: [[0.5, 1], [0.5, 1], [0.5, 1]],
    'top-right': [[1, 1], [1, 1], [1, 1]],
    stretch: [[0, 0], [1, 1], [0.5, 0.5]],
    'stretch-horizontal': [[0, 0.5], [1, 0.5], [0.5, 0.5]],
    'stretch-vertical': [[0.5, 0], [0.5, 1], [0.5, 0.5]],
  }
  const hit = table[preset]
  if (!hit) return rt
  rt.anchorMin = { x: hit[0][0], y: hit[0][1] }
  rt.anchorMax = { x: hit[1][0], y: hit[1][1] }
  rt.pivot = { x: hit[2][0], y: hit[2][1] }
  return rt
}

export function classifyAnchor(transform) {
  const rt = cloneRectTransform(transform)
  const eq = (a, b) => Math.abs(a - b) < 1e-4
  if (eq(rt.anchorMin.x, 0) && eq(rt.anchorMin.y, 0) && eq(rt.anchorMax.x, 1) && eq(rt.anchorMax.y, 1)) {
    return 'stretch'
  }
  if (eq(rt.anchorMin.x, rt.anchorMax.x) && eq(rt.anchorMin.y, rt.anchorMax.y)) {
    const x = rt.anchorMin.x
    const y = rt.anchorMin.y
    const map = [
      [0, 0, 'bottom-left'],
      [0.5, 0, 'bottom'],
      [1, 0, 'bottom-right'],
      [0, 0.5, 'left'],
      [0.5, 0.5, 'center'],
      [1, 0.5, 'right'],
      [0, 1, 'top-left'],
      [0.5, 1, 'top'],
      [1, 1, 'top-right'],
    ]
    for (const row of map) {
      if (eq(x, row[0]) && eq(y, row[1])) return row[2]
    }
  }
  return 'custom'
}

export function platformOfPreset(canvasId) {
  return getCanvasPreset(canvasId).platform
}

export function emptyPlatformMap(factory) {
  const out = {}
  for (const p of PLATFORMS) out[p] = factory(p)
  return out
}
