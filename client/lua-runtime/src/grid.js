// Basic simulator policy, not device fidelity: zero-based items, row-major
// vertical / column-major horizontal, progress 0=start and 1=end. Static children
// are not list items. Keep this module independent of Studio and renderers.
const number = (v, fallback = 0) => Number.isFinite(Number(v)) ? Number(v) : fallback
const name = (v) => v?.Name || v
export const clampProgress = (v) => Math.max(0, Math.min(1, number(v)))

export function controlSize(control) {
  const parent = control.parent ? controlSize(control.parent) : [control.runtime.canvasWidth, control.runtime.canvasHeight]
  return [
    Math.max(0, (control.anchorMaxX - control.anchorMinX) * parent[0] + number(control.sizeDeltaX)),
    Math.max(0, (control.anchorMaxY - control.anchorMinY) * parent[1] + number(control.sizeDeltaY)),
  ]
}

export function gridMetrics(control) {
  const [width, height] = controlSize(control)
  const horizontal = name(control.scrollDirection) === 'Horizontal'
  const cellW = Math.max(1, number(control.cellSizeX, 50)), cellH = Math.max(1, number(control.cellSizeY, 50))
  const gapX = Math.max(0, number(control.spacingX)), gapY = Math.max(0, number(control.spacingY))
  // Authoring vectors have no proven side mapping. This is explicitly a policy.
  const left = Math.max(0, number(control.padding1X)), top = Math.max(0, number(control.padding1Y))
  const right = Math.max(0, number(control.padding2X)), bottom = Math.max(0, number(control.padding2Y))
  const cross = horizontal ? height - top - bottom : width - left - right
  const cell = horizontal ? cellH : cellW, gap = horizontal ? gapY : gapX
  const lanes = name(control.layoutConstraint) === 'Fixed'
    ? Math.max(1, Math.floor(number(control.layoutConstraintFixedCount, 1)))
    : Math.max(1, Math.floor((cross + gap) / (cell + gap)))
  const bands = Math.ceil(control.itemCount / lanes)
  const length = bands ? (horizontal ? left + right + bands * cellW + (bands - 1) * gapX : top + bottom + bands * cellH + (bands - 1) * gapY) : 0
  const viewport = horizontal ? width : height
  const max = Math.max(0, length - viewport)
  return { width, height, horizontal, cellW, cellH, gapX, gapY, left, top, right, bottom, lanes, length, viewport, max, offset: clampProgress(control.scrollProgress) * max }
}

export function layoutGrid(control) {
  const m = gridMetrics(control)
  for (let index = 0; index < (control._gridItems?.length || 0); index += 1) {
    const item = control._gridItems[index]
    if (!item.alive || item.parent !== control) continue
    const band = Math.floor(index / m.lanes), lane = index % m.lanes
    const col = m.horizontal ? band : lane, row = m.horizontal ? lane : band
    const x = m.left + col * (m.cellW + m.gapX) + m.cellW / 2 - (m.horizontal ? m.offset : 0)
    const y = -m.top - row * (m.cellH + m.gapY) - m.cellH / 2 + (m.horizontal ? 0 : m.offset)
    const fields = { anchorMinX: 0, anchorMaxX: 0, anchorMinY: 1, anchorMaxY: 1, pivotX: 0.5, pivotY: 0.5, sizeDeltaX: m.cellW, sizeDeltaY: m.cellH, anchoredPositionX: x, anchoredPositionY: y }
    if (Object.entries(fields).some(([key, value]) => item[key] !== value)) {
      Object.assign(item, fields)
      item.markPlayDirty(true)
    }
  }
  return m
}
