// Shared Canvas2D operations. No network, filesystem or Runtime dependencies.
// The provider exports trimmed PNGs in display orientation. Fractional atlas
// bounds are rasterized to nearest pixel; atlas x/y are NOT crop coordinates
// in the standalone PNG. This is a simulator preview policy, not device proof.
export function restoreSprite(image, metadata, createCanvas) {
  const rect = metadata?.m_Rect
  const offset = metadata?.m_RD?.textureRectOffset
  const texture = metadata?.m_RD?.textureRect
  const width = Math.round(Number(rect?.width)), height = Math.round(Number(rect?.height))
  const x = Math.round(Number(offset?.X)), bottom = Math.round(Number(offset?.Y))
  const tw = Math.round(Number(texture?.width)), th = Math.round(Number(texture?.height))
  const rotation = metadata?.m_RD?.settingsRaw?.packingRotation
  if (![width, height, tw, th].every(v => Number.isInteger(v) && v > 0 && v <= 8192)
    || width * height > 16_777_216 || !Number.isFinite(x) || !Number.isFinite(bottom)
    || x < 0 || bottom < 0 || x + tw > width || bottom + th > height) {
    throw new Error('Invalid sprite dimensions or trim offset')
  }
  if (rotation && rotation !== 'None') throw new Error(`Unsupported sprite packing rotation: ${rotation}`)
  const canvas = createCanvas(width, height)
  const ctx = canvas.getContext('2d')
  // Some exports already contain the original transparent canvas.
  if (image.width === width && image.height === height) ctx.drawImage(image, 0, 0)
  else {
    if (image.width !== tw || image.height !== th) throw new Error('Sprite PNG does not match its trim metadata')
    ctx.drawImage(image, x, height - bottom - th)
  }
  return canvas
}

export function tintedImage(image, color, createCanvas) {
  const raw = Number(color ?? 0xffffffff) >>> 0
  if ((raw & 0xffffff) === 0xffffff) return image
  const canvas = createCanvas(image.width, image.height)
  const ctx = canvas.getContext('2d')
  ctx.drawImage(image, 0, 0)
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const r = (raw >>> 16) & 255, g = (raw >>> 8) & 255, b = raw & 255
  for (let i = 0; i < pixels.data.length; i += 4) {
    pixels.data[i] = Math.round(pixels.data[i] * r / 255)
    pixels.data[i + 1] = Math.round(pixels.data[i + 1] * g / 255)
    pixels.data[i + 2] = Math.round(pixels.data[i + 2] * b / 255)
  }
  ctx.putImageData(pixels, 0, 0)
  return canvas
}
