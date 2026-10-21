import test from 'node:test'
import assert from 'node:assert/strict'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { Container, DOMAdapter, Matrix } from 'pixi.js'
import { createRuntime } from '../../client/lua-runtime/src/index.js'
import { createStudio } from '../index.js'
import { parseRichText } from '../play/rich-text.js'
import { textLayout } from '../play/text-layout.js'
import { drawRichText, paintRichTextCanvas } from '../play/rich-text-paint.js'
import { localFontStack } from '../host/local-font.js'
import { paintList, playSnapshot } from '../play/session.js'
import { renderScenePng, renderPaintPng } from '../host-png.js'
import { PixiPlayRenderer } from '../play/pixi-renderer.js'
import { layoutTree } from '../ui/inspector.js'
import { importGia, exportGia } from '../gia/codec.js'
import { walk } from '../ui/authoring.js'
import { DEFAULT_FONT } from '../fonts.js'

test('Unity basic tags nest, restore inherited styles and decode RGBA independently of control ARGB', () => {
  const result = parseRichText('a<color="red">b<i>c<b>d</b></i><color=#12345680>e</color>f</color>g<size=12>h</size>i')
  assert.equal(result.text, 'abcdefghi')
  const style = text => result.runs.find(run => run.text.includes(text))
  assert.equal(style('a').color, null)
  assert.equal(style('b').color, 0xffff0000)
  assert.equal(style('c').italic, true)
  assert.deepEqual([style('d').italic, style('d').bold], [true, true])
  assert.equal(style('e').color, 0x80123456)
  assert.deepEqual([style('f').color, style('f').italic, style('f').bold], [0xffff0000, false, false])
  assert.equal(style('g').color, null)
  assert.equal(style('h').size, 12)
  assert.equal(style('i').size, null)
  for (const [value, color] of [['green', 0xff008000], ['lime', 0xff00ff00], ['darkblue', 0xff0000a0],
    ['#FF0000', 0xffff0000], ['#00FF0000', 0x0000ff00], ["'cyan'", 0xff00ffff]]) {
    assert.equal(parseRichText(`<COLOR=${value}>x</COLOR>`).runs[0].color, color)
  }
  const nested = parseRichText('<size=30>A<size=12>B</size>C</size>D').runs
  assert.deepEqual(nested.map(run => run.size), [30, 12, 30, null])
})

test('unsupported, invalid, unclosed and crossing tags remain literal; text is never HTML-decoded', () => {
  for (const text of ['<b>open', '</i>orphan', '<b><i>cross</b></i>', '<color = red>x</color>',
    '<color=unknown>x</color>', '<color=#fff>x</color>', '<size=0>x</size>', '<size=-3>x</size>',
    '<size=1.5>x</size>', '<size=120%>x</size>', '<size=+2>x</size>', '<size=Infinity>x</size>',
    '<u>x</u>', '<img src=x onerror=alert(1)>', '2 < 3 &amp; 4 > 1', '<b', '<size="12\">x']) {
    const result = parseRichText(text)
    assert.equal(result.text, text)
    assert.equal(result.rich, false)
  }
  assert.equal(parseRichText('<b>A<unknown>B</unknown>C</b>').text, 'A<unknown>B</unknown>C')
  assert.equal(parseRichText('<b></b>').text, '')
  assert.equal(parseRichText('<i>中\r\n😀</i>').text, '中\n😀')
})

test('tag-free wrapping, absolute sizes and mixed-height autosizing use measured styled runs', () => {
  const base = { kind: 'textbox', text: '测试 AB测试 AB测试 AB', fontSize: 20 }
  const plain = textLayout(base, 80, 100)
  const color = textLayout({ ...base, text: `<color=red>${base.text}</color>` }, 80, 100)
  assert.deepEqual(color.lines, plain.lines, 'markup length must not influence wrapping')
  const explicit = textLayout({ ...base, text: '<size=12>ABABAB</size>' }, 40, 100)
  assert.deepEqual(explicit.lines, textLayout({ ...base, fontSize: 12, text: 'ABABAB' }, 40, 100).lines)
  assert.ok(explicit.richLines.every(line => line.runs.every(run => run.fontSize === 12)))
  const styled = textLayout({ ...base, text: '<b><i>AB</i></b>' }, 100, 100)
  const ctx = createCanvas(1, 1).getContext('2d')
  ctx.font = `italic bold 20px ${localFontStack()}`
  assert.ok(Math.abs(styled.richLines[0].width - ctx.measureText('AB').width) < 0.01)
  const auto = textLayout({ ...base, text: '<color=red>A\nB</color>', fontSize: 40,
    minimumFontSize: 10, adaptiveFontSize: true }, 160, 40)
  assert.equal(auto.fontSize, 13, 'two colored lines obey the existing independent 38.45px fit boundary')
  const mixed = textLayout({ ...base, text: '<size=30>A</size>\nB', fontSize: 40,
    minimumFontSize: 10, adaptiveFontSize: true }, 160, 60)
  assert.equal(mixed.fontSize, 10)
  assert.deepEqual(mixed.richLines.map(line => line.height), [36, 12])
  assert.equal(mixed.requiredHeight, 59.5)
  const empty = textLayout({ ...base, text: '<b></b>', adaptiveFontSize: true }, 0, 0)
  assert.equal(empty.requiredHeight, 0)
  assert.equal(empty.fontSize, 20)
  assert.equal(textLayout(base, 80, 100), plain, 'unchanged text keeps its per-control cache')
})

