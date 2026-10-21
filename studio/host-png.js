import { createRequire } from 'node:module'
import { imageFillRect } from './play/image-fill.js'
import { imageMaskSpec, imageMaskCoverage, groupMaskedPaint } from './play/image-mask.js'
import { applyMatrix, invertMatrix } from './ui/layout.js'
import { tintedImage } from './assets/raster.js'
import { rasterizeSlices, resolveImageType } from './assets/image-stretch.js'
import { imageAssetKey } from './assets/catalog.js'
import { scrollBarGeometry } from './play/scroll-geometry.js'
import { localFontStack } from './host/local-font.js'
import { textLayout } from './play/text-layout.js'
import { drawRichText } from './play/rich-text-paint.js'

const require = createRequire(import.meta.url)

const TRI_POINTS = [0, -0.5, 0.5, 0.5, -0.5, 0.5]
const STAR4_POINTS = [0, -0.5, 0.12, -0.12, 0.5, 0, 0.12, 0.12, 0, 0.5, -0.12, 0.12, -0.5, 0, -0.12, -0.12]
const STAR5_POINTS = [0, -0.5, 0.11, -0.15, 0.48, -0.15, 0.18, 0.07, 0.29, 0.41, 0, 0.2, -0.29, 0.41, -0.18, 0.07, -0.48, -0.15, -0.11, -0.15]
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const SCENE_PAINT_KINDS = new Set(['image', 'textbox', 'textwindow', 'button', 'grid'])
const KIND_LABEL = {
  cursor: '光标检测区域',
  reference: '模板引用控件',
  grid: '网格视窗',
  button: '预设按钮',
  keyhint: '按键提示',
  animation: '界面动效',
  fullscreen: '全屏动效',
}

let canvasModule = null

function loadCanvas() {
  if (canvasModule) return canvasModule
  try {
    canvasModule = require('@napi-rs/canvas')
  } catch (error) {
    const reason = error?.message || String(error)
    throw new Error(`Host screenshot renderer requires @napi-rs/canvas (${reason})`)
  }
  return canvasModule
}

function finite(value, fallback = 0) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function argb(value, fallback = 0xffffffff) {
  const raw = Number(value == null ? fallback : value) >>> 0
  return {
    r: (raw >>> 16) & 255,
    g: (raw >>> 8) & 255,
    b: raw & 255,
    a: ((raw >>> 24) & 255) / 255,
  }
}

function cssColor(color, alphaScale = 1) {
  return `rgba(${color.r},${color.g},${color.b},${Math.max(0, Math.min(1, color.a * alphaScale))})`
}

function canvasSize(width, height, scale = 1) {
  const w = Math.max(1, Math.round(finite(width, 1)))
  const h = Math.max(1, Math.round(finite(height, 1)))
  const pixelRatio = Math.max(1, Math.min(2, finite(scale, 1)))
  return {
    width: w,
    height: h,
    pixelWidth: Math.max(1, Math.round(w * pixelRatio)),
    pixelHeight: Math.max(1, Math.round(h * pixelRatio)),
    pixelRatio,
  }
}

function toPng(canvas) {
  const png = Buffer.from(canvas.toBuffer('image/png'))
  if (png.length < PNG_SIGNATURE.length || !png.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    throw new Error('Host screenshot renderer did not produce a PNG')
  }
  return png
}

function templatePoints(kind) {
  if (kind === 'triangle') return TRI_POINTS
  if (kind === 'fourstar') return STAR4_POINTS
  return STAR5_POINTS
}

