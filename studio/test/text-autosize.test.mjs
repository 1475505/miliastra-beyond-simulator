import test from 'node:test'
import assert from 'node:assert/strict'
import { Container, Matrix, Text } from 'pixi.js'
import { createRuntime } from '../../client/lua-runtime/src/index.js'
import { createStudio } from '../index.js'
import { paintList, playSnapshot } from '../play/session.js'
import { renderPaintPng, renderScenePng } from '../host-png.js'
import { layoutTree } from '../ui/inspector.js'
import { walk } from '../ui/authoring.js'
import { textLayout } from '../play/text-layout.js'
import { textPreviewStyle } from '../../editor-ui/text-preview.js'

function fixture(t, kind = 'textbox', extra = {}) {
  const runtime = createRuntime({ canvasWidth: 240, canvasHeight: 160 })
  t.after(() => runtime.destroy())
  const label = runtime.addRoot({ kind, name: 'Label', active: true, visible: true,
    sizeDeltaX: 160, sizeDeltaY: 40, text: 'A\nB', fontSize: 40, minimumFontSize: 10,
    adaptiveFontSize: true, enableOutline: false, fontColor: 0xffffffff, bgColor: 0,
    horizontalAlignment: 'Left', verticalAlignment: 'Top', ...extra })
  return { runtime, label, session: { runtime, compiled: { canvasId: 'pc-16-9', platform: 'PC' }, history: [] } }
}

test('two textbox lines fit at 13px including the reported block occupancy, preserving Lua fontSize', t => {
  const { label, session } = fixture(t)
  const node = playSnapshot(session, { view: true }).scene.nodes[0]
  assert.equal(node.adaptiveFontSize, true)
  assert.equal(node.minimumFontSize, 10)
  assert.equal(node.textLayout.fontSize, 13)
  assert.ok(Math.abs(node.textLayout.requiredHeight - 38.45) < 1e-6) // 2 * 13 * 1.2 + 0.25 * 13 + 4
  assert.deepEqual(node.textLayout.lines, ['A', 'B'])
  assert.equal(label.fontSize, 40)
  assert.deepEqual(paintList(session)[0].textLayout, node.textLayout)
  const autoPng = renderScenePng(playSnapshot(session, { view: true }).scene, 240, 160).data
  assert.ok(autoPng.equals(renderPaintPng(paintList(session), 240, 160).data))
  label.adaptiveFontSize = false
  label.fontSize = 13
  label.markPlayDirty()
  assert.ok(autoPng.equals(renderScenePng(playSnapshot(session, { view: true }).scene, 240, 160).data),
    'autosizing must actually rasterize at the manually calculated 13px')
  label.fontSize = 40
  label.markPlayDirty()
  assert.equal(autoPng.equals(renderScenePng(playSnapshot(session, { view: true }).scene, 240, 160).data), false)
})

test('Lua autosize/minimum/size-only changes refresh both scene and Pixi visuals', async t => {
  const { PixiPlayRenderer } = await import('../play/pixi-renderer.js')
  const { runtime, label, session } = fixture(t)
  const renderer = Object.create(PixiPlayRenderer.prototype)
  Object.assign(renderer, { ready: Promise.resolve(), nodes: new Map(), scratch: new Matrix(), canvasWidth: 240, canvasHeight: 160,
    app: { stage: new Container(), render() {}, renderer: { resize() {} } } })
  t.after(() => renderer.clearNodes())
  let scene = playSnapshot(session, { view: true }).scene
  await renderer.applyScene(scene, 240, 160)
  const font = () => renderer.nodes.get(label.Id).__visual.children.find(n => n instanceof Text).style.fontSize
  assert.equal(font(), 13)
  for (const [code, expected] of [
    ['script.object.adaptiveFontSize = false', 40],
    ['script.object.adaptiveFontSize = true; script.object.minimumFontSize = 24', 24],
    ['script.object:SetSizeDelta(160, 120)', 40],
  ]) {
    runtime.mountScript({ path: `autosize-${expected}-${scene.revision}`, control: label, source: `function OnStart() ${code} end` })
    const patch = playSnapshot(session, { view: true, sceneRev: scene.revision }).scene
    assert.equal(patch.reset, false)
    assert.equal(patch.changed.find(n => n.id === label.Id).textLayout.fontSize, expected)
    await renderer.applyScene(patch, 240, 160)
    assert.equal(font(), expected)
    scene = patch
  }
  assert.deepEqual(runtime.mountErrors, [])
  assert.equal(label.fontSize, 40)
})

