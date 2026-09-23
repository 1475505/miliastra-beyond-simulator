import test from 'node:test'
import assert from 'node:assert/strict'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { Container, Text } from 'pixi.js'
import { createRuntime } from '../../client/lua-runtime/src/index.js'
import { paintList, playSnapshot } from '../play/session.js'
import { renderScenePng } from '../host-png.js'
import { PixiPlayRenderer } from '../play/pixi-renderer.js'

function fixture(t) {
  const runtime = createRuntime({ canvasWidth: 240, canvasHeight: 160 })
  t.after(() => runtime.destroy())
  const root = runtime.addRoot({
    name: 'Root', kind: 'container', active: true, visible: true,
    sizeDeltaX: 240, sizeDeltaY: 160,
    anchorMinX: 0.5, anchorMaxX: 0.5, anchorMinY: 0.5, anchorMaxY: 0.5,
    pivotX: 0.5, pivotY: 0.5,
    children: [{
      name: 'Label', kind: 'textbox', active: true, visible: true,
      sizeDeltaX: 160, sizeDeltaY: 80,
      anchorMinX: 0.5, anchorMaxX: 0.5, anchorMinY: 0.5, anchorMaxY: 0.5,
      pivotX: 0.5, pivotY: 0.5, text: 'W', fontSize: 20,
      fontColor: 0xffffffff, bgColor: 0, enableOutline: false,
      horizontalAlignment: 'Left', verticalAlignment: 'Top', children: [],
    }],
  })
  const label = root.GetChild('Label')
  const session = { runtime, compiled: { canvasId: 'pc-16-9', platform: 'PC' }, history: [] }
  runtime.mountScript({ path: 'alignment-test', control: root, source: `
local elapsed = 0
function OnStart()
    local label = script.object:GetChild('Label')
    label.horizontalAlignment = Enum.TextHorizontalAlignment.Middle
    label.verticalAlignment = Enum.TextVerticalAlignment.Middle
    script:EnableUpdate(true)
end
function OnUpdate(dt)
    elapsed = elapsed + dt
    if elapsed < 0.2 then return end
    local label = script.object:GetChild('Label')
    label.horizontalAlignment = Enum.TextHorizontalAlignment.Right
    label.verticalAlignment = Enum.TextVerticalAlignment.Bottom
    script:EnableUpdate(false)
end` })
  assert.deepEqual(runtime.mountErrors, [])
  return { runtime, label, session }
}

async function whiteBounds(scene) {
  const png = renderScenePng(scene, 240, 160)
  const canvas = createCanvas(240, 160)
  const context = canvas.getContext('2d')
  context.drawImage(await loadImage(png.data), 0, 0)
  const { data } = context.getImageData(0, 0, 240, 160)
  const points = []
  for (let y = 0; y < 160; y += 1) for (let x = 0; x < 240; x += 1) {
    const offset = (y * 240 + x) * 4
    if (data[offset] > 220 && data[offset + 1] > 220 && data[offset + 2] > 220) points.push({ x, y })
  }
  assert.ok(points.length > 10, 'PNG must contain visible text')
  const left = Math.min(...points.map(point => point.x)), right = Math.max(...points.map(point => point.x))
  const top = Math.min(...points.map(point => point.y)), bottom = Math.max(...points.map(point => point.y))
  return { left, right, top, bottom, cx: (left + right) / 2, cy: (top + bottom) / 2 }
}

test('Lua alignment EnumItems become named scene/paint fields without changing Runtime enum identity', t => {
  const { runtime, label, session } = fixture(t)
  assert.equal(label.horizontalAlignment.Name, 'Middle')
  assert.equal(label.verticalAlignment.Name, 'Middle')
  const first = playSnapshot(session, { view: true }).scene
  const node = first.nodes.find(item => item.name === 'Label')
  assert.equal(node.horizontalAlignment, 'Middle')
  assert.equal(node.verticalAlignment, 'Middle')
  assert.equal(paintList(session).find(item => item.name === 'Label').horizontalAlignment, 'Middle')
  runtime.step(0.25)
  const patch = playSnapshot(session, { view: true, sceneRev: first.revision }).scene
  assert.equal(patch.reset, false)
  const changed = patch.changed.find(item => item.name === 'Label')
  assert.ok(changed, 'alignment-only mutation must invalidate the scene fingerprint')
  assert.equal(changed.horizontalAlignment, 'Right')
  assert.equal(changed.verticalAlignment, 'Bottom')
  assert.equal(label.horizontalAlignment.Name, 'Right')
  assert.equal(label.verticalAlignment.Name, 'Bottom')
  const paint = paintList(session).find(item => item.name === 'Label')
  assert.equal(paint.horizontalAlignment, 'Right')
  assert.equal(paint.verticalAlignment, 'Bottom')
})

test('PNG positions text at center then bottom-right after real Lua enum assignments', async t => {
  const { runtime, session } = fixture(t)
  const centered = await whiteBounds(playSnapshot(session, { view: true }).scene)
  assert.ok(Math.abs(centered.cx - 120) < 6, JSON.stringify(centered))
  assert.ok(Math.abs(centered.cy - 80) < 8, JSON.stringify(centered))
  runtime.step(0.25)
  const corner = await whiteBounds(playSnapshot(session, { view: true }).scene)
  assert.ok(corner.left > 170 && corner.right < 202, JSON.stringify(corner))
  assert.ok(corner.top > 95 && corner.bottom <= 122, JSON.stringify(corner))
  assert.ok(corner.cx - centered.cx > 60)
  assert.ok(corner.cy - centered.cy > 20)
})

test('Pixi visuals consume the same normalized Lua scene and update anchors without a browser', t => {
  const { runtime, session } = fixture(t)
  // Actual Pixi containers/text and the production visual adapter are enough
  // to observe anchors/positions. Starting a WebGL application is unnecessary.
  const renderer = Object.create(PixiPlayRenderer.prototype)
  const root = new Container()
  t.after(() => root.destroy({ children: true }))
  const first = playSnapshot(session, { view: true }).scene.nodes.find(item => item.name === 'Label')
  renderer.replaceVisual(root, first, first.sourceWidth, first.sourceHeight)
  let text = root.__visual.children.find(child => child instanceof Text)
  assert.ok(text)
  assert.deepEqual([text.anchor.x, text.anchor.y, text.x, text.y], [0.5, 0.5, 0, 0])
  assert.equal(text.style.align, 'center')
  runtime.step(0.25)
  const changed = playSnapshot(session, { view: true }).scene.nodes.find(item => item.name === 'Label')
  renderer.replaceVisual(root, changed, changed.sourceWidth, changed.sourceHeight)
  text = root.__visual.children.find(child => child instanceof Text)
  assert.deepEqual([text.anchor.x, text.anchor.y, text.x, text.y], [1, 1, 78, 40])
  assert.equal(text.style.align, 'right')
})
