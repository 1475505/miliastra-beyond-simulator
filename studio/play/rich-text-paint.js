import { DEFAULT_FONT } from '../fonts.js'
import { richFont } from './rich-text.js'

function cssColor(value) {
  const color = Number(value) >>> 0
  return `rgba(${color >>> 16 & 255},${color >>> 8 & 255},${color & 255},${(color >>> 24) / 255})`
}

// Shared by PNG, editor Canvas and Pixi's owned CanvasSource. Coordinates are
// local/top-left; the caller applies the control's transform after layout.
export function drawRichText(ctx, item, width, height, family = DEFAULT_FONT) {
  const layout = item.textLayout
  if (!layout?.richLines || width <= 0 || height <= 0) return
  const horizontal = item.horizontalAlignment === 'Right' ? 1 : item.horizontalAlignment === 'Middle' ? 0.5 : 0
  const vertical = item.verticalAlignment === 'Bottom' ? 1 : item.verticalAlignment === 'Middle' ? 0.5 : 0
  const scroll = item.kind === 'textwindow' ? item.scroll : null
  const count = layout.visibleLineCount ?? layout.richLines.length
  const contentHeight = layout.visibleContentHeight ?? layout.contentHeight
  const top = item.kind === 'textwindow' && layout.contentHeight > height
    ? -(scroll?.offset || 0) : vertical * (height - contentHeight)
  ctx.save()
  ctx.beginPath(); ctx.rect(0, 0, width, height); ctx.clip()
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.lineJoin = 'round'
  ctx.strokeStyle = cssColor(item.outlineColor ?? 0xff000000)
  for (let i = 0; i < count; i++) {
    const line = layout.richLines[i]
    const y = top + line.top
    if (y + line.height < 0 || y > height) continue
    const left = 2 + horizontal * (layout.textWidth - line.width)
    for (const run of line.runs) {
      ctx.font = richFont(run, family || DEFAULT_FONT)
      ctx.fillStyle = cssColor(run.color ?? item.fontColor ?? 0xffffffff)
      if (item.enableOutline) {
        ctx.lineWidth = Math.max(2, run.fontSize * 0.12)
        ctx.strokeText(run.text, left + run.x, y + line.baseline)
      }
      ctx.fillText(run.text, left + run.x, y + line.baseline)
    }
  }
  ctx.restore()
}

export function paintRichTextCanvas(canvas, item, width, height, family, resolution = 1) {
  // Only the viewport is rasterized. Huge scroll content/tag sizes cannot
  // allocate a content-sized GPU texture; normal controls retain device DPI.
  const scale = Math.min(Math.max(1, resolution), 4096 / Math.max(1, width, height))
  const w = Math.max(1, Math.ceil(width * scale)), h = Math.max(1, Math.ceil(height * scale))
  if (canvas.width !== w) canvas.width = w
  if (canvas.height !== h) canvas.height = h
  const ctx = canvas.getContext('2d')
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, w, h)
  ctx.save()
  ctx.scale(w / (width > 0 ? width : 1), h / (height > 0 ? height : 1))
  drawRichText(ctx, item, width, height, family)
  ctx.restore()
}
