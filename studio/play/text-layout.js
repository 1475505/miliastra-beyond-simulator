import { createCanvas } from '@napi-rs/canvas'
import { localFontStack } from '../host/local-font.js'

const context = createCanvas(1, 1).getContext('2d')
const layouts = new WeakMap()

const positiveSize = (value, fallback) => Math.max(1, Math.trunc(Number.isFinite(Number(value)) ? Number(value) : fallback))

// Accepted #19 measurement model: 1.2 line spacing plus 0.25*size + 4
// block occupancy for textboxes only. This is not a universal font ink bound.
// Choose the largest integer size within [minimumFontSize, fontSize] that fits.
// Measure in local UI units before any scale/rotation; never mutate Lua fields.
export function textLayout(item, width, height) {
  const text = String(item.text ?? '').replace(/\r\n?/g, '\n')
  const maximum = positiveSize(item.fontSize, 20)
  const minimum = Math.min(maximum, positiveSize(item.minimumFontSize, 10))
  const adaptive = item.adaptiveFontSize === true
  const family = localFontStack()
  const key = JSON.stringify([text, width, height, maximum, minimum, adaptive, item.kind, item.showScrollBar, family])
  const cached = layouts.get(item)
  if (cached?.key === key) return cached.value

  const wrap = (fontSize, textWidth) => {
    context.font = `${fontSize}px ${family}`
    const lines = []
    for (const paragraph of text.split('\n')) {
      let line = ''
      for (const char of paragraph) {
        if (line && context.measureText(line + char).width > textWidth) {
          lines.push(line)
          line = ''
        }
        line += char
      }
      lines.push(line)
    }
    const lineHeight = fontSize * 1.2
    const contentHeight = lines.length * lineHeight
    const blockInset = item.kind === 'textbox' && text ? fontSize * 0.25 + 4 : 0
    const requiredHeight = text ? contentHeight + blockInset : 0
    const fits = requiredHeight <= height + 1e-6 && lines.every(line => context.measureText(line).width <= textWidth + 1e-6)
    return { fontSize, lines, lineHeight, contentHeight, blockInset, requiredHeight, textWidth, fits }
  }
  const available = Math.max(0, width - 4)
  let value = wrap(maximum, available)
  if (adaptive && !value.fits && minimum < maximum) {
    value = wrap(minimum, available)
    let low = minimum + 1, high = maximum - 1
    while (low <= high) {
      const size = Math.floor((low + high) / 2)
      const candidate = wrap(size, available)
      if (candidate.fits) { value = candidate; low = size + 1 }
      else high = size - 1
    }
  }
  // If even the minimum overflows a text window, keep its existing scrolling
  // behavior and reserve the scrollbar width before the final wrap.
  if (item.kind === 'textwindow' && item.showScrollBar !== false && value.contentHeight > height) {
    value = wrap(value.fontSize, Math.max(0, available - 12))
  }
  layouts.set(item, { key, value })
  return value
}
