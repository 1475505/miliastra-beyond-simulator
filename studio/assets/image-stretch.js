// Preview policy aligned with Miliastra-image-editor-webui 20659b3:
// raw m_Border units, independent axis fitting, including zero-span center UVs.
export function supportsImageStretch(meta) {
  return !!meta?.border && Object.values(meta.border).some(value => Number.isFinite(value) && value > 0)
}

export function resolveImageType(meta, requested) {
  const name = typeof requested === 'object' ? requested?.Name : requested
  return supportsImageStretch(meta) && name !== 'Basic' ? 'Stretch' : 'Basic'
}

export function normalizeImageMeta(raw) {
  if (!raw) return null
  const width = Number(raw.m_Rect?.width), height = Number(raw.m_Rect?.height)
  if (![width, height].every(n => Number.isFinite(n) && n > 0 && n <= 8192) || width * height > 16_777_216) throw new Error('Invalid image metadata dimensions')
  const border = {}
  for (const [name, key] of [['left', 'X'], ['bottom', 'Y'], ['right', 'Z'], ['top', 'W']]) {
    const value = Number(raw.m_Border?.[key] ?? 0)
    if (!Number.isFinite(value)) throw new Error('Invalid image border')
    border[name] = Math.max(0, value)
  }
  return { width, height, border }
}

function axis(size, before, after, target) {
  before = Number.isFinite(before) ? Math.max(0, before) : 0
  after = Number.isFinite(after) ? Math.max(0, after) : 0
  const sourceScale = Math.min(1, size / (before + after || 1))
  before *= sourceScale; after *= sourceScale
  const targetScale = Math.min(1, target / (before + after || 1))
  return { source: [0, before, size - after, size], target: [0, before * targetScale, target - after * targetScale, target] }
}

export function sliceRegions(meta, width, height) {
  if (!(meta?.width > 0 && meta?.height > 0 && width > 0 && height > 0)) return []
  const x = axis(meta.width, meta.border.left, meta.border.right, width)
  const y = axis(meta.height, meta.border.top, meta.border.bottom, height)
  const regions = []
  for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) {
    const target = [x.target[col], y.target[row], x.target[col + 1] - x.target[col], y.target[row + 1] - y.target[row]]
    if (target[2] <= 0 || target[3] <= 0) continue
    regions.push({ source: [x.source[col], y.source[row], x.source[col + 1] - x.source[col], y.source[row + 1] - y.source[row]], target })
  }
  return regions
}

const pixels = new WeakMap()

// Pixel-center bilinear sampling, matching the GPU UV grid. A zero source span
// repeats its seam sample instead of dropping the target strip/center.
export function rasterizeSlices(image, meta, width, height, createCanvas) {
  const logicalW = Math.max(0, width), logicalH = Math.max(0, height)
  const scale = Math.min(1, 4096 / Math.max(1, logicalW), 4096 / Math.max(1, logicalH))
  const w = Math.max(1, Math.round(logicalW * scale)), h = Math.max(1, Math.round(logicalH * scale))
  const canvas = createCanvas(w, h), ctx = canvas.getContext('2d')
  if (!logicalW || !logicalH) return canvas
  let input = pixels.get(image)
  if (!input) {
    const source = createCanvas(image.width, image.height), sourceCtx = source.getContext('2d')
    sourceCtx.drawImage(image, 0, 0)
    input = sourceCtx.getImageData(0, 0, image.width, image.height)
    pixels.set(image, input)
  }
  const output = ctx.createImageData(w, h), data = input.data
  const lookup = (size, original, before, after, target, count) => {
    const { source, target: dest } = axis(original, before, after, target)
    return Array.from({ length: count }, (_, i) => {
      const p = (i + 0.5) * target / count
      const j = p < dest[1] ? 0 : p < dest[2] ? 1 : 2
      const ratio = dest[j + 1] > dest[j] ? (p - dest[j]) / (dest[j + 1] - dest[j]) : 0
      const coordinate = Math.max(0, Math.min(size - 1, (source[j] + ratio * (source[j + 1] - source[j])) * size / original - 0.5))
      const a = Math.floor(coordinate)
      return [a, Math.min(size - 1, a + 1), coordinate - a]
    })
  }
  const xs = lookup(image.width, meta.width, meta.border.left, meta.border.right, logicalW, w)
  const ys = lookup(image.height, meta.height, meta.border.top, meta.border.bottom, logicalH, h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const [x0, x1, fx] = xs[x], [y0, y1, fy] = ys[y]
    const i0 = (y0 * image.width + x0) * 4, i1 = (y0 * image.width + x1) * 4
    const i2 = (y1 * image.width + x0) * 4, i3 = (y1 * image.width + x1) * 4
    const a0 = data[i0 + 3] * (1 - fx) * (1 - fy), a1 = data[i1 + 3] * fx * (1 - fy)
    const a2 = data[i2 + 3] * (1 - fx) * fy, a3 = data[i3 + 3] * fx * fy
    const alpha = a0 + a1 + a2 + a3
    const dest = (y * w + x) * 4
    output.data[dest + 3] = Math.round(alpha)
    for (let c = 0; c < 3; c++) output.data[dest + c] = alpha ? Math.round((data[i0 + c] * a0 + data[i1 + c] * a1 + data[i2 + c] * a2 + data[i3 + c] * a3) / alpha) : 0
  }
  ctx.putImageData(output, 0, 0)
  return canvas
}
