// 文本框「字号自适应」：按框尺寸收缩字号，下限 = min(最小字号, 字号)（真机口径「最小字号不能大于字号」）。
// 覆盖：纯函数 fitFontSize 的收缩 / 下限保护 / 多行约束，以及 studio 渲染路径上的接入。
import test from 'node:test'
import assert from 'node:assert/strict'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { createRuntime } from '../../client/lua-runtime/src/index.js'
import { paintList, playSnapshot } from '../play/session.js'
import { renderScenePng } from '../host-png.js'
import { fitFontSize } from '../play/scroll.js'

// 每个字符宽度 = 字号的一半，便于手算期望值
const measureHalf = (text, size) => String(text).length * size * 0.5

test('fitFontSize：放得下时保留原字号', () => {
  const size = fitFontSize('abcd', { maxSize: 20, minSize: 12, width: 100, height: 40, measure: measureHalf })
  assert.equal(size, 20)
})

test('fitFontSize：放不下时收缩到刚好容纳的最大整数字号', () => {
  // 'abcd' 宽 = 2×字号；框宽 30 → 字号 ≤ 15
  const size = fitFontSize('abcd', { maxSize: 20, minSize: 12, width: 30, height: 40, measure: measureHalf })
  assert.equal(size, 15)
})

test('fitFontSize：不低于最小字号（不会把字缩没）', () => {
  const size = fitFontSize('abcdefghij', { maxSize: 40, minSize: 12, width: 20, height: 40, measure: measureHalf })
  assert.equal(size, 12)
})

test('fitFontSize：最小字号不能大于字号（min 被夹到 max）', () => {
  const size = fitFontSize('abcdefghij', { maxSize: 16, minSize: 40, width: 20, height: 40, measure: measureHalf })
  assert.equal(size, 16)
})

test('fitFontSize：多行时整块高度也参与约束', () => {
  // 3 行 × 字号 × 1.2 ≤ 60 → 字号 ≤ 16
  const size = fitFontSize('a\nb\nc', { maxSize: 40, minSize: 12, width: 200, height: 60, measure: measureHalf })
  assert.equal(size, 16)
})

function adaptiveFixture(t, overrides = {}) {
  const runtime = createRuntime({ canvasWidth: 240, canvasHeight: 160 })
  t.after(() => runtime.destroy())
  runtime.addRoot({
    name: 'Root', kind: 'container', active: true, visible: true,
    sizeDeltaX: 240, sizeDeltaY: 160,
    anchorMinX: 0.5, anchorMaxX: 0.5, anchorMinY: 0.5, anchorMaxY: 0.5, pivotX: 0.5, pivotY: 0.5,
    children: [{
      name: 'Label', kind: 'textbox', active: true, visible: true,
      sizeDeltaX: 120, sizeDeltaY: 40,
      anchorMinX: 0.5, anchorMaxX: 0.5, anchorMinY: 0.5, anchorMaxY: 0.5, pivotX: 0.5, pivotY: 0.5,
      text: 'ABCDEFGHIJ', fontSize: 40, minimumFontSize: 12, adaptiveFontSize: true,
      fontColor: 0xffffffff, bgColor: 0, enableOutline: false,
      horizontalAlignment: 'Left', verticalAlignment: 'Top', children: [],
      ...overrides,
    }],
  })
  assert.deepEqual(runtime.mountErrors, [])
  const session = { runtime, compiled: { canvasId: 'pc-16-9', platform: 'PC' }, history: [] }
  return { runtime, session }
}

test('开启自适应：渲染字号按框尺寸收缩，且不低于最小字号', t => {
  const { session } = adaptiveFixture(t)
  const paint = paintList(session).find((item) => item.name === 'Label')
  assert.ok(paint.fontSize < 40, `字号应被收缩，实际 ${paint.fontSize}`)
  assert.ok(paint.fontSize >= 12, `字号不应低于最小字号 12，实际 ${paint.fontSize}`)
  const node = playSnapshot(session, { view: true }).scene.nodes.find((item) => item.name === 'Label')
  assert.equal(node.fontSize, paint.fontSize)
})

test('关闭自适应：字号原样保留', t => {
  const { session } = adaptiveFixture(t, { adaptiveFontSize: false })
  const paint = paintList(session).find((item) => item.name === 'Label')
  assert.equal(paint.fontSize, 40)
})

test('极窄框：坍缩到最小字号并在 PNG 上仍画得出文字', async t => {
  const { session } = adaptiveFixture(t, { sizeDeltaX: 18, minimumFontSize: 12 })
  const scene = playSnapshot(session, { view: true }).scene
  const node = scene.nodes.find((item) => item.name === 'Label')
  assert.equal(node.fontSize, 12)
  const png = renderScenePng(scene, 240, 160)
  const canvas = createCanvas(240, 160)
  const context = canvas.getContext('2d')
  context.drawImage(await loadImage(png.data), 0, 0)
  const { data } = context.getImageData(0, 0, 240, 160)
  let visible = 0
  for (let i = 0; i < data.length; i += 4) if (data[i] > 200 && data[i + 1] > 200 && data[i + 2] > 200) visible += 1
  assert.ok(visible > 10, '最小字号下文字仍应可见')
})