test('text windows shrink before scrolling and still scroll when the minimum cannot fit', t => {
  const { label, session } = fixture(t, 'textwindow')
  let node = playSnapshot(session, { view: true }).scene.nodes[0]
  assert.equal(node.scroll.fontSize, 16)
  assert.equal(node.scroll.max, 0)
  label.minimumFontSize = 30
  label.markPlayDirty()
  node = playSnapshot(session, { view: true }).scene.nodes[0]
  assert.equal(node.scroll.fontSize, 30)
  assert.equal(node.scroll.max, 32) // 2 * 30 * 1.2 - 40
  label.minimumFontSize = 10
  label._scrollOffset = 20
  label.markPlayDirty()
  node = playSnapshot(session, { view: true }).scene.nodes[0]
  assert.equal(node.scroll.max, 0)
  assert.equal(node.scroll.offset, 0)
})

test('editor layout includes autosize without mutating the saved font setting', () => {
  const studio = createStudio()
  for (const [key, value] of Object.entries({ text: 'A\nB', fontSize: 40, minimumFontSize: 10, adaptiveFontSize: true, width: 160, height: 40 })) {
    studio.patch({ op: 'set', id: 'n2', key, value })
  }
  const parsed = studio.archiveData().assets.server
  const { boxes } = layoutTree(parsed.root, parsed.canvasId)
  assert.equal(boxes.n2.fontSize, 40)
  assert.equal(boxes.n2.adaptiveFontSize, true)
  assert.equal(boxes.n2.textLayout.fontSize, 13)
  assert.equal(textPreviewStyle(boxes.n2, 0.5).fontSize, '6.5px')
  assert.equal(textPreviewStyle(boxes.n2, 2).fontSize, '26px')
  assert.equal(textPreviewStyle(boxes.n2, 1).whiteSpace, 'pre')
})

test('size bounds, width wrapping, text changes and local scale behave consistently', () => {
  const item = { kind: 'textbox', text: '测试测试测试测试', fontSize: 40, minimumFontSize: 6, adaptiveFontSize: true }
  const narrow = textLayout(item, 44, 40)
  assert.ok(narrow.fontSize < 40 && narrow.fits)
  assert.ok(narrow.lines.length > 1)
  assert.equal(textLayout(item, 44, 40), narrow, 'unchanged inputs reuse the measurement')
  item.localScaleX = 2
  item.localRotationY = 50
  assert.equal(textLayout(item, 44, 40), narrow, 'projection must not reduce the local fitting box')
  const wide = textLayout(item, 500, 100)
  assert.equal(wide.fontSize, 40)
  item.text = 'A\r\nB'
  assert.deepEqual(textLayout(item, 160, 40).lines, ['A', 'B'])
  item.minimumFontSize = 30
  assert.equal(textLayout(item, 160, 40).fontSize, 30)
  item.minimumFontSize = 60
  assert.equal(textLayout(item, 160, 40).fontSize, 40, 'minimum cannot enlarge the requested font')
  item.fontSize = 5
  assert.equal(textLayout(item, 160, 40).fontSize, 5, 'small font settings are not clamped to 8px')
  item.text = ''
  assert.deepEqual(textLayout(item, 0, 0).lines, [''])
  assert.equal(textLayout(item, 0, 0).fontSize, 5)
})

test('autosize-only edits keep an inactive asset in the GIA package', () => {
  for (const [key, value] of [['adaptiveFontSize', true], ['minimumFontSize', 10]]) {
    const archive = createStudio().archiveData()
    assert.equal(archive.activeAssetType, 'server-control-template')
    walk(archive.assets.client.root, node => { if (node.kind === 'textbox') node[key] = value })
    const result = createStudio(archive).exportData('save-gia')
    assert.ok(result.files.some(file => file.filename.includes('客户端控件模板')), key)
  }
})

test('textbox occupancy follows the accepted measurement points without imposing it on scroll windows', () => {
  // Independent heights transcribed/calculated from the #19 report. Font ink
  // bounds are not these heights; the extra occupancy only governs fitting.
  for (const [fontSize, text, fitsAt, tooShort] of [
    [16, 'A', 28, 26], [16, 'A\nB', 47, 46], [20, 'A\nB', 57, 56],
    [24, 'A', 41, 36], [40, 'A', 64, 50], [60, 'A', 96, 70],
  ]) {
    const item = { kind: 'textbox', fontSize, text }
    assert.equal(textLayout(item, 300, tooShort).fits, false, `${fontSize}/${tooShort}`)
    assert.equal(textLayout(item, 300, fitsAt).fits, true, `${fontSize}/${fitsAt}`)
  }
  const textbox = { kind: 'textbox', fontSize: 16, text: 'A' }
  assert.equal(textLayout(textbox, 160, 27.2).fits, true, 'inclusive fractional boundary')
  const window = textLayout({ ...textbox, kind: 'textwindow' }, 160, 20)
  assert.equal(window.blockInset, 0)
  assert.equal(window.requiredHeight, 19.2)
  assert.equal(window.fits, true)
  const empty = textLayout({ kind: 'textbox', fontSize: 40, minimumFontSize: 10, adaptiveFontSize: true, text: '' }, 0, 0)
  assert.equal(empty.requiredHeight, 0)
  assert.equal(empty.fontSize, 40, 'empty content has no fitting requirement')
})