function fillPoly(ctx, kind, width, height, color) {
  const template = templatePoints(kind)
  ctx.beginPath()
  for (let i = 0; i < template.length; i += 2) {
    const x = template[i] * width
    const y = template[i + 1] * height
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.closePath()
  ctx.fillStyle = cssColor(color)
  ctx.fill()
}

function applyItemTransform(ctx, item, canvasHeight) {
  const matrix = item?.matrix
  const values = matrix && typeof matrix === 'object'
    ? [matrix.a, matrix.b, matrix.c, matrix.d, matrix.tx, matrix.ty].map(Number)
    : null
  const pressedScale = item?.pressed ? 0.98 : 1
  if (values && values.every(Number.isFinite)) {
    const [a, b, c, d, tx, ty] = values
    // Multiply onto the current scale (device pixel ratio); do not replace it.
    ctx.transform(a * pressedScale, -b * pressedScale, -c * pressedScale, d * pressedScale, tx, canvasHeight - ty)
    return
  }
  ctx.translate(finite(item.left) + finite(item.width) / 2, canvasHeight - finite(item.bottom) - finite(item.height) / 2)
  ctx.rotate(-finite(item.rotationZ) * Math.PI / 180)
  ctx.scale(pressedScale, pressedScale)
}

function roundRectPath(ctx, x, y, width, height, radius) {
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(x, y, width, height, radius)
    return
  }
  const r = Math.max(0, Math.min(radius, width / 2, height / 2))
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + width, y, x + width, y + height, r)
  ctx.arcTo(x + width, y + height, x, y + height, r)
  ctx.arcTo(x, y + height, x, y, r)
  ctx.arcTo(x, y, x + width, y, r)
  ctx.closePath()
}

function drawTextItem(ctx, item, width, height) {
  const bg = argb(item.bgColor, 0x00ffffff)
  ctx.fillStyle = cssColor(bg)
  ctx.fillRect(-width / 2, -height / 2, width, height)
  const layout = item.textLayout || textLayout(item, width, height)
  if (layout.richLines) {
    ctx.save()
    ctx.translate(-width / 2, -height / 2)
    drawRichText(ctx, { ...item, textLayout: layout }, width, height, localFontStack())
    ctx.restore()
    return
  }
  const font = layout.fontSize
  const color = argb(item.fontColor, 0xffffffff)
  const horizontal = item.horizontalAlignment === 'Right' ? 1 : item.horizontalAlignment === 'Middle' ? 0.5 : 0
  const vertical = item.verticalAlignment === 'Bottom' ? 1 : item.verticalAlignment === 'Middle' ? 0.5 : 0
  ctx.save()
  ctx.beginPath()
  ctx.rect(-width / 2, -height / 2, width, height)
  ctx.clip()
  ctx.font = `${font}px ${localFontStack()}`
  ctx.fillStyle = cssColor(color)
  ctx.textAlign = horizontal === 1 ? 'right' : horizontal === 0.5 ? 'center' : 'left'
  const scroll = item.kind === 'textwindow' ? item.scroll : null
  ctx.textBaseline = scroll ? 'top' : vertical === 1 ? 'bottom' : vertical === 0.5 ? 'middle' : 'top'
  if (item.enableOutline) {
    const outline = argb(item.outlineColor, 0xff000000)
    ctx.strokeStyle = cssColor(outline)
    ctx.lineWidth = Math.max(2, font * 0.12)
    ctx.lineJoin = 'round'
  }
  const x = scroll ? -width / 2 + 2 + horizontal * scroll.textWidth : horizontal === 0 ? -width / 2 + 2 : horizontal === 1 ? width / 2 - 2 : 0
  const y = vertical === 0 ? -height / 2 : vertical === 1 ? height / 2 : 0
  const lines = scroll?.lines || layout.lines.slice(0, layout.visibleLineCount ?? layout.lines.length)
  const lineHeight = scroll?.lineHeight || layout.lineHeight
  const startY = scroll ? -height / 2 - scroll.offset + (scroll.max > 0 ? 0 : vertical * (height - scroll.contentLength))
    : vertical === 0.5 ? y - (lines.length - 1) * lineHeight / 2 : vertical === 1 ? y - (lines.length - 1) * lineHeight : y
  for (let i = 0; i < lines.length; i += 1) {
    const lineY = startY + i * lineHeight
    if (scroll && (lineY + lineHeight < -height / 2 || lineY > height / 2)) continue
    if (item.enableOutline) ctx.strokeText(lines[i], x, lineY)
    ctx.fillText(lines[i], x, lineY)
  }
  ctx.restore()
}

