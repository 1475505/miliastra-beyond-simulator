import { createCanvas } from '@napi-rs/canvas'

const context = createCanvas(1, 1).getContext('2d')
const FONT = '"Microsoft YaHei UI","Microsoft YaHei",sans-serif'
export const clamp = (value, max) => Math.max(0, Math.min(max, Number.isFinite(value) ? value : 0))

// Host-side measurement is authoritative for both PNG and browser wrapping.
// A cache belongs to the control, so it disappears together with that control.
export function textWindowMetrics(control, width, height) {
  const font = Math.max(8, Number(control.fontSize) || 12)
  const text = String(control.text ?? '').replace(/\r\n?/g, '\n')
  const key = JSON.stringify([text, width, height, font, control.showScrollBar])
  let cache = control._textWindowLayout
  if (cache?.key !== key) {
    context.font = `${font}px ${FONT}`
    const wrap = (available) => {
      const lines = []
      for (const paragraph of text.split('\n')) {
        let line = ''
        for (const char of paragraph) {
          if (line && context.measureText(line + char).width > available) { lines.push(line); line = '' }
          line += char
        }
        lines.push(line)
      }
      return lines
    }
    let lines = wrap(Math.max(1, width - 4))
    const bar = control.showScrollBar !== false && lines.length * font * 1.2 > height
    const textWidth = Math.max(1, width - 4 - (bar ? 12 : 0))
    if (bar) lines = wrap(textWidth)
    cache = control._textWindowLayout = { key, lines, font, textWidth, lineHeight: font * 1.2, length: lines.length * font * 1.2 }
  }
  const max = Math.max(0, cache.length - height)
  const offset = clamp(control._scrollOffset || 0, max)
  control._scrollOffset = offset
  return { ...cache, max, offset, viewport: height, horizontal: false, width, height }
}
