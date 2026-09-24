/**
 * Four platform transforms are authoritative. Canvases are viewports only.
 * Projection happens once per explicit edit, never while reading a preview.
 */

import {
  CANONICAL_CANVAS_BY_PLATFORM,
  PLATFORMS,
} from '../constants.js'
import {
  applyInspectorToTransform,
  canvasBox,
  cloneRectTransform,
  computeRect,
  platformOfPreset,
} from './layout.js'
import { assertPlatformTransforms, getPlatformTransform } from './transforms.js'

const EPS = 1e-4

function isStretchAxis(transform, axis) {
  return Math.abs(transform.anchorMax[axis] - transform.anchorMin[axis]) > EPS
    && Math.abs(transform.size[axis]) <= EPS
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

export function syncPlatformTransforms({
  transformByPlatform,
  source,
  canvasId,
  syncAllDevices,
  sourceParentBox = canvasBox(canvasId),
  targetParentBoxByPlatform = {},
}) {
  assertPlatformTransforms(transformByPlatform)
  const sourcePlatform = platformOfPreset(canvasId)
  const platformMap = {}
  for (const platform of PLATFORMS) {
    if (platform === sourcePlatform) {
      // Keep edits made in a wide/tall viewport at their entered position.
      platformMap[platform] = cloneRectTransform(source)
    } else if (syncAllDevices !== false) {
      platformMap[platform] = projectRectTransform(
        source,
        sourceParentBox,
        targetParentBoxByPlatform[platform] || canvasBox(CANONICAL_CANVAS_BY_PLATFORM[platform]),
      )
    } else {
      platformMap[platform] = getPlatformTransform(transformByPlatform, platform)
    }
  }
  assertPlatformTransforms(platformMap)
  return platformMap
}

export function readCurrentTransform(transformByPlatform, canvasId) {
  return getPlatformTransform(transformByPlatform, platformOfPreset(canvasId))
}
