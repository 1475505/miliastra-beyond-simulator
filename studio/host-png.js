import { createRequire } from 'node:module'
import { imageFillRect } from './play/image-fill.js'

const require = createRequire(import.meta.url)

const TRI_POINTS = [0, -0.5, 0.5, 0.5, -0.5, 0.5]
const STAR4_POINTS = [0, -0.5, 0.12, -0.12, 0.5, 0, 0.12, 0.12, 0, 0.5, -0.12, 0.12, -0.5, 0, -0.12, -0.12]
const STAR5_POINTS = [0, -0.5, 0.11, -0.15, 0.48, -0.15, 0.18, 0.07, 0.29, 0.41, 0, 0.2, -0.29, 0.41, -0.18, 0.07, -0.48, -0.15, -0.11, -0.15]
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const SCENE_PAINT_KINDS = new Set(['image', 'textbox', 'textwindow', 'button'])
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
  const font = Math.max(8, finite(item.fontSize, 12))
  const color = argb(item.fontColor, 0xffffffff)
  const horizontal = item.horizontalAlignment === 'Right' ? 1 : item.horizontalAlignment === 'Middle' ? 0.5 : 0
  const vertical = item.verticalAlignment === 'Bottom' ? 1 : item.verticalAlignment === 'Middle' ? 0.5 : 0
  ctx.save()
  ctx.beginPath()
  ctx.rect(-width / 2, -height / 2, width, height)
  ctx.clip()
  ctx.font = `${font}px "Microsoft YaHei UI","Microsoft YaHei",sans-serif`
  ctx.fillStyle = cssColor(color)
  ctx.textAlign = horizontal === 1 ? 'right' : horizontal === 0.5 ? 'center' : 'left'
  ctx.textBaseline = vertical === 1 ? 'bottom' : vertical === 0.5 ? 'middle' : 'top'
  if (item.enableOutline) {
    const outline = argb(item.outlineColor, 0xff000000)
    ctx.strokeStyle = cssColor(outline)
    ctx.lineWidth = Math.max(2, font * 0.12)
    ctx.lineJoin = 'round'
  }
  const x = horizontal === 0 ? -width / 2 + 2 : horizontal === 1 ? width / 2 - 2 : 0
  const y = vertical === 0 ? -height / 2 : vertical === 1 ? height / 2 : 0
  const lines = String(item.text || '').split('\n')
  const lineHeight = font * 1.2
  const startY = vertical === 0.5 ? y - (lines.length - 1) * lineHeight / 2 : vertical === 1 ? y - (lines.length - 1) * lineHeight : y
  for (let i = 0; i < lines.length; i += 1) {
    const lineY = startY + i * lineHeight
    if (item.enableOutline) ctx.strokeText(lines[i], x, lineY)
    ctx.fillText(lines[i], x, lineY)
  }
  ctx.restore()
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

function drawPrimitive(ctx, item, width, height) {
  const color = argb(item.imageColor, 0xffffffff)
  if (item.primitive === 'missing') {
    ctx.fillStyle = 'rgba(72,34,40,0.36)'
    ctx.fillRect(-width / 2, -height / 2, width, height)
    ctx.strokeStyle = '#ff7481'
    ctx.lineWidth = 1
    ctx.strokeRect(-width / 2 + 0.5, -height / 2 + 0.5, Math.max(0, width - 1), Math.max(0, height - 1))
    return
  }
  if (item.primitive === 'circle') {
    ctx.beginPath()
    ctx.arc(0, 0, Math.min(width, height) / 2, 0, Math.PI * 2)
    ctx.fillStyle = cssColor(color)
    ctx.fill()
    return
  }
  if (item.primitive === 'ring') {
    ctx.beginPath()
    ctx.arc(0, 0, Math.max(1, Math.min(width, height) / 2 - 3.5), 0, Math.PI * 2)
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

function drawPaintItem(ctx, item, canvasHeight) {
  const width = Math.max(0, finite(item.sourceWidth, finite(item.width)))
  const height = Math.max(0, finite(item.sourceHeight, finite(item.height)))
  ctx.save()
  applyItemTransform(ctx, item, canvasHeight)
  if (item.kind === 'textbox' || item.kind === 'textwindow') drawTextItem(ctx, item, width, height)
  else if (item.kind === 'button') drawButtonItem(ctx, item, width, height)
  else {
    const clip = imageFillRect(item, width, height)
    if (clip) {
      ctx.beginPath()
      ctx.rect(clip.x, clip.y, clip.width, clip.height)
      ctx.clip()
    }
    drawPrimitive(ctx, item, width, height)
  }
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
  function emit(node, world) {
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
    })
  }
  function visit(parentKey, parentWorld) {
    const list = children.get(parentKey) || []
    for (let i = list.length - 1; i >= 0; i -= 1) {
      const node = list[i]
      const world = parentWorld
        ? multiplyAffine(parentWorld, sceneLocalMatrix(node))
        : sceneLocalMatrix(node)
      emit(node, world)
      visit(String(node.id), world)
    }
  }
  visit('', null)
  return out
}

export function renderScenePng(scene, canvasWidth, canvasHeight, options = {}) {
  return renderPaintPng(flattenScenePaint(scene), canvasWidth, canvasHeight, options)
}

export function renderPaintPng(paint, canvasWidth, canvasHeight, options = {}) {
  const { createCanvas } = loadCanvas()
  const size = canvasSize(canvasWidth, canvasHeight, options.scale)
  const canvas = createCanvas(size.pixelWidth, size.pixelHeight)
  const ctx = canvas.getContext('2d')
  ctx.scale(size.pixelRatio, size.pixelRatio)
  drawStageBackground(ctx, size.width, size.height)
  const items = Array.isArray(paint) ? paint : []
  for (const item of items) {
    if (!item || item.id === undefined || item.id === null) continue
    drawPaintItem(ctx, item, size.height)
  }
  return {
    data: toPng(canvas),
    width: size.width,
    height: size.height,
    pixelWidth: size.pixelWidth,
    pixelHeight: size.pixelHeight,
  }
}

function editorBoxStyle(item) {
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
  ctx.font = '10px "Microsoft YaHei UI","Microsoft YaHei",sans-serif'
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

function drawEditorItem(ctx, item, canvasHeight, selectedId) {
  const box = editorBoxStyle(item)
  if (box.width <= 0 || box.height <= 0) return
  ctx.save()
  ctx.translate(box.left + box.width / 2, canvasHeight - box.bottom - box.height / 2)
  ctx.rotate(-box.rotationZ * Math.PI / 180)
  const x = -box.width / 2
  const y = -box.height / 2
  if (item.kind === 'image') {
    drawPrimitive(ctx, item, box.width, box.height)
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
  if (item.id === selectedId && item.kind !== 'container' && item.kind !== 'server-container') {
    ctx.setLineDash([])
    ctx.strokeStyle = '#61b9ff'
    ctx.lineWidth = 2
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
  const boxes = Array.isArray(snapshot?.boxes) ? snapshot.boxes : []
  const selectedId = snapshot?.selectedId
  for (const item of boxes) {
    if (!item || item.kind === 'server-container' || item.visible === false) continue
    drawEditorItem(ctx, item, size.height, selectedId)
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
