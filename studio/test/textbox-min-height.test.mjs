// 文本框「高度不足 ⇒ 整段文字不绘制」的真机口径。
// 数据来自真机「字号测试」工程 41 张卡片（详见 scroll-geometry.js 的注释）：
//   16/16 16/20 16/24 16/26 20/30 24/36 40/40 40/45 40/50 60/70 → 不绘制
//   16/28 16/30 16/48 24/48 40/64 40/70 24/41 60/96 10/20 8/24 → 绘制
//   8/16 → 不绘制（真机把 fontSize 夹到 10，判定按夹取后的 10 算）
import test from 'node:test'
import assert from 'node:assert/strict'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { Container, Matrix, Text } from 'pixi.js'
import { createRuntime } from '../../client/lua-runtime/src/index.js'
import { paintList, playSnapshot } from '../play/session.js'
import { renderScenePng } from '../host-png.js'
import { PixiPlayRenderer } from '../play/pixi-renderer.js'
import { textBoxTooShortToDraw, TEXT_MIN_HEIGHT_FACTOR, TEXT_MIN_HEIGHT_PADDING, TEXT_MIN_FONT_SIZE } from '../play/scroll-geometry.js'

test('阈值常量：1.5×字号 + 4px（真机边界夹在 1.63×~1.75× 之间）', () => {
  assert.equal(TEXT_MIN_HEIGHT_FACTOR, 1.5)
  assert.equal(TEXT_MIN_HEIGHT_PADDING, 4)
  assert.equal(TEXT_MIN_FONT_SIZE, 10)
})

test('textBoxTooShortToDraw：真机「字号测试」项目实测的 20 个点', () => {
  const culled = [[16, 16], [16, 20], [16, 24], [16, 26], [20, 30], [24, 36], [40, 40], [40, 45], [40, 50], [60, 70]]
  const drawn = [[16, 28], [16, 30], [16, 48], [24, 48], [40, 64], [40, 66], [40, 68], [40, 70], [24, 41], [60, 96], [10, 20], [8, 24]]
  for (const [font, height] of culled) {
    assert.equal(textBoxTooShortToDraw(font, height), true, `${font}/${height} 真机不绘制`)
  }
  for (const [font, height] of drawn) {
    assert.equal(textBoxTooShortToDraw(font, height), false, `${font}/${height} 真机绘制`)
  }
})

test('textBoxTooShortToDraw：边界附近逐像素判定（字号 16）', () => {
  assert.equal(textBoxTooShortToDraw(16, 26), true, '真机实测：26 不绘制')
  assert.equal(textBoxTooShortToDraw(16, 27.9), true)
  assert.equal(textBoxTooShortToDraw(16, 28), false, '真机实测：28 绘制')
  assert.equal(textBoxTooShortToDraw(10, 16), true, '真机实测：字号 8 被夹到 10，8/16 不绘制')
  assert.equal(textBoxTooShortToDraw(10, 19), false, '夹取后 19 = 1.5×10+4，恰在边界')
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
  assert.equal(pixels, 0, '高不足 1.5×字号+4 时应无字形')
})

test('host-png：高 40 / 字号 20 ⇒ 文字正常绘制', async t => {
  const { session } = fixture(t, 40)
  const scene = playSnapshot(session, { view: true }).scene
  const pixels = await whitePixels(renderScenePng(scene, 240, 160), 240, 160)
  assert.ok(pixels > 10, `高 40 时应画得出字，实际白像素 ${pixels}`)
})

test('host-png：字号 8（真机夹到 10）/ 高 16 ⇒ 一个文字像素都不画', async t => {
  const { session } = fixture(t, 16, { fontSize: 8 })
  const bare = fixture(t, 400, { fontSize: 8 })
  const scene = playSnapshot(session, { view: true }).scene
  assert.equal(await whitePixels(renderScenePng(scene, 240, 160), 240, 160), 0,
    '真机实测 8/16 不绘制：字号被夹到 10 ⇒ 阈值 19 > 16')
  const control = playSnapshot(bare.session, { view: true }).scene
  assert.ok(await whitePixels(renderScenePng(control, 240, 160), 240, 160) > 10,
    '同样的字号 8 在高 400 下应当画得出字')
})

test('pixi：高不足 1.5×字号+4 时只留底色，不建 Text 节点', t => {
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