function drawScrollBar(ctx, item, width, height) {
  const bar = scrollBarGeometry(item.scroll, width, height)
  if (!bar) return
  for (const [rect, color] of [[bar.track, '#263447'], [bar.thumb, '#90aecb']]) {
    ctx.fillStyle = color
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height)
  }
}

function drawButtonItem(ctx, item, width, height) {
  ctx.beginPath()
  roundRectPath(ctx, -width / 2, -height / 2, width, height, 6)
  ctx.fillStyle = '#3268cf'
  ctx.fill()
  ctx.strokeStyle = 'rgba(112,160,255,0.8)'
  ctx.lineWidth = 1
  ctx.stroke()
  if (item.pressed) {
    ctx.fillStyle = 'rgba(0,0,0,0.28)'
    ctx.fill()
  }
}

function drawPrimitive(ctx, item, width, height, assets) {
  const color = argb(item.imageColor, 0xffffffff)
  const assetKey = imageAssetKey(item.imageId, item.imageSource)
  const image = assets?.images?.get(assetKey)
  if (item.primitive === 'sprite' && image) {
    const meta = assets.imageMetadata?.get(assetKey)
    const type = resolveImageType(meta, item.imageType)
    const key = `${assetKey}:${Number(item.imageColor ?? 0xffffffff) & 0xffffff}:${type}:${type === 'Stretch' ? `${width}:${height}` : ''}`
    let tinted = assets.tints.get(key)
    if (!tinted) {
      const raster = type === 'Stretch' ? rasterizeSlices(image, meta, width, height, loadCanvas().createCanvas) : image
      tinted = tintedImage(raster, item.imageColor, loadCanvas().createCanvas)
      assets.tints.set(key, tinted)
    }
    ctx.globalAlpha *= color.a
    ctx.drawImage(tinted, -width / 2, -height / 2, width, height)
    return
  }
  if (item.primitive === 'missing' || item.primitive === 'sprite') {
    ctx.fillStyle = 'rgba(72,34,40,0.36)'
    ctx.fillRect(-width / 2, -height / 2, width, height)
    ctx.strokeStyle = '#ff7481'
    ctx.lineWidth = 1
    ctx.strokeRect(-width / 2 + 0.5, -height / 2 + 0.5, Math.max(0, width - 1), Math.max(0, height - 1))
    return
  }
  if (item.primitive === 'circle') {
    ctx.beginPath()
    ctx.ellipse(0, 0, width / 2, height / 2, 0, 0, Math.PI * 2)
    ctx.fillStyle = cssColor(color)
    ctx.fill()
    return
  }
  if (item.primitive === 'ring') {
    ctx.beginPath()
    ctx.ellipse(0, 0, Math.max(1, width / 2 - 3.5), Math.max(1, height / 2 - 3.5), 0, 0, Math.PI * 2)
    ctx.strokeStyle = cssColor(color)
    ctx.lineWidth = 7
    ctx.stroke()
    return
  }
  if (item.primitive === 'triangle' || item.primitive === 'fourstar' || item.primitive === 'fivestar') {
    fillPoly(ctx, item.primitive, width, height, color)
    return
  }
  ctx.fillStyle = cssColor(color)
  ctx.fillRect(-width / 2, -height / 2, width, height)
}

