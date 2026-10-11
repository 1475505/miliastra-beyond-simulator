/**
 * Rectangle image masks for play rendering.
 *
 * Device evidence (MASK v1, PC, 2026-10-11, scale 1, asset 100001): enableMask
 * clips descendants, not siblings; imageColor alpha does not disable the mask
 * or hide children; pixel feather fades inward from both edges of that axis and
 * does not reveal content outside the rectangle. Width 0 stays a hard edge.
 *
 * Simulator policy, not additional device proof: the falloff is linear; percentage
 * mode uses width as a percent of that side and ignores the range fields; the
 * mask shape is the control rectangle, not the texture contour; reverseMaskArea
 * is not applied. Nested masks multiply coverage.
 */
import { applyMatrix, invertMatrix } from '../ui/layout.js'

const nonnegative = value => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0

export function imageMaskSpec(item, matrix) {
  if (!item || item.kind !== 'image' || item.enableMask !== true || !matrix) return null
  const width = nonnegative(item.sourceWidth ?? item.width)
  const height = nonnegative(item.sourceHeight ?? item.height)
  const soft = item.enableSoftEdge === true
  const percent = item.softEdgeMode !== 'Pixel'
  const rawX = soft ? nonnegative(item.softEdgeWidthX) : 0
  const rawY = soft ? nonnegative(item.softEdgeWidthY) : 0
  return {
    id: item.id,
    matrix,
    width,
    height,
    featherX: percent ? width * rawX / 100 : rawX,
    featherY: percent ? height * rawY / 100 : rawY,
  }
}

export function centerMaskMatrix(matrix, centerX, centerY) {
  const center = applyMatrix(matrix, centerX, centerY)
  return { a: matrix.a, b: matrix.b, c: matrix.c, d: matrix.d, tx: center.x, ty: center.y }
}

export function imageMaskCoverage(localX, localY, mask) {
  const fade = (distance, feather) => {
    if (distance <= 0) return 0
    if (!(feather > 0) || distance >= feather) return 1
    return distance / feather
  }
  return Math.min(
    fade(localX + mask.width / 2, mask.featherX),
    fade(mask.width / 2 - localX, mask.featherX),
    fade(localY + mask.height / 2, mask.featherY),
    fade(mask.height / 2 - localY, mask.featherY),
  )
}

// A flattened paint list retains mask identity. Consecutive items under the same
// ancestor compose once before that ancestor's mask is applied, just like Pixi.
export function groupMaskedPaint(items) {
  const root = { children: [] }
  const stack = [root]
  let keys = []
  for (const item of items || []) {
    if (!item || item.id == null) continue
    const masks = item.masks || []
    const nextKeys = masks.map(mask => JSON.stringify([mask.id, mask.matrix, mask.width, mask.height, mask.featherX, mask.featherY]))
    let common = 0
    while (common < keys.length && common < nextKeys.length && keys[common] === nextKeys[common]) common++
    stack.length = common + 1
    for (let i = common; i < masks.length; i++) {
      const group = { mask: masks[i], children: [] }
      stack.at(-1).children.push(group)
      stack.push(group)
    }
    stack.at(-1).children.push({ item })
    keys = nextKeys
  }
  return root.children
}

const identity = () => ({ a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 })

function relativeMatrix(parent, world) {
  const p = invertMatrix(parent) || identity()
  return {
    a: p.a * world.a + p.c * world.b, b: p.b * world.a + p.d * world.b,
    c: p.a * world.c + p.c * world.d, d: p.b * world.c + p.d * world.d,
    tx: p.a * world.tx + p.c * world.ty + p.tx, ty: p.b * world.tx + p.d * world.ty + p.ty,
  }
}

// The legacy paint fallback has no parent tree. Reconstruct only mask groups;
// use synthetic IDs so real controls can never alias their mask containers.
export function maskedPaintScene(items) {
  const nodes = []
  let sequence = 0
  const visit = (entries, parent = null, parentWorld = identity()) => {
    entries.forEach((entry, index) => {
      const id = `paint-mask:${sequence++}`
      const z = entries.length - 1 - index
      if (entry.mask) {
        const mask = entry.mask
        nodes.push({ id, parent, z, group: false, kind: 'image', primitive: 'rect', imageColor: 0,
          sourceWidth: mask.width, sourceHeight: mask.height, matrix: relativeMatrix(parentWorld, mask.matrix),
          enableMask: true, enableSoftEdge: true, softEdgeMode: 'Pixel',
          softEdgeWidthX: mask.featherX, softEdgeWidthY: mask.featherY })
        visit(entry.children, id, mask.matrix)
      } else {
        const item = entry.item
        const width = item.sourceWidth ?? item.width ?? 0, height = item.sourceHeight ?? item.height ?? 0
        const angle = (item.rotationZ || 0) * Math.PI / 180
        const world = item.matrix || { a: Math.cos(angle), b: Math.sin(angle), c: -Math.sin(angle), d: Math.cos(angle),
          tx: (item.left || 0) + width / 2, ty: (item.bottom || 0) + height / 2 }
        const inverse = invertMatrix(parentWorld)
        const clips = (item.clipPolygons || []).map(polygon => polygon.map(point => inverse ? applyMatrix(inverse, point.x, point.y) : point))
        const { masks, ...paint } = item
        nodes.push({ ...paint, id, parent, z, group: false, enableMask: false, clipToParent: false,
          sourceWidth: width, sourceHeight: height, matrix: relativeMatrix(parentWorld, world), clipPolygons: clips })
      }
    })
  }
  visit(groupMaskedPaint(items))
  return { format: 'tree-v1', reset: true, nodes }
}

export function paintMaskCanvas(canvas, mask) {
  const width = Math.max(1, canvas.width)
  const height = Math.max(1, canvas.height)
  const ctx = canvas.getContext('2d')
  const image = ctx.createImageData(width, height)
  const data = image.data
  for (let y = 0; y < height; y += 1) {
    const localY = mask.height / 2 - (y + 0.5) * mask.height / height
    for (let x = 0; x < width; x += 1) {
      const localX = -mask.width / 2 + (x + 0.5) * mask.width / width
      const alpha = Math.round(255 * imageMaskCoverage(localX, localY, mask))
      const i = (y * width + x) * 4
      data[i] = 255
      data[i + 1] = 255
      data[i + 2] = 255
      data[i + 3] = alpha
    }
  }
  ctx.putImageData(image, 0, 0)
  return canvas
}
