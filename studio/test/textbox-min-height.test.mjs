// 文本框「高度不足 2×字号 ⇒ 整段文字不绘制」的真机口径。
// 真机实测（客户端脚本回读 text/字号/宽高 + 截图确认）：
//   字号 20 / 控件高 30（1.5×）⇒ 无字；字号 20 / 高 40（2.0×）⇒ 有字；字号 10 / 高 30（3×）⇒ 有字。
// 这里覆盖三处：纯函数边界、host-png 出图（像素）、pixi 视觉树（节点数）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { Container, Matrix, Text } from 'pixi.js'
import { createRuntime } from '../../client/lua-runtime/src/index.js'
import { paintList, playSnapshot } from '../play/session.js'
import { renderScenePng } from '../host-png.js'
import { PixiPlayRenderer } from '../play/pixi-renderer.js'
import { textBoxTooShortToDraw, TEXT_MIN_HEIGHT_RATIO } from '../play/scroll-geometry.js'

test('阈值常量为 2（真机边界落在 1.5~2 之间，取 2 复习实测现象）', () => {
  assert.equal(TEXT_MIN_HEIGHT_RATIO, 2)
})

test('textBoxTooShortToDraw：真机三组实测值', () => {
  assert.equal(textBoxTooShortToDraw(20, 30), true, '字号 20 / 高 30（1.5×）无字')
  assert.equal(textBoxTooShortToDraw(20, 40), false, '字号 20 / 高 40（2.0×）有字')
  assert.equal(textBoxTooShortToDraw(10, 30), false, '字号 10 / 高 30（3.0×）有字')
})

test('textBoxTooShortToDraw：正好 2 倍仍绘制，稍微不足即不绘制', () => {
  assert.equal(textBoxTooShortToDraw(16, 32), false)
  assert.equal(textBoxTooShortToDraw(16, 31.9), true)
})

test('textBoxTooShortToDraw：非法输入不误判为「不绘制」', () => {
  for (const [font, height] of [[NaN, 30], [20, NaN], [20, undefined], [0, 30], [20, 0], [-4, 30]]) {
    assert.equal(textBoxTooShortToDraw(font, height), false, `${font} / ${height}`)
  }
})

// ---- 渲染路径 ----

function fixture(t, sizeDeltaY, overrides = {}) {
  const runtime = createRuntime({ canvasWidth: 240, canvasHeight: 160 })
  t.after(() => runtime.destroy())
  const base = (name, y) => ({
    name, kind: 'textbox', active: true, visible: true,
    sizeDeltaX: 160, sizeDeltaY: y,
    anchorMinX: 0.5, anchorMaxX: 0.5, anchorMinY: 0.5, anchorMaxY: 0.5, pivotX: 0.5, pivotY: 0.5,
    text: 'ABCDEFGHIJ', fontSize: 20, fontColor: 0xffffffff, bgColor: 0,
    enableOutline: false, horizontalAlignment: 'Middle', verticalAlignment: 'Middle', children: [],
    ...overrides,
  })
  runtime.addRoot({
    name: 'Root', kind: 'container', active: true, visible: true,
    sizeDeltaX: 240, sizeDeltaY: 160,
    anchorMinX: 0.5, anchorMaxX: 0.5, anchorMinY: 0.5, anchorMaxY: 0.5, pivotX: 0.5, pivotY: 0.5,
    children: [base('Label', sizeDeltaY)],
  })
  assert.deepEqual(runtime.mountErrors, [])
  return { runtime, session: { runtime, compiled: { canvasId: 'pc-16-9', platform: 'PC' }, history: [] } }
}

async function whitePixels(png, width, height) {
  const canvas = createCanvas(width, height)
  const context = canvas.getContext('2d')
  context.drawImage(await loadImage(png.data), 0, 0)
  const { data } = context.getImageData(0, 0, width, height)
  let visible = 0
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] > 200 && data[i + 1] > 200 && data[i + 2] > 200) visible += 1
  }
  return visible
}

test('host-png：高 30 / 字号 20 ⇒ 一个文字像素都不画', async t => {
  const { session } = fixture(t, 30)
  const paint = paintList(session).find((item) => item.name === 'Label')
  assert.equal(paint.fontSize, 20, '裁掉的是绘制，字号本身不变')
  const scene = playSnapshot(session, { view: true }).scene
  const pixels = await whitePixels(renderScenePng(scene, 240, 160), 240, 160)
  assert.equal(pixels, 0, '高不足 2×字号时应无字形')
})

test('host-png：高 40 / 字号 20 ⇒ 文字正常绘制', async t => {
  const { session } = fixture(t, 40)
  const scene = playSnapshot(session, { view: true }).scene
  const pixels = await whitePixels(renderScenePng(scene, 240, 160), 240, 160)
  assert.ok(pixels > 10, `高 40 时应画得出字，实际白像素 ${pixels}`)
})

test('pixi：高不足 2×字号时只留底色，不建 Text 节点', t => {
  const renderer = Object.create(PixiPlayRenderer.prototype)
  renderer.scratch = new Matrix()
  renderer.canvasHeight = 720
  const build = (height) => {
    const root = new Container()
    t.after(() => root.destroy({ children: true }))
    renderer.updateNode(root, {
      id: 1, kind: 'textbox', text: 'ABC', fontSize: 20, sourceWidth: 160, sourceHeight: height,
      fontColor: 0xffffffff, bgColor: 0x88000000, enableOutline: false,
      horizontalAlignment: 'Middle', verticalAlignment: 'Middle',
      matrix: { a: 1, b: 0, c: 0, d: 1, tx: 120, ty: 80 },
    }, { nested: true })
    return root.__visual
  }
  const culled = build(30)
  assert.equal(culled.children.filter(child => child instanceof Text).length, 0, '高 30 不应有 Text')
  assert.equal(culled.children.length, 1, '底色仍在')
  const drawn = build(40)
  assert.equal(drawn.children.filter(child => child instanceof Text).length, 1, '高 40 应有 Text')
})