function drawPaintItem(ctx, item, canvasHeight, assets) {
  const width = Math.max(0, finite(item.sourceWidth, finite(item.width)))
  const height = Math.max(0, finite(item.sourceHeight, finite(item.height)))
  ctx.save()
  for (const polygon of item.clipPolygons || []) {
    ctx.beginPath()
    polygon.forEach((point, index) => index ? ctx.lineTo(point.x, canvasHeight - point.y) : ctx.moveTo(point.x, canvasHeight - point.y))
    ctx.closePath()
    ctx.clip()
  }
  applyItemTransform(ctx, item, canvasHeight)
  if (item.kind === 'textbox' || item.kind === 'textwindow') drawTextItem(ctx, item, width, height)
  else if (item.kind === 'button') drawButtonItem(ctx, item, width, height)
  else if (item.kind !== 'grid') {
    const clip = imageFillRect(item, width, height)
    if (clip) {
      ctx.beginPath()
      ctx.rect(clip.x, clip.y, clip.width, clip.height)
      ctx.clip()
    }
    drawPrimitive(ctx, item, width, height, assets)
  }
  drawScrollBar(ctx, item, width, height)
  ctx.restore()
}

function drawStageBackground(ctx, width, height, { checker = false } = {}) {
  if (checker) {
    ctx.fillStyle = '#28313e'
    ctx.fillRect(0, 0, width, height)
    const size = 16
    for (let y = 0; y < height; y += size) {
      for (let x = 0; x < width; x += size) {
        if (((x / size) + (y / size)) % 2 === 0) {
          ctx.fillStyle = 'rgba(255,255,255,0.04)'
          ctx.fillRect(x, y, size, size)
        }
      }
    }
    ctx.strokeStyle = '#40b8cf'
    ctx.lineWidth = 1
    ctx.strokeRect(0.5, 0.5, width - 1, height - 1)
    return
  }
  const gradient = ctx.createRadialGradient(width / 2, height * 0.45, 8, width / 2, height / 2, Math.max(width, height) * 0.72)
  gradient.addColorStop(0, '#123a6b')
  gradient.addColorStop(0.72, '#061934')
  gradient.addColorStop(1, '#071426')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, width, height)
}

function multiplyAffine(outer, inner) {
  return {
    a: outer.a * inner.a + outer.c * inner.b,
    b: outer.b * inner.a + outer.d * inner.b,
    c: outer.a * inner.c + outer.c * inner.d,
    d: outer.b * inner.c + outer.d * inner.d,
    tx: outer.a * inner.tx + outer.c * inner.ty + outer.tx,
    ty: outer.b * inner.tx + outer.d * inner.ty + outer.ty,
  }
}

function sceneLocalMatrix(node) {
  const raw = node?.matrix
  if (!raw || typeof raw !== 'object') return { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 }
  return {
    a: finite(raw.a, 1),
    b: finite(raw.b),
    c: finite(raw.c),
    d: finite(raw.d, 1),
    tx: finite(raw.tx),
    ty: finite(raw.ty),
  }
}

/**
 * Flatten a Pixi `tree-v1` scene into the paint list Host PNG already draws.
 * Sibling cover order matches the play page: first child is on top
 * (`zIndex = -treePosition`, not Lua GetSiblingIndex), and a node's own visual
 * sits behind its children. Lua indices map inversely to this stored list.
 */
