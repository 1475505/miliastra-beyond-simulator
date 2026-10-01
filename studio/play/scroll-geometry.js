// Shared geometry in local, top-left/y-down coordinates, centered on a control.
export function scrollBarGeometry(scroll, width, height) {
  if (!scroll?.showBar || scroll.max <= 0 || width <= 0 || height <= 0) return null
  const horizontal = scroll.horizontal === true
  const length = horizontal ? width : height
  const trackLength = Math.max(0, length - 4)
  const thumbLength = Math.min(trackLength, Math.max(18, trackLength * length / (length + scroll.max)))
  const travel = trackLength - thumbLength
  const position = travel * scroll.offset / scroll.max
  const thickness = Math.min(8, (horizontal ? height : width))
  const track = horizontal
    ? { x: -width / 2 + 2, y: height / 2 - thickness - 2, width: trackLength, height: thickness }
    : { x: width / 2 - thickness - 2, y: -height / 2 + 2, width: thickness, height: trackLength }
  const thumb = horizontal
    ? { ...track, x: track.x + position, width: thumbLength }
    : { ...track, y: track.y + position, height: thumbLength }
  return { track, thumb, travel }
}

export function visibleTextLines(scroll, height) {
  const first = Math.max(0, Math.floor(scroll.offset / scroll.lineHeight) - 1)
  const last = Math.min(scroll.lines.length, Math.ceil((scroll.offset + height) / scroll.lineHeight) + 1)
  return { text: scroll.lines.slice(first, last).join('\n'), y: first * scroll.lineHeight }
}

// Convex viewport intersections for the legacy flattened Pixi paint path.
export function intersectClipPolygons(polygons) {
  let output = polygons[0] || []
  const cross = (a, b, p) => (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)
  for (const clip of polygons.slice(1)) {
    const area = clip.reduce((sum, p, i) => { const q = clip[(i + 1) % clip.length]; return sum + p.x * q.y - q.x * p.y }, 0)
    const sign = area >= 0 ? 1 : -1
    for (let i = 0; i < clip.length && output.length; i++) {
      const a = clip[i], b = clip[(i + 1) % clip.length], input = output
      output = []
      let prev = input[input.length - 1], pd = cross(a, b, prev) * sign
      for (const point of input) {
        const d = cross(a, b, point) * sign
        if ((d >= 0) !== (pd >= 0)) {
          const t = pd / (pd - d)
          output.push({ x: prev.x + t * (point.x - prev.x), y: prev.y + t * (point.y - prev.y) })
        }
        if (d >= 0) output.push(point)
        prev = point
        pd = d
      }
    }
  }
  return output
}
