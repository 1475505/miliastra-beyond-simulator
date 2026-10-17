import { textLayout } from './text-layout.js'

export const clamp = (value, max) => Math.max(0, Math.min(max, Number.isFinite(value) ? value : 0))

// Host-side measurement is authoritative for both PNG and browser wrapping.
// A cache belongs to the control, so it disappears together with that control.
export function textWindowMetrics(control, width, height) {
  const layout = textLayout(control, width, height)
  const max = Math.max(0, layout.contentHeight - height)
  const offset = clamp(control._scrollOffset || 0, max)
  control._scrollOffset = offset
  return { ...layout, length: layout.contentHeight, max, offset, viewport: height, horizontal: false, width, height }
}
