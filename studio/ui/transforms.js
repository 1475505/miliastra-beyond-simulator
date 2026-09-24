import { PLATFORMS } from '../constants.js'
import { cloneRectTransform } from './layout.js'

const COMPONENTS = {
  scale: ['x', 'y', 'z'], rotation: ['x', 'y', 'z'],
  anchorMin: ['x', 'y'], anchorMax: ['x', 'y'],
  offset: ['x', 'y'], size: ['x', 'y'], pivot: ['x', 'y'],
}

function assertTransform(rt, path) {
  for (const [field, axes] of Object.entries(COMPONENTS)) {
    for (const axis of axes) {
      if (!Number.isFinite(rt?.[field]?.[axis])) {
        throw new Error(`${path}.${field}.${axis} must be a finite number`)
      }
    }
  }
}

export function assertPlatformTransforms(map, path = 'transformByPlatform') {
  if (!map || typeof map !== 'object' || Array.isArray(map)) {
    throw new Error(`${path}: 需要完整的四平台布局`)
  }
  for (const key of Object.keys(map)) {
    if (!PLATFORMS.includes(key)) throw new Error(`${path}: unknown platform ${key}`)
  }
  for (const platform of PLATFORMS) assertTransform(map[platform], `${path}.${platform}`)
}

export function assertPlatformNode(node) {
  if (Object.hasOwn(node, 'transformByCanvas')) {
    throw new Error(`${node.name || node.id || '控件'}: 不再支持 transformByCanvas；请使用四平台 transformByPlatform 布局`)
  }
  assertPlatformTransforms(node.transformByPlatform, `${node.name || node.id || '控件'}.transformByPlatform`)
}

/** Copy on read: callers cannot mutate authoring data through derived layouts. */
export function getPlatformTransform(map, platform) {
  if (!PLATFORMS.includes(platform)) throw new Error(`unknown platform ${platform}`)
  assertTransform(map?.[platform], `transformByPlatform.${platform}`)
  return cloneRectTransform(map[platform])
}