function fixture(t, kind = 'textbox') {
  const runtime = createRuntime({ canvasWidth: 240, canvasHeight: 160 })
  t.after(() => runtime.destroy())
  const label = runtime.addRoot({ kind, name: 'Label', active: true, visible: true,
    sizeDeltaX: 200, sizeDeltaY: 100, text: '<color=red>R</color><color=#00ff0080>G</color><i>I</i><size=12>s</size>',
    fontSize: 32, fontColor: 0xff0000ff, bgColor: 0, enableOutline: false,
    horizontalAlignment: 'Left', verticalAlignment: 'Top', showScrollBar: false })
  const session = { runtime, compiled: { canvasId: 'pc-16-9', platform: 'PC' }, history: [] }
  return { runtime, label, session }
}

test('PNG paints color/alpha and fallback color, flat/tree match, Lua updates retain original text', async t => {
  const { runtime, label, session } = fixture(t)
  const scene = playSnapshot(session, { view: true }).scene
  const png = renderScenePng(scene, 240, 160, { background: 'transparent' }).data
  assert.deepEqual(png, renderPaintPng(paintList(session), 240, 160, { background: 'transparent' }).data)
  const ctx = createCanvas(240, 160).getContext('2d')
  ctx.drawImage(await loadImage(png), 0, 0)
  const data = ctx.getImageData(0, 0, 240, 160).data
  let red = 0, green = 0, blue = 0
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] > 240 && data[i + 1] < 10 && data[i + 3] > 240) red++
    if (data[i + 1] > 240 && data[i] < 10 && Math.abs(data[i + 3] - 128) <= 1) green++
    if (data[i + 2] > 240 && data[i] < 10 && data[i + 3] > 240) blue++
  }
  assert.ok(red > 10 && green > 10 && blue > 10, JSON.stringify({ red, green, blue }))
  assert.ok(label.text.includes('<color=red>'), 'layout never strips the runtime string')
  runtime.mountScript({ path: 'rich-update', control: label,
    source: 'function OnStart() script.object.text = "<b><size=24>New</size></b>" end' })
  const update = playSnapshot(session, { view: true, sceneRev: scene.revision }).scene
  assert.equal(update.reset, false)
  assert.deepEqual(update.changed[0].textLayout.lines, ['New'])
  assert.equal(update.changed[0].textLayout.richLines[0].runs[0].bold, true)
  assert.deepEqual(runtime.mountErrors, [])
})

test('mixed-size text windows scroll by actual line heights and redraw at the clipped viewport', t => {
  const { label, session } = fixture(t, 'textwindow')
  label.sizeDeltaY = 40
  label.text = '<size=30>A</size>\n<size=10>B</size>\n<size=20>C</size>'
  let scene = playSnapshot(session, { view: true }).scene
  assert.equal(scene.nodes[0].scroll.contentLength, 72)
  assert.equal(scene.nodes[0].scroll.max, 32)
  const before = renderScenePng(scene, 240, 160).data
  label._scrollOffset = 32
  label.markPlayDirty()
  scene = playSnapshot(session, { view: true }).scene
  assert.equal(scene.nodes[0].scroll.offset, 32)
  assert.equal(before.equals(renderScenePng(scene, 240, 160).data), false)
})

