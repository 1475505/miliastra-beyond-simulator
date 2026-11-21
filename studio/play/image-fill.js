/** Linear fill, shared by runtime rendering and the existing editor preview. */
export function imageFillRect(item, width, height) {
  if (item.fillType !== 'Horizontal' && item.fillType !== 'Vertical') return null
  const amount = fillProgress(item)
  if (item.fillType === 'Horizontal') {
    const filledWidth = width * amount
    return {
      x: item.fillHorizontalType === 'Right' ? width / 2 - filledWidth : -width / 2,
      y: -height / 2,
      width: filledWidth,
      height,
    }
  }
  const filledHeight = height * amount
  return {
    x: -width / 2,
    y: item.fillVerticalType === 'Top' ? -height / 2 : height / 2 - filledHeight,
    width,
    height: filledHeight,
  }
}

function fillProgress(item) {
  const raw = Number(item.fillAmount ?? 1)
  // Invalid/missing amounts show the whole image; finite amounts clamp for display.
  return Number.isFinite(raw) ? Math.max(0, Math.min(1, raw)) : 1
}

// Origins are relative to half extents; angles start at up and turn clockwise.
// These are the image editor's preview rules (2b8ced9), not native raster math.
const CORNERS = {
  BottomLeft: [-1, 1, 0], TopLeft: [-1, -1, 90],
  TopRight: [1, -1, 180], BottomRight: [1, 1, 270],
}
const EDGES = {
  Bottom: [0, 1, 270], Left: [-1, 0, 0], Top: [0, -1, 90], Right: [1, 0, 180],
}
const CENTER_ANGLES = { Bottom: 180, Left: 270, Top: 0, Right: 90 }
const RAD = Math.PI / 180
const EMPTY = { kind: 'empty' }

function intersectRay(x, y, angle, halfW, halfH) {
  // A cardinal ray starting on the image edge must run along that edge,
  // not exit immediately due to the residual from sin/cos.
  let dx = Math.sin(angle * RAD), dy = -Math.cos(angle * RAD)
  if (Math.abs(dx) < 1e-12) dx = 0
  if (Math.abs(dy) < 1e-12) dy = 0
  const tx = dx ? ((dx > 0 ? halfW : -halfW) - x) / dx : Infinity
  const ty = dy ? ((dy > 0 ? halfH : -halfH) - y) / dy : Infinity
  const t = Math.min(tx, ty)
  return [
    Math.max(-halfW, Math.min(halfW, x + t * dx)),
    Math.max(-halfH, Math.min(halfH, y + t * dy)),
  ]
}

function radialPoints(x, y, start, sweep, halfW, halfH) {
  // Walk the rectangle boundary between the two rays, retaining just the
  // corners inside the sweep. No raster or tessellated arc is needed.
  const between = []
  for (const cx of [-halfW, halfW]) for (const cy of [-halfH, halfH]) {
    if (cx === x && cy === y) continue
    const angle = (Math.atan2(cx - x, y - cy) / RAD - start + 720) % 360
    if (angle > 1e-10 && angle < sweep - 1e-10) between.push({ angle, cx, cy })
  }
  between.sort((a, b) => a.angle - b.angle)
  return [x, y, ...intersectRay(x, y, start, halfW, halfH),
    ...between.flatMap(({ cx, cy }) => [cx, cy]), ...intersectRay(x, y, start + sweep, halfW, halfH)]
}

// Lua fillType alone selects the runtime effect; Unused shows the whole image.
// An empty clip hides only the image's own artwork.
export function imageFillClip(item, width, height) {
  const rect = imageFillRect(item, width, height)
  if (rect) return rect.width > 0 && rect.height > 0 ? { kind: 'rect', ...rect } : EMPTY
  const { fillType } = item
  if (fillType !== 'Radial90' && fillType !== 'Radial180' && fillType !== 'Radial360') return null
  if (!(width > 0 && height > 0)) return EMPTY
  const amount = fillProgress(item)
  if (amount === 0) return EMPTY
  if (amount === 1) return null
  const halfW = width / 2, halfH = height / 2

  const edge = Object.hasOwn(EDGES, item.fillRadialType) ? item.fillRadialType : 'Bottom'
  if (fillType === 'Radial360') {
    return { kind: 'polygon', points: radialPoints(0, 0, CENTER_ANGLES[edge], 360 * amount, halfW, halfH) }
  }
  const quarter = fillType === 'Radial90'
  const corner = Object.hasOwn(CORNERS, item.fillRadial90Type) ? item.fillRadial90Type : 'BottomLeft'
  const [ox, oy, start] = quarter ? CORNERS[corner] : EDGES[edge]
  return { kind: 'polygon', points: radialPoints(ox * halfW, oy * halfH, start, (quarter ? 90 : 180) * amount, halfW, halfH) }
}

export function clipImageFill(ctx, clip) {
  if (!clip) return true
  if (clip.kind === 'empty') return false
  ctx.beginPath()
  if (clip.kind === 'rect') ctx.rect(clip.x, clip.y, clip.width, clip.height)
  else {
    const { points } = clip
    ctx.moveTo(points[0], points[1])
    for (let i = 2; i < points.length; i += 2) ctx.lineTo(points[i], points[i + 1])
    ctx.closePath()
  }
  ctx.clip()
  return true
}
