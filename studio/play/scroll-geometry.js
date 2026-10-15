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

// 真机实测：文本框高度不足时整段文字都不绘制 —— 底色照画，控件尺寸、对齐、text 字段回读都正常，
// 就是没有字形。数据来自真机「字号测试」工程 41 张卡片（字号/高度 → 是否绘制）：
//   16/16 16/20 16/24 16/26 → 不绘制      16/28 16/30 16/32 16/36 16/48 → 绘制
//   20/30 24/36 → 不绘制                  24/48 → 绘制         10/20 8/24 → 绘制
//   40/40 40/45 40/50 60/70 → 不绘制      40/64 40/66 40/68 40/70 → 绘制   24/41 60/96 → 绘制
// 于是阈值被夹在「1.63×字号」与「1.75×字号」之间；这里拟合 1.5×字号 + 4px
// （在 16px 上为 28，正好落在实测边界 26→28 之间；40px 上为 64，与实测 40/50 不绘制、40/64 绘制一致）。
// 注意判定用的是「夹取后的字号」：真机把 fontSize 夹到最小字号（默认 10），回读也是 10，
// 所以 8/16 不绘制（按 10 算 ⇒ 19 > 16）；模拟器的绘制路径同样先 Math.max(10, fontSize) 再判。
export const TEXT_MIN_HEIGHT_FACTOR = 1.5
export const TEXT_MIN_HEIGHT_PADDING = 4
// 真机 fontSize 下限（受控件 minimumFontSize 影响，实测默认夹到 10）
export const TEXT_MIN_FONT_SIZE = 10

export function textBoxTooShortToDraw(fontSize, height) {
  const font = Number(fontSize)
  const box = Number(height)
  if (!Number.isFinite(font) || !Number.isFinite(box) || font <= 0 || box <= 0) return false
  return box < font * TEXT_MIN_HEIGHT_FACTOR + TEXT_MIN_HEIGHT_PADDING
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