test('all nine alignments use one baseline per mixed-size line and preserve outline drawing', () => {
  const item = { kind: 'textbox', text: '<size=30>A</size><size=12>B</size>', fontSize: 20,
    enableOutline: true, outlineColor: 0xff123456 }
  item.textLayout = textLayout(item, 160, 80)
  const line = item.textLayout.richLines[0], calls = [], strokes = []
  const ctx = { save() {}, restore() {}, beginPath() {}, rect() {}, clip() {},
    fillText(...args) { calls.push(args) }, strokeText(...args) { strokes.push(args) } }
  for (const [horizontal, factorX] of [['Left', 0], ['Middle', 0.5], ['Right', 1]]) {
    for (const [vertical, factorY] of [['Top', 0], ['Middle', 0.5], ['Bottom', 1]]) {
      calls.length = strokes.length = 0
      drawRichText(ctx, { ...item, horizontalAlignment: horizontal, verticalAlignment: vertical }, 160, 80)
      assert.equal(calls[0][1], 2 + factorX * (156 - line.width))
      assert.equal(calls[0][2], factorY * 44 + line.baseline)
      assert.equal(calls[1][2], calls[0][2])
      assert.deepEqual(strokes, calls)
    }
  }
  drawRichText(ctx, item, 160, 80, null)
  assert.equal(ctx.font, `12px ${DEFAULT_FONT}`, 'system-font mode returns null from loadBrowserFont')
})

test('JSON/GIA preserve markup while editor layout exposes styled lines', () => {
  const studio = createStudio(), text = '<color=red><i>测试</i></color><size=12>small</size>'
  studio.patch({ op: 'set', id: 'n2', key: 'text', value: text })
  const archive = studio.archiveData()
  const root = archive.assets.server.root
  const box = layoutTree(root, archive.assets.server.canvasId).boxes.n2
  assert.equal(box.text, text)
  assert.deepEqual(box.textLayout.lines.join(''), '测试small')
  assert.equal(box.textLayout.richLines[0].runs[0].italic, true)
  const reloaded = createStudio(archive)
  assert.equal(reloaded.get().boxes.find(node => node.id === 'n2').text, text)
  const restored = importGia(exportGia(archive.assets.server).buffer).project
  const texts = []
  walk(restored.root, node => { if (node.kind === 'textbox') texts.push(node.text) })
  assert.ok(texts.includes(text), 'GIA preserves the exact tag string, not the rendered text')
})

test('Pixi rich text reuses its canvas/texture, switches plain/rich and releases owned resources', async t => {
  const previous = DOMAdapter.get()
  DOMAdapter.set({ ...previous, createCanvas })
  const renderer = Object.create(PixiPlayRenderer.prototype)
  Object.assign(renderer, { ready: Promise.resolve(), nodes: new Map(), scratch: new Matrix(), canvasWidth: 240, canvasHeight: 160,
    app: { stage: new Container(), render() {}, renderer: { resize() {}, resolution: 1 } } })
  t.after(() => { renderer.clearNodes(); DOMAdapter.set(previous) })
  const { label, session } = fixture(t)
  let scene = playSnapshot(session, { view: true }).scene
  await renderer.applyScene(scene, 240, 160)
  const root = renderer.nodes.get(label.Id), visual = root.__visual, texture = visual.__richText.texture, source = texture.source
  const initial = source.resource.toBuffer('image/png')
  label.text = '<color=yellow><b>changed</b></color>'
  label.markPlayDirty()
  scene = playSnapshot(session, { view: true, sceneRev: scene.revision }).scene
  await renderer.applyScene(scene, 240, 160)
  assert.equal(root.__visual, visual)
  assert.equal(root.__visual.__richText.texture, texture)
  assert.equal(source.resource.toBuffer('image/png').equals(initial), false)
  label.text = 'plain'
  label.markPlayDirty()
  scene = playSnapshot(session, { view: true, sceneRev: scene.revision }).scene
  await renderer.applyScene(scene, 240, 160)
  assert.equal(texture.destroyed, true)
  assert.equal(source.destroyed, true)
  assert.equal(root.__visual.__text.text, 'plain')
  const plain = root.__visual.__text
  label.text = '<i>rich again</i>'
  label.markPlayDirty()
  await renderer.applyScene(playSnapshot(session, { view: true, sceneRev: scene.revision }).scene, 240, 160)
  assert.equal(plain.destroyed, true)
  const lastSource = root.__visual.__richText.texture.source
  renderer.clearNodes()
  assert.equal(lastSource.destroyed, true)
  const canvas = createCanvas(1, 1)
  paintRichTextCanvas(canvas, { textLayout: { richLines: [], contentHeight: 0 } }, 10_000, 50, undefined, 2)
  assert.equal(canvas.width, 4096, 'large controls use a bounded viewport texture')
})
