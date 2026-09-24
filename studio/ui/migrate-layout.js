import { CANVAS_PRESETS, CANONICAL_CANVAS_BY_PLATFORM, LAYOUT_SCHEMA_VERSION, PLATFORMS } from '../constants.js'
import { defaultLayoutForKind, walk } from './authoring.js'
import { cloneRectTransform } from './layout.js'
import { assertPlatformTransforms } from './transforms.js'

// Input boundary only. Runtime code continues to accept exactly four platform slots.
export function migrateLayout(seed, warnings = []) {
  if (!seed || seed.layoutSchemaVersion === LAYOUT_SCHEMA_VERSION) return seed
  if (seed.layoutSchemaVersion !== undefined && seed.layoutSchemaVersion !== 1) {
    throw new Error(`仅支持 layoutSchemaVersion=2 或可迁移的旧布局，收到 ${seed.layoutSchemaVersion}`)
  }
  if (!seed.root) return { ...seed, layoutSchemaVersion: LAYOUT_SCHEMA_VERSION }
  const result = structuredClone(seed)
  let count = 0
  walk(result.root, node => {
    const platforms = node.transformByPlatform || {}
    const canvases = node.transformByCanvas || {}
    const name = node.name || node.id
    for (const key of Object.keys(platforms)) {
      if (!PLATFORMS.includes(key)) throw new Error(`${name}: unknown platform ${key}`)
    }
    const resolved = {}
    for (const platform of PLATFORMS) {
      const canonical = CANONICAL_CANVAS_BY_PLATFORM[platform]
      const family = CANVAS_PRESETS[canonical].platform
      const available = Object.keys(CANVAS_PRESETS).filter(id => CANVAS_PRESETS[id].platform === family && canvases[id])
      const canvasId = canvases[canonical] ? canonical : available[0]
      const inherited = platform === 'CONTROLLER_CONSOLE' ? resolved.KEYBOARD
        : platform === 'CONTROLLER_MOBILE' ? resolved.TOUCHSCREEN : null
      const source = platforms[platform] ?? inherited ?? (canvasId ? canvases[canvasId] : null)
      resolved[platform] = source ? cloneRectTransform(source) : defaultLayoutForKind(node.kind)
      if (!source) warnings.push(`${name}: ${platform} 无旧布局，已使用控件默认值`)
      if (!platforms[platform] && !inherited && canvasId && canvasId !== canonical) {
        warnings.push(`${name}: 缺少 ${canonical}，已采用 ${canvasId} 的锚点和尺寸参数`)
      }
      if (!inherited) {
        for (const id of available) {
          if (JSON.stringify(resolved[platform]) !== JSON.stringify(cloneRectTransform(canvases[id]))) {
            warnings.push(`${name}: ${id} 与 ${platform} 布局冲突，保留${platforms[platform] ? '已有平台' : canvasId}参数`)
          }
        }
      }
    }
    assertPlatformTransforms(resolved, `${name}.transformByPlatform`)
    node.transformByPlatform = resolved
    delete node.transformByCanvas
    count++
  })
  result.layoutSchemaVersion = LAYOUT_SCHEMA_VERSION
  warnings.unshift(`已自动迁移旧布局：${count} 个控件转换为四平台参数；再次保存将使用新版格式`)
  return result
}

export function assertSaveVersion(version) {
  if (![1, 2, 3, 4].includes(version)) throw new Error(`仅支持 version=1–4 的存档，收到 ${version}`)
}
