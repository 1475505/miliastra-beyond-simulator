/**
 * Device synchronization keeps an exact RectTransform per preview canvas.
 * GIA's four platform slots are derived from canonical preview canvases.
 */

import {
  CANONICAL_CANVAS_BY_PLATFORM,
  CANVAS_PRESETS,
  PLATFORMS,
} from '../constants.js'
import {
  applyInspectorToTransform,
  canvasBox,
  cloneRectTransform,
  computeRect,
  platformOfPreset,
} from './layout.js'

const EPS = 1e-4

function isStretchAxis(transform, axis) {
  return Math.abs(transform.anchorMax[axis] - transform.anchorMin[axis]) > EPS
    && Math.abs(transform.size[axis]) <= EPS
}

function clonePlatformMap(transformByPlatform, fallback) {
  const out = {}
  for (const platform of PLATFORMS) {
    out[platform] = cloneRectTransform(transformByPlatform?.[platform] || fallback)
  }
  return out
}

function cloneCanvasMap(transformByCanvas, transformByPlatform, fallback) {
  const out = {}
  for (const [canvasId, preset] of Object.entries(CANVAS_PRESETS)) {
    out[canvasId] = cloneRectTransform(
      transformByCanvas?.[canvasId]
      || transformByPlatform?.[preset.platform]
      || fallback,
    )
  }
  return out
}

/** Project the edited visual center by parent ratio while preserving pixel size. */
export function projectRectTransform(source, sourceParentBox, targetParentBox) {
  if (!(sourceParentBox.width > 0) || !(sourceParentBox.height > 0)) {
    throw new Error('source parent must have positive size')
  }
  if (!(targetParentBox.width > 0) || !(targetParentBox.height > 0)) {
    throw new Error('target parent must have positive size')
  }
  const sourceRect = computeRect(sourceParentBox, source)
  const nx = (sourceRect.centerX - sourceParentBox.left) / sourceParentBox.width
  const ny = (sourceRect.centerY - sourceParentBox.bottom) / sourceParentBox.height
  const projected = applyInspectorToTransform(targetParentBox, source, {
    posX: targetParentBox.left + nx * targetParentBox.width,
    posY: targetParentBox.bottom + ny * targetParentBox.height,
    width: sourceRect.width,
    height: sourceRect.height,
  })
  // A zero sizeDelta on a spanning-anchor axis is a fluid stretch, not a
  // fixed source-canvas pixel size.  Keep that axis unchanged so the target
  // RectTransform continues to fill its target parent.
  for (const axis of ['x', 'y']) {
    if (isStretchAxis(source, axis)) {
      projected.offset[axis] = source.offset[axis]
      projected.size[axis] = source.size[axis]
    }
  }
  return projected
}

export function syncTransformMaps({
  transformByPlatform,
  transformByCanvas,
  source,
  canvasId,
  syncAllDevices,
  sourceParentBox = canvasBox(canvasId),
  targetParentBoxByCanvas = {},
}) {
  const platformMap = clonePlatformMap(transformByPlatform, source)
  const canvasMap = cloneCanvasMap(transformByCanvas, transformByPlatform, source)
  canvasMap[canvasId] = cloneRectTransform(source)

  if (syncAllDevices !== false) {
    for (const targetCanvasId of Object.keys(CANVAS_PRESETS)) {
      if (targetCanvasId === canvasId) continue
      canvasMap[targetCanvasId] = projectRectTransform(
        source,
        sourceParentBox,
        targetParentBoxByCanvas[targetCanvasId] || canvasBox(targetCanvasId),
      )
    }
    for (const platform of PLATFORMS) {
      platformMap[platform] = cloneRectTransform(canvasMap[CANONICAL_CANVAS_BY_PLATFORM[platform]])
    }
  } else {
    platformMap[platformOfPreset(canvasId)] = cloneRectTransform(source)
  }

  return { transformByPlatform: platformMap, transformByCanvas: canvasMap }
}

/** Backwards-compatible platform-only helper used by older callers. */
export function applySyncPolicy(args) {
  return syncTransformMaps(args).transformByPlatform
}

export function readCurrentTransform(transformByPlatform, canvasId, transformByCanvas) {
  const slot = platformOfPreset(canvasId)
  const src = transformByCanvas?.[canvasId]
    || transformByPlatform?.[slot]
    || transformByPlatform?.KEYBOARD
    || null
  return cloneRectTransform(src)
}
