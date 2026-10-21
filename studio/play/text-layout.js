import { createCanvas } from '@napi-rs/canvas'
import { localFontStack } from '../host/local-font.js'
import { parseRichText, richFont } from './rich-text.js'

const context = createCanvas(1, 1).getContext('2d')
const layouts = new WeakMap()

const positiveSize = (value, fallback) => Math.max(1, Math.trunc(Number.isFinite(Number(value)) ? Number(value) : fallback))

function wrapRich(parsed, fontSize, textWidth, family, kind, height) {
  const richLines = []
  let runs = [], width = 0, emptySize = fontSize, top = 0
  const finish = () => {
    const size = runs.length ? runs.reduce((max, run) => Math.max(max, run.fontSize), 0) : emptySize
    const lineHeight = size * 1.2
    // A common alphabetic baseline keeps mixed sizes aligned. Font em metrics
    // are used instead of individual glyph ink bounds ("A" vs "g").
    const ascent = runs.length ? runs.reduce((max, run) => Math.max(max, run.ascent), 0) : size * 0.8
    const descent = runs.length ? runs.reduce((max, run) => Math.max(max, run.descent), 0) : size * 0.2
    const baseline = (lineHeight - ascent - descent) / 2 + ascent
    richLines.push({ runs, width, top, height: lineHeight, baseline, fontSize: size })
    top += lineHeight
    runs = []; width = 0
  }
  for (const source of parsed.runs) {
    // Explicit <size> remains absolute during autosizing; only untagged text
    // uses the candidate base size. This is a simulator fitting policy.
    const style = { fontSize: source.size ?? fontSize, bold: source.bold, italic: source.italic, color: source.color }
    context.font = richFont(style, family)
    const metrics = context.measureText('Mg')
    const ascent = metrics.fontBoundingBoxAscent ?? metrics.emHeightAscent ?? style.fontSize * 0.8
    const descent = metrics.fontBoundingBoxDescent ?? metrics.emHeightDescent ?? style.fontSize * 0.2
    emptySize = style.fontSize
    for (const char of source.text) {
      if (char === '\n') { finish(); continue }
      let previous = runs.at(-1)
      const same = previous && ['fontSize', 'bold', 'italic', 'color'].every(key => previous[key] === style[key])
      let measured = context.measureText((same ? previous.text : '') + char).width
      let nextWidth = width + measured - (same ? previous.width : 0)
      if (runs.length && nextWidth > textWidth) {
        finish(); previous = null
        measured = context.measureText(char).width
        nextWidth = measured
      }
      if (previous && same) { previous.text += char; previous.width = measured }
      else runs.push({ text: char, ...style, x: width, width: measured, ascent, descent })
      width = nextWidth
    }
  }
  finish()
  const lines = richLines.map(line => line.runs.map(run => run.text).join(''))
  const largest = richLines.reduce((max, line) => Math.max(max, line.fontSize), 0)
  const blockInset = kind === 'textbox' && parsed.text ? largest * 0.25 + 4 : 0
  const requiredHeight = parsed.text ? top + blockInset : 0
  return { fontSize, lines, lineHeight: fontSize * 1.2, contentHeight: top, blockInset, requiredHeight, textWidth,
    fits: requiredHeight <= height + 1e-6 && richLines.every(line => line.width <= textWidth + 1e-6), richLines }
}

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
  const parsed = parseRichText(text)

  const wrap = (fontSize, textWidth) => {
    if (parsed.rich) return wrapRich(parsed, fontSize, textWidth, family, item.kind, height)
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
  // #19's reported textbox rule also governs drawing, not only autosizing:
  // keep the longest prefix of complete lines that fits with the block inset.
  // Retain full metrics for fitting/inspection; scroll windows still clip their
  // full content continuously. Rich lines use their measured individual heights
  // and the existing largest-size inset (a simulator extension of that rule).
  let visibleLineCount = value.lines.length, visibleContentHeight = value.contentHeight
  if (item.kind === 'textbox') {
    visibleLineCount = 0
    visibleContentHeight = 0
    if (value.lines.join('\n')) for (let i = 0; i < value.lines.length; i++) {
      const line = value.richLines?.[i]
      const bottom = line ? line.top + line.height : (i + 1) * value.lineHeight
      if (bottom + value.blockInset > height + 1e-6) break
      visibleLineCount = i + 1
      visibleContentHeight = bottom
    }
  }
  value = { ...value, visibleLineCount, visibleContentHeight }
  layouts.set(item, { key, value })
  return value
}
