/** Official Color is a packed integer AARRGGBB (observed). */

export function packRgba(r, g, b, a = 255) {
  const R = clampByte(r)
  const G = clampByte(g)
  const B = clampByte(b)
  const A = a == null ? 255 : clampByte(a)
  return ((A << 24) | (R << 16) | (G << 8) | B) >>> 0
}

export function unpackRgba(value) {
  const v = value >>> 0
  return [(v >>> 16) & 255, (v >>> 8) & 255, v & 255, (v >>> 24) & 255]
}

function clampByte(n) {
  const x = Number(n)
  if (!Number.isFinite(x)) return 0
  return Math.max(0, Math.min(255, Math.trunc(x)))
}

export function lerpColor(from, to, t) {
  const a = unpackRgba(from)
  const b = unpackRgba(to)
  return packRgba(
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
    a[3] + (b[3] - a[3]) * t,
  )
}
