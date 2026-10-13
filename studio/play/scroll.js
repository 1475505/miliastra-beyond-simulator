import { createCanvas } from '@napi-rs/canvas'

const context = createCanvas(1, 1).getContext('2d')
const FONT = '"Microsoft YaHei UI","Microsoft YaHei",sans-serif'
export const clamp = (value, max) => Math.max(0, Math.min(max, Number.isFinite(value) ? value : 0))

/**
 * 字号自适应（真机文本框的「字号自适应」开关）：
 * 在 [minSize, maxSize] 之内挑「能塞进框 (width, height) 的最大整数字号」。
 *   * 文本按 '\n' 分行，行宽按 measure(text, size) 逐个累加；
 *   * 整块高度按 `行数 × 字号 × 1.2` 计（与 textWindowMetrics 的行高口径一致）；
 *   * 真机口径「最小字号不能大于字号」——调用方需保证 minSize ≤ maxSize；
 *   * 连最小字号都塞不下时返回 minSize（真机此刻就按最小字号渲染，超出部分裁剪，
 *     不会把文字缩没）。
 * `measure(text, size)` 返回该文本在指定字号下的宽度（宿主用本机字体度量）。
 */
export function fitFontSize(text, { maxSize, minSize, width, height, measure, lineHeightRatio = 1.2 }) {
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n')
  const fits = (size) => {
    if (lines.length * size * lineHeightRatio > height) return false
    for (const line of lines) if (measure(line, size) > width) return false
    return true
  }
  const lo = Math.max(1, Math.min(minSize, maxSize))
  for (let size = Math.max(lo, Math.floor(maxSize)); size > lo; size -= 1) {
    if (fits(size)) return size
  }
  return lo
}

/**
 * 文本框按当前框尺寸换算出的实际渲染字号。
 *   * 未开启「字号自适应」时原样返回字号（下限仍是 8，与旧行为一致）；
 *   * 开启时下限 = min(最小字号, 字号)，对应真机「最小字号不能大于字号」；
 *   * 度量使用宿主本机字体，与 PNG / 浏览器换行共用同一套度量。
 */
export function adaptiveFontSize(control, width, height) {
  const maxSize = Math.max(8, Number(control.fontSize) || 12)
  if (control.adaptiveFontSize !== true) return maxSize
  const rawMin = Number(control.minimumFontSize)
  const minSize = Math.min(Number.isFinite(rawMin) && rawMin > 0 ? rawMin : maxSize, maxSize)
  return fitFontSize(control.text, {
    maxSize,
    minSize,
    width,
    height,
    measure: (text, size) => {
      context.font = `${size}px ${FONT}`
      return context.measureText(text).width
    },
  })
}

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
