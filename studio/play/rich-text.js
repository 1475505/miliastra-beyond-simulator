// Unity legacy UI Rich Text subset. Keep the original string in the model;
// only presentation consumes these runs. Unknown/malformed markup stays text.
const COLORS = Object.freeze({
  aqua: '00ffff', black: '000000', blue: '0000ff', brown: 'a52a2a', cyan: '00ffff',
  darkblue: '0000a0', fuchsia: 'ff00ff', green: '008000', grey: '808080', lightblue: 'add8e6',
  lime: '00ff00', magenta: 'ff00ff', maroon: '800000', navy: '000080', olive: '808000',
  orange: 'ffa500', purple: '800080', red: 'ff0000', silver: 'c0c0c0', teal: '008080',
  white: 'ffffff', yellow: 'ffff00',
})

function colorValue(value) {
  const hex = Object.hasOwn(COLORS, value.toLowerCase()) ? COLORS[value.toLowerCase()] : value.slice(1)
  if (!Object.hasOwn(COLORS, value.toLowerCase()) && !/^#[\da-f]{6}([\da-f]{2})?$/i.test(value)) return null
  // Tags are RGBA; the simulator's control colors are ARGB.
  return ((parseInt(hex.slice(6) || 'ff', 16) << 24) | parseInt(hex.slice(0, 6), 16)) >>> 0
}

function tag(raw) {
  const close = /^<\/(b|i|color|size)>$/i.exec(raw)
  if (close) return { name: close[1].toLowerCase(), close: true }
  const simple = /^<(b|i)>$/i.exec(raw)
  if (simple) return { name: simple[1].toLowerCase(), value: true }
  const parameter = /^<(color|size)=(?:"([^"\s<>]+)"|'([^'\s<>]+)'|([^\s'"<>]+))>$/i.exec(raw)
  if (!parameter) return null
  const name = parameter[1].toLowerCase(), value = parameter[2] ?? parameter[3] ?? parameter[4]
  if (name === 'color') {
    const color = colorValue(value)
    return color === null ? null : { name, value: color }
  }
  // Positive absolute pixel sizes only (not TMP's relative/percentage syntax).
  const size = Number(value)
  return /^\d+$/.test(value) && Number.isSafeInteger(size) && size > 0 ? { name, value: size } : null
}

export function parseRichText(value) {
  const source = String(value ?? '').replace(/\r\n?/g, '\n')
  const tokens = [], stack = []
  let cursor = 0
  for (const match of source.matchAll(/<[^<>\r\n]*>/g)) {
    if (match.index > cursor) tokens.push({ text: source.slice(cursor, match.index) })
    const token = { text: match[0], tag: tag(match[0]), paired: false }
    tokens.push(token)
    cursor = match.index + match[0].length
    if (!token.tag) continue
    if (!token.tag.close) stack.push(token)
    else if (stack.at(-1)?.tag.name === token.tag.name) {
      stack.pop().paired = token.paired = true
    } else {
      // Crossing closures invalidate the still-open chain rather than silently
      // swallowing text or leaking a style into the rest of the control.
      stack.length = 0
    }
  }
  if (cursor < source.length) tokens.push({ text: source.slice(cursor) })
  const runs = [], styles = [{ bold: false, italic: false, size: null, color: null }]
  let rich = false
  for (const token of tokens) {
    if (token.paired) {
      rich = true
      if (token.tag.close) styles.pop()
      else {
        const key = { b: 'bold', i: 'italic', size: 'size', color: 'color' }[token.tag.name]
        styles.push({ ...styles.at(-1), [key]: token.tag.value })
      }
    } else if (token.text) {
      const style = styles.at(-1), previous = runs.at(-1)
      if (previous && ['bold', 'italic', 'size', 'color'].every(key => previous[key] === style[key])) previous.text += token.text
      else runs.push({ text: token.text, ...style })
    }
  }
  return { rich, text: runs.map(run => run.text).join(''), runs }
}

export function richFont(run, family) {
  return `${run.italic ? 'italic ' : ''}${run.bold ? 'bold ' : ''}${run.fontSize}px ${family}`
}
