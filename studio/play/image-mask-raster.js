import { rasterizeSlices, resolveImageType } from '../assets/image-stretch.js'
import { drawPrimitiveShape } from '../assets/primitives.js'

// Preview geometry and scanline feathering aligned with the image editor
// (103025f, maskShapes.ts / maskPreview.ts). These are not native shader laws.

export function featherMaskAlpha(alpha, width, height, featherX, featherY) {
  const result = Float32Array.from(alpha, value => value / 255)
  const scan = (horizontal, feather) => {
    if (!(feather > 0)) return
    const length = horizontal ? width : height, lines = horizontal ? height : width
    for (let line = 0; line < lines; line++) for (const direction of [1, -1]) {
      let distance = 0
      for (let pos = direction > 0 ? 0 : length - 1; pos >= 0 && pos < length; pos += direction) {
        const i = horizontal ? line * width + pos : pos * width + line
        distance = alpha[i] === 0 ? 0 : distance + 1
        result[i] = Math.min(result[i], Math.max(0, distance - .5) / feather)
      }
    }
  }
  scan(true, featherX)
  scan(false, featherY)
  return Uint8ClampedArray.from(result, value => Math.round(value * 255))
}

export function maskRasterSize(mask) {
  const scale = Math.min(2, 1536 / Math.max(1, mask.width, mask.height))
  return { width: Math.max(1, Math.ceil(mask.width * scale)), height: Math.max(1, Math.ceil(mask.height * scale)) }
}

export function rasterizeMask(mask, createCanvas, asset) {
  const { width, height } = maskRasterSize(mask)
  // Transparent padding makes the outer contour and internal holes equal edges.
  const canvas = createCanvas(width + 2, height + 2), ctx = canvas.getContext('2d')
  ctx.translate(1, 1)
  ctx.fillStyle = '#fff'
  if (mask.width > 0 && mask.height > 0) {
    if (mask.primitive === 'sprite' && asset?.image) {
      const image = resolveImageType(asset.meta, mask.imageType) === 'Stretch'
        ? rasterizeSlices(asset.image, asset.meta, mask.width, mask.height, createCanvas, 1536, 2) : asset.image
      ctx.drawImage(image, 0, 0, width, height)
    } else {
      ctx.translate(width / 2, height / 2)
      drawPrimitiveShape(ctx, mask.primitive, width, height)
    }
  }
  const rgba = ctx.getImageData(0, 0, canvas.width, canvas.height).data
  const alpha = new Uint8ClampedArray(canvas.width * canvas.height)
  for (let i = 0; i < alpha.length; i++) alpha[i] = rgba[i * 4 + 3]
  return { width, height, alpha: featherMaskAlpha(alpha, canvas.width, canvas.height,
    mask.width > 0 ? mask.featherX * width / mask.width : 0, mask.height > 0 ? mask.featherY * height / mask.height : 0) }
}

export function sampleMaskRaster(x, y, mask, raster) {
  if (!raster || !(mask.width > 0 && mask.height > 0)) return 0
  const u = (x / mask.width + .5) * raster.width + .5
  const v = (.5 - y / mask.height) * raster.height + .5
  const ix = Math.floor(u), iy = Math.floor(v), fx = u - ix, fy = v - iy
  const at = (px, py) => px < 0 || py < 0 || px >= raster.width + 2 || py >= raster.height + 2
    ? 0 : raster.alpha[py * (raster.width + 2) + px] / 255
  return at(ix, iy) * (1 - fx) * (1 - fy) + at(ix + 1, iy) * fx * (1 - fy)
    + at(ix, iy + 1) * (1 - fx) * fy + at(ix + 1, iy + 1) * fx * fy
}