export function flattenScenePaint(scene) {
  const nodes = Array.isArray(scene?.nodes) ? scene.nodes : []
  const children = new Map()
  for (const node of nodes) {
    if (!node || node.id === undefined || node.id === null) continue
    const key = node.parent == null ? '' : String(node.parent)
    const list = children.get(key)
    if (list) list.push(node)
    else children.set(key, [node])
  }
  for (const list of children.values()) {
    list.sort((a, b) => finite(a.z) - finite(b.z))
  }
  const out = []
  function emit(node, world, clips, masks) {
    if (!SCENE_PAINT_KINDS.has(node.kind)) return
    const width = Math.abs(finite(node.sourceWidth) * Math.hypot(world.a, world.b))
    const height = Math.abs(finite(node.sourceHeight) * Math.hypot(world.c, world.d))
    out.push({
      ...node,
      left: world.tx - width / 2,
      bottom: world.ty - height / 2,
      width,
      height,
      rotationZ: Math.atan2(world.b, world.a) * 180 / Math.PI,
      matrix: { a: world.a, b: world.b, c: world.c, d: world.d, tx: world.tx, ty: world.ty },
      ...(clips.length ? { clipPolygons: clips } : {}),
      ...(masks.length ? { masks } : {}),
    })
  }
  function visit(parentKey, parentWorld, parentNode = null, clips = [], masks = []) {
    const list = children.get(parentKey) || []
    for (let i = list.length - 1; i >= 0; i -= 1) {
      const node = list[i]
      const world = parentWorld
        ? multiplyAffine(parentWorld, sceneLocalMatrix(node))
        : sceneLocalMatrix(node)
      let itemClips = clips
      if (node.clipToParent && parentWorld && parentNode) {
        const w = parentNode.sourceWidth / 2, h = parentNode.sourceHeight / 2
        itemClips = [...clips, [[-w, -h], [w, -h], [w, h], [-w, h]].map(([x, y]) => ({
          x: parentWorld.a * x + parentWorld.c * y + parentWorld.tx,
          y: parentWorld.b * x + parentWorld.d * y + parentWorld.ty,
        }))]
      }
      const spec = imageMaskSpec(node, world)
      const nextMasks = spec ? [...masks, spec] : masks
      if (node.kind !== 'grid') emit(node, world, itemClips, nextMasks)
      visit(String(node.id), world, node, itemClips, nextMasks)
      if (node.kind === 'grid') emit(node, world, itemClips, nextMasks)
    }
  }
  visit('', null)
  return out
}

export function renderScenePng(scene, canvasWidth, canvasHeight, options = {}) {
  return renderPaintPng(flattenScenePaint(scene), canvasWidth, canvasHeight, options)
}

function maskPixelBounds(mask, target, size) {
  if (!(mask.width > 0 && mask.height > 0) || !invertMatrix(mask.matrix)) return null
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) => {
    const p = applyMatrix(mask.matrix, x * mask.width / 2, y * mask.height / 2)
    return { x: p.x * size.pixelRatio, y: (size.height - p.y) * size.pixelRatio }
  })
  const x = Math.max(target.x, Math.floor(Math.min(...corners.map(p => p.x))))
  const y = Math.max(target.y, Math.floor(Math.min(...corners.map(p => p.y))))
  const right = Math.min(target.x + target.canvas.width, Math.ceil(Math.max(...corners.map(p => p.x))))
  const bottom = Math.min(target.y + target.canvas.height, Math.ceil(Math.max(...corners.map(p => p.y))))
  return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null
}

function compositeMaskedGroup(target, layer, mask, size) {
  const width = layer.canvas.width, height = layer.canvas.height
  const src = layer.ctx.getImageData(0, 0, width, height).data
  const dx = layer.x - target.x, dy = layer.y - target.y
  const image = target.ctx.getImageData(dx, dy, width, height)
  const dst = image.data
  const inverse = invertMatrix(mask.matrix)
  // One inverse per group and one bounded readback/composite, not per item/pixel.
  for (let y = 0; y < height; y++) {
    const worldY = size.height - (layer.y + y + 0.5) / size.pixelRatio
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      if (!src[i + 3]) continue
      const worldX = (layer.x + x + 0.5) / size.pixelRatio
      const localX = inverse.a * worldX + inverse.c * worldY + inverse.tx
      const localY = inverse.b * worldX + inverse.d * worldY + inverse.ty
      const coverage = imageMaskCoverage(localX, localY, mask)
      const sa = Math.round(src[i + 3] * coverage) / 255
      if (!sa) continue
      const da = dst[i + 3] / 255, outA = sa + da * (1 - sa)
      for (let c = 0; c < 3; c++) dst[i + c] = Math.round((src[i + c] * sa + dst[i + c] * da * (1 - sa)) / outA)
      dst[i + 3] = Math.round(outA * 255)
    }
  }
  // Keep readback writes in backing pixels, independent of the cropped layer's
  // draw transform (also avoids transformed putImageData quirks in native Canvas).
  target.ctx.save()
  target.ctx.setTransform(1, 0, 0, 1, 0, 0)
  target.ctx.putImageData(image, dx, dy)
  target.ctx.restore()
}

