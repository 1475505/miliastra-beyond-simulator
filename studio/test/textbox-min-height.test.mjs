// 文本框「放得下就画」的真机口径。整框裁字与多行裁行其实是同一条式子：
//   可画行数 = floor((框高 − (0.25×字号 + 4)) / (1.2×字号))，0 行 ⇒ 整段不绘制
// （见 scroll-geometry.js 的 visibleTextLineCount / textBoxTooShortToDraw）
// 数据来自真机「字号测试」工程 7 页 59 张卡片（详见 scroll-geometry.js 的注释）：
//   16：16 20 24 26 → 0 行｜28…46 → 1 行｜47…60 → 2 行｜68 69 90 → 3 行
//   20：30 → 0｜55 56 → 1｜57 58 59 → 2   24：36 → 0｜41 48 → 1
//   40：40 45 50 → 0｜64 66 68 70 → 1     60：70 → 0｜96 → 1   10：16 → 0｜20 24 30 → 1｜33 35 → 2
import test from 'node:test'
import assert from 'node:assert/strict'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { Container, Matrix, Text } from 'pixi.js'
import { createRuntime } from '../../client/lua-runtime/src/index.js'
import { paintList, playSnapshot } from '../play/session.js'
import { renderScenePng } from '../host-png.js'
import { PixiPlayRenderer } from '../play/pixi-renderer.js'
import {
  textBoxTooShortToDraw, TEXT_MIN_FONT_SIZE, textLineHeight, textBlockInset, visibleTextLineCount,
  visibleTextLines, TEXT_LINE_HEIGHT_FACTOR, TEXT_BLOCK_INSET_FACTOR, TEXT_BLOCK_INSET,
} from '../play/scroll-geometry.js'

test('常量：行距 1.2×字号、整块额外占位 0.25×字号 + 4', () => {
  assert.equal(TEXT_LINE_HEIGHT_FACTOR, 1.2)
  assert.equal(TEXT_BLOCK_INSET_FACTOR, 0.25)
  assert.equal(TEXT_BLOCK_INSET, 4)
  assert.equal(TEXT_MIN_FONT_SIZE, 10)
  assert.equal(textLineHeight(16), 19.2)
  assert.equal(textLineHeight(20), 24)
  assert.equal(textLineHeight(10), 12)
  assert.equal(textBlockInset(16), 8)
  assert.equal(textBlockInset(20), 9)
  assert.equal(textBlockInset(10), 6.5)
})

test('visibleTextLineCount：真机 40 个点由同一条式子全中', () => {
  const expect = {
    16: [[16, 0], [20, 0], [24, 0], [26, 0], [28, 1], [30, 1], [32, 1], [36, 1], [38, 1], [40, 1],
      [43, 1], [45, 1], [46, 1], [47, 2], [48, 2], [57, 2], [58, 2], [60, 2], [68, 3], [69, 3], [90, 4]],
    20: [[30, 0], [55, 1], [56, 1], [57, 2], [58, 2], [59, 2]],
    24: [[36, 0], [41, 1], [48, 1]],
    40: [[40, 0], [45, 0], [50, 0], [64, 1], [66, 1], [68, 1], [70, 1]],
    60: [[70, 0], [96, 1]],
    10: [[16, 0], [20, 1], [24, 1], [30, 1], [33, 2], [35, 2]],
  }
  for (const [font, points] of Object.entries(expect)) {
    for (const [height, want] of points) {
      assert.equal(visibleTextLineCount(Number(font), height), want, `${font}/${height} 真机画出 ${want} 行`)
    }
  }
})

test('textBoxTooShortToDraw：0 行 ⇔ 整段不绘制', () => {
  const culled = [[16, 16], [16, 20], [16, 24], [16, 26], [20, 30], [24, 36], [40, 40], [40, 45], [40, 50], [60, 70]]
  const drawn = [[16, 28], [16, 30], [16, 48], [24, 48], [40, 64], [40, 66], [40, 68], [40, 70], [24, 41], [60, 96], [10, 20], [8, 24]]
  for (const [font, height] of culled) {
    assert.equal(textBoxTooShortToDraw(font, height), true, `${font}/${height} 真机不绘制`)
  }
  for (const [font, height] of drawn) {
    assert.equal(textBoxTooShortToDraw(font, height), false, `${font}/${height} 真机绘制`)
  }
  // 16px 的边界：27.2 = 19.2 + (0.25×16 + 4)
  assert.equal(textBoxTooShortToDraw(16, 27.1), true)
  assert.equal(textBoxTooShortToDraw(16, 27.3), false)
  assert.equal(textBoxTooShortToDraw(10, 16), true, '真机实测：字号 8 被夹到 10，8/16 不绘制')
})

test('textBoxTooShortToDraw：非法输入不误判为「不绘制」', () => {
  for (const [font, height] of [[NaN, 30], [20, NaN], [20, undefined], [0, 30], [20, 0], [-4, 30]]) {
    assert.equal(textBoxTooShortToDraw(font, height), false, `${font} / ${height}`)
  }
})

test('visibleTextLines：文本视窗只取整行放得下的行（真机第 7 页，比文本框多放一行）', () => {
  const scroll = (lineHeight, count) => ({ lineHeight, offset: 0, lines: Array.from({ length: count }, (_, i) => `L${i + 1}`) })
  const lines = (lineHeight, count, height) => visibleTextLines(scroll(lineHeight, count), height).text.split('\n').length
  assert.equal(lines(19.2, 3, 45), 2, '16px 高 45 → 2 行（文本框只画 1 行）')
  assert.equal(lines(19.2, 3, 46), 2)
  assert.equal(lines(19.2, 3, 69), 3)
  assert.equal(lines(19.2, 3, 90), 3)
  assert.equal(lines(19.2, 4, 90), 4)
  assert.equal(lines(24, 3, 57), 2, '20px')
  assert.equal(lines(24, 3, 58), 2)
  assert.equal(lines(12, 3, 30), 2, '10px')
  assert.equal(lines(12, 3, 35), 2)
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

test('host-png：多行文本放不下的行不画（三行 / f16，h45 只 1 行、h47 出 2 行）', async t => {
  const count = async (session) => whitePixels(renderScenePng(playSnapshot(session, { view: true }).scene, 240, 160), 240, 160)
  const one = await count(fixture(t, 45, { fontSize: 16, text: 'AAA\nBBB\nCCC' }).session)
  const two = await count(fixture(t, 47, { fontSize: 16, text: 'AAA\nBBB\nCCC' }).session)
  assert.ok(one > 0, `h45 至少要画出第 1 行，实际白像素 ${one}`)
  assert.ok(two > one * 1.4, `h47 应多出一行，实际 ${one} → ${two}`)
})

test('pixi：一行都放不下时只留底色，不建 Text 节点', t => {
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
