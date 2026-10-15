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

// 文本视窗（滚动文本）的可见行：只取「整行都放得下」的行。
// 「字号测试」第 7 页实测（offset=0）：16px 高 45 → 2 行、46 → 2 行、69 → 3 行、90 → 3/4 行；
// 20px 高 57/58 → 2 行；10px 高 30/35 → 2 行 —— 即 floor(框高 / 行距)，
// 且第 3 行是整行不画（不是露出半截），和文本框一样「放不下就不画」。
export function visibleTextLines(scroll, height) {
  const line = scroll.lineHeight
  const first = Math.max(0, Math.ceil((scroll.offset - 0.01) / line))
  const last = Math.min(scroll.lines.length, Math.floor((scroll.offset + height + 0.01) / line))
  return { text: scroll.lines.slice(first, Math.max(first, last)).join('\n'), y: first * line }
}

// 文本框「放得下就画」的真机口径 —— 三十多个实测点被同一条式子全中：
//
//   可画行数 = floor( (框高 − (0.25×字号 + 4)) / (1.2×字号) )，行距（绘制）= 1.2×字号
//
// 0 行 ⇔ 整段文字不绘制（底色照画，控件尺寸/对齐/text 回读都正常）。也就是说
// 「高度不足整段不画」不是独立规则，而是这条式子 n=0 时的自然结果。
//
// 拟合用到的点（字号/高度 → 真机行数），全部来自真机「字号测试」工程的截图逐像素测量：
//   16：16 20 24 26 → 0 ｜ 28 30 32 36 38 40 43 45 46 → 1 ｜ 47 48 57 58 60 → 2 ｜ 68 69 90 → 3
//   20：30 → 0 ｜ 55 56 → 1 ｜ 57 58 59 → 2
//   24：36 → 0 ｜ 41 48 → 1        40：40 45 50 → 0 ｜ 64 66 68 70 → 1
//   60：70 → 0 ｜ 96 → 1           10：16 → 0 ｜ 20 24 30 → 1 ｜ 33 35 → 2
// 行距由「字号测试」第 6 页直接量像素得出（真机 UI 缩放 1.2，用框宽 456 = 380×1.2 校准）：
// 16px 三行文本行带起点在框内 22/45/68 px，间距 23px ⇒ ÷1.2 = 19.2 = 1.2×16；两行文本 33/56 同理。
// 行块居中（第 6 页 9 张卡逐张量过：块距框顶 = (框高 − 块高)/2，Middle 生效）。
// 判定前字号先被夹到最小字号（实测下限 10、回读也是 10），所以 8/16 是 0 行。
export const TEXT_LINE_HEIGHT_FACTOR = 1.2
export const TEXT_BLOCK_INSET_FACTOR = 0.25
export const TEXT_BLOCK_INSET = 4
// 真机 fontSize 下限（受控件 minimumFontSize 影响，实测默认夹到 10）
export const TEXT_MIN_FONT_SIZE = 10

export function textLineHeight(fontSize) {
  const font = Number(fontSize)
  if (!Number.isFinite(font) || font <= 0) return 0
  return font * TEXT_LINE_HEIGHT_FACTOR
}

// 文本框整块额外占位：0.25×字号 + 4px（拟合出来的首行上下留白）
export function textBlockInset(fontSize) {
  const font = Number(fontSize)
  if (!Number.isFinite(font) || font <= 0) return 0
  return font * TEXT_BLOCK_INSET_FACTOR + TEXT_BLOCK_INSET
}

// 能画出几行；0 表示整段不画。
export function visibleTextLineCount(fontSize, height) {
  const line = textLineHeight(fontSize)
  const box = Number(height)
  if (line <= 0 || !Number.isFinite(box) || box <= 0) return 0
  return Math.max(0, Math.floor((box - textBlockInset(fontSize)) / line))
}

// 整段不绘制 ⇔ 一行都放不下
export function textBoxTooShortToDraw(fontSize, height) {
  const font = Number(fontSize)
  const box = Number(height)
  if (!Number.isFinite(font) || !Number.isFinite(box) || font <= 0 || box <= 0) return false
  return visibleTextLineCount(font, box) === 0
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