function drawPaintGroups(target, entries, size, assets, drawItem = drawPaintItem) {
  for (const entry of entries) {
    if (entry.item) { drawItem(target.ctx, entry.item, size.height, assets); continue }
    const bounds = maskPixelBounds(entry.mask, target, size)
    if (!bounds) continue // Enabled empty/singular mask means empty coverage.
    const canvas = loadCanvas().createCanvas(bounds.width, bounds.height)
    const ctx = canvas.getContext('2d')
    ctx.setTransform(size.pixelRatio, 0, 0, size.pixelRatio, -bounds.x, -bounds.y)
    const layer = { canvas, ctx, x: bounds.x, y: bounds.y }
    drawPaintGroups(layer, entry.children, size, assets, drawItem)
    compositeMaskedGroup(target, layer, entry.mask, size)
  }
}

export function renderPaintPng(paint, canvasWidth, canvasHeight, options = {}) {
  const { createCanvas } = loadCanvas()
  const size = canvasSize(canvasWidth, canvasHeight, options.scale)
  const canvas = createCanvas(size.pixelWidth, size.pixelHeight)
  const ctx = canvas.getContext('2d')
  ctx.scale(size.pixelRatio, size.pixelRatio)
  if (options.background !== 'transparent') drawStageBackground(ctx, size.width, size.height)
  const items = Array.isArray(paint) ? paint : []
  const assets = { images: options.images, imageMetadata: options.imageMetadata, tints: new Map() }
  drawPaintGroups({ canvas, ctx, x: 0, y: 0 }, groupMaskedPaint(items), size, assets)
  return {
    data: toPng(canvas),
    width: size.width,
    height: size.height,
    pixelWidth: size.pixelWidth,
    pixelHeight: size.pixelHeight,
  }
}

function editorBoxStyle(item) {
  if (item.renderMatrix) {
    const center = applyMatrix(item.renderMatrix, item.centerX, item.centerY)
    return { kind: item.kind, width: item.width, height: item.height,
      matrix: { ...item.renderMatrix, tx: center.x, ty: center.y } }
  }
  return {
    kind: item.kind,
    left: finite(item.renderLeft, item.left),
    bottom: finite(item.renderBottom, item.bottom),
    width: Math.max(0, finite(item.renderWidth, item.width)),
    height: Math.max(0, finite(item.renderHeight, item.height)),
    rotationZ: finite(item.renderRotationZ, item.rotationZ),
  }
}

