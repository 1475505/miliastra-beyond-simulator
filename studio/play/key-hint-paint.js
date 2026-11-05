// Shared editor/PNG/Pixi approximation of the creator's native keycap images.
// A single key is 40×40; long labels and chords grow horizontally. Geometry
// never writes back to the control's RectTransform or its input hit area.
const FONT = '"Times New Roman", "Microsoft YaHei", serif'
const textWidth = text => [...text].reduce((sum, c) => sum + (/[^\x00-\x7f]/.test(c) ? 24 : /[ilIt]/.test(c) ? 8 : /[mwMW]/.test(c) ? 21 : 14), 0)
function tokenWidth(token) {
  if (token.type === 'plus') return 26
  if (token.type === 'key') return Math.max(40, textWidth(token.label) + 16)
  return 40
}

export function keyHintSize(item, width, height) {
  const tokens = item.keyHint?.tokens || []
  if (!(width > 0 && height > 0) || !tokens.length) return { width: 0, height: 0 }
  const natural = tokens.reduce((sum, token) => sum + tokenWidth(token), 0) + Math.max(0, tokens.length - 1) * 4
  return { width: Math.max(width, natural * height / 40), height }
}

function rounded(ctx, x, y, w, h, radius, fill, stroke = '#bfc0c1') {
  ctx.beginPath(); ctx.roundRect(x, y, w, h, radius)
  ctx.fillStyle = fill; ctx.fill()
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1.5; ctx.stroke() }
}

function label(ctx, text, x, y, width, color = '#292b2c', size = 26) {
  ctx.font = `bold ${size}px ${FONT}`
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = color
  ctx.fillText(text, x + width / 2, y + 20, Math.max(1, width - 10))
}

function drawToken(ctx, token, x, width) {
  if (token.type === 'plus') { label(ctx, '+', x, 0, width, '#858687', 34); return }
  if (token.type === 'dpad') {
    for (const [direction, angle] of [['up', 0], ['right', Math.PI / 2], ['down', Math.PI], ['left', -Math.PI / 2]]) {
      ctx.save(); ctx.translate(x + 20, 20); ctx.rotate(angle)
      ctx.beginPath(); ctx.moveTo(-6, -18); ctx.lineTo(6, -18); ctx.lineTo(6, -8); ctx.lineTo(0, -2); ctx.lineTo(-6, -8); ctx.closePath()
      ctx.fillStyle = direction === token.direction ? '#ffffff' : '#303333'; ctx.fill()
      ctx.strokeStyle = '#a7aaaa'; ctx.lineWidth = 1; ctx.stroke(); ctx.restore()
    }
    return
  }
  if (token.type === 'face' || token.type === 'stick') {
    ctx.beginPath(); ctx.arc(x + 20, 20, 18, 0, Math.PI * 2)
    ctx.fillStyle = '#292d2e'; ctx.fill(); ctx.strokeStyle = '#c4c5c5'; ctx.lineWidth = 1.5; ctx.stroke()
    label(ctx, token.label, x, 0, width, { A: '#92c94c', B: '#e36859', X: '#59b2e2', Y: '#efcc3e' }[token.label] || '#ffffff', token.type === 'stick' ? 19 : 26)
    if (token.type === 'stick') { ctx.strokeStyle = '#ffffff'; ctx.beginPath(); ctx.moveTo(x + 15, 31); ctx.lineTo(x + 20, 35); ctx.lineTo(x + 25, 31); ctx.stroke() }
    return
  }
  if (token.type === 'mouse') {
    rounded(ctx, x + 7, 2, 26, 36, 11, '#ffffff')
    ctx.save(); ctx.beginPath(); ctx.roundRect(x + 9, 4, 22, 32, 9); ctx.clip()
    ctx.fillStyle = '#383b3c'; ctx.fillRect(x + (token.side === 'right' ? 20 : 9), 4, 11, 14); ctx.restore()
    ctx.strokeStyle = '#a8aaab'; ctx.beginPath(); ctx.moveTo(x + 20, 3); ctx.lineTo(x + 20, 19); ctx.stroke()
    return
  }
  if (token.type === 'shoulder') {
    // Shoulder/trigger silhouettes are an approximation of the supplied icons.
    ctx.beginPath(); ctx.moveTo(x + 6, 7); ctx.quadraticCurveTo(x + 20, 2, x + 37, 6)
    ctx.lineTo(x + 37, 30); ctx.quadraticCurveTo(x + 36, 35, x + 28, 35)
    ctx.lineTo(x + 2, 35); ctx.lineTo(x + 7, 22); ctx.closePath()
    ctx.fillStyle = '#ffffff'; ctx.fill(); ctx.strokeStyle = '#bfc0c1'; ctx.lineWidth = 1.5; ctx.stroke()
    label(ctx, token.label, x, 1, width, '#292b2c', 21)
    return
  }
  rounded(ctx, x + 1, 2, width - 2, 36, 6, '#ffffff')
  label(ctx, token.label, x, 0, width, token.type === 'unknown' ? '#8c6060' : '#292b2c', token.label.length === 1 ? 29 : 24)
}

export function drawKeyHint(ctx, item, width, height) {
  const size = keyHintSize(item, width, height)
  if (!size.width) return
  const tokens = item.keyHint.tokens, scale = height / 40
  const natural = tokens.reduce((sum, token) => sum + tokenWidth(token), 0) + (tokens.length - 1) * 4
  ctx.save(); ctx.scale(scale, scale)
  let x = -natural / 2
  if (tokens.length === 1 && tokens[0].type === 'key') {
    drawToken(ctx, tokens[0], -size.width / scale / 2, size.width / scale)
  } else for (const token of tokens) { drawToken(ctx, token, x, tokenWidth(token)); x += tokenWidth(token) + 4 }
  ctx.restore()
}

export function paintKeyHintCanvas(canvas, item, width, height, resolution = 1) {
  const size = keyHintSize(item, width, height)
  const scale = Math.min(Math.max(1, resolution), 4096 / Math.max(1, size.width, size.height))
  const w = Math.max(1, Math.ceil(size.width * scale)), h = Math.max(1, Math.ceil(size.height * scale))
  if (canvas.width !== w) canvas.width = w
  if (canvas.height !== h) canvas.height = h
  const ctx = canvas.getContext('2d')
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, w, h)
  if (size.width) {
    ctx.save(); ctx.scale(w / size.width, h / size.height); ctx.translate(size.width / 2, size.height / 2 - height / 2)
    drawKeyHint(ctx, item, width, height); ctx.restore()
  }
  return size
}