function drawEditorLabel(ctx, text, width) {
  const label = String(text || '')
  if (!label) return
  ctx.font = `10px ${localFontStack()}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const metrics = ctx.measureText(label)
  const boxW = Math.min(width - 4, Math.max(24, metrics.width + 8))
  const boxH = 16
  ctx.fillStyle = 'rgba(17,25,37,0.66)'
  ctx.fillRect(-boxW / 2, -boxH / 2, boxW, boxH)
  ctx.fillStyle = '#e7edf5'
  ctx.fillText(label, 0, 0)
}

function drawEditorItem(ctx, item, canvasHeight, assets) {
  const box = editorBoxStyle(item)
  if (box.width <= 0 || box.height <= 0) return
  ctx.save()
  applyItemTransform(ctx, box, canvasHeight)
  const x = -box.width / 2
  const y = -box.height / 2
  if (item.kind === 'image') {
    ctx.save()
    // Slice before parent/local scaling: borders are local UI units.
    const width = Math.max(0, finite(item.width, box.width)), height = Math.max(0, finite(item.height, box.height))
    ctx.scale(width ? box.width / width : 1, height ? box.height / height : 1)
    const fill = item.enableFill ? imageFillRect(item, width, height) : null
    if (fill) { ctx.beginPath(); ctx.rect(fill.x, fill.y, fill.width, fill.height); ctx.clip() }
    drawPrimitive(ctx, item, width, height, assets)
    ctx.restore()
  } else if (item.kind === 'textbox' || item.kind === 'textwindow') {
    drawTextItem(ctx, item, box.width, box.height)
  } else if (item.kind === 'button') {
    drawButtonItem(ctx, item, box.width, box.height)
    drawEditorLabel(ctx, item.name || KIND_LABEL.button, box.width)
  } else if (item.kind === 'cursor') {
    ctx.setLineDash([6, 4])
    ctx.strokeStyle = 'rgba(74,142,181,0.7)'
    ctx.fillStyle = 'rgba(74,142,181,0.1)'
    ctx.fillRect(x, y, box.width, box.height)
    ctx.strokeRect(x, y, box.width, box.height)
    drawEditorLabel(ctx, item.name || KIND_LABEL.cursor, box.width)
  } else if (item.kind === 'grid') {
    ctx.strokeStyle = 'rgba(106,146,189,0.55)'
    ctx.strokeRect(x, y, box.width, box.height)
    ctx.beginPath()
    for (let gx = 20; gx < box.width; gx += 20) {
      ctx.moveTo(x + gx, y)
      ctx.lineTo(x + gx, y + box.height)
    }
    for (let gy = 20; gy < box.height; gy += 20) {
      ctx.moveTo(x, y + gy)
      ctx.lineTo(x + box.width, y + gy)
    }
    ctx.stroke()
    drawEditorLabel(ctx, item.name || KIND_LABEL.grid, box.width)
  } else if (item.kind !== 'container' && item.kind !== 'server-container') {
    ctx.setLineDash(item.kind === 'reference' || item.kind === 'animation' || item.kind === 'fullscreen' ? [4, 4] : [])
    ctx.strokeStyle = 'rgba(203,218,237,0.55)'
    ctx.strokeRect(x, y, box.width, box.height)
    drawEditorLabel(ctx, item.name || KIND_LABEL[item.kind] || item.kind, box.width)
  } else {
    ctx.strokeStyle = 'rgba(78,165,230,0.42)'
    ctx.strokeRect(x, y, box.width, box.height)
  }
  ctx.restore()
}

export function renderEditorPng(snapshot, options = {}) {
  const { createCanvas } = loadCanvas()
  const canvasInfo = snapshot?.canvas || {}
  const size = canvasSize(canvasInfo.width || 1600, canvasInfo.height || 900, options.scale)
  const canvas = createCanvas(size.pixelWidth, size.pixelHeight)
  const ctx = canvas.getContext('2d')
  ctx.scale(size.pixelRatio, size.pixelRatio)
  drawStageBackground(ctx, size.width, size.height, { checker: true })
  const boxes = (Array.isArray(snapshot?.boxes) ? snapshot.boxes : [])
    .filter(item => item && item.kind !== 'server-container' && item.visible !== false && item.visibleInHierarchy !== false)
  const selectedId = snapshot?.selectedId
  const assets = { images: options.images, imageMetadata: options.imageMetadata, tints: new Map() }
  drawPaintGroups({ canvas, ctx, x: 0, y: 0 }, groupMaskedPaint(boxes), size, assets, drawEditorItem)
  const selected = boxes.find(item => item.id === selectedId)
  if (selected && selected.kind !== 'container') {
    const box = editorBoxStyle(selected)
    ctx.save()
    applyItemTransform(ctx, box, size.height)
    ctx.strokeStyle = '#61b9ff'
    ctx.lineWidth = 2
    ctx.strokeRect(-box.width / 2, -box.height / 2, box.width, box.height)
    ctx.restore()
  }
  return {
    data: toPng(canvas),
    page: snapshot?.asset?.type === 'client-control-template' ? 'UI控件-客户端' : 'UI 编辑',
    width: size.width,
    height: size.height,
    pixelWidth: size.pixelWidth,
    pixelHeight: size.pixelHeight,
  }
}
