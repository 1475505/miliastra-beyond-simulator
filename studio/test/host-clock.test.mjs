import test from 'node:test'
import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'
import { SimulatorController } from '../host/controller.js'

test('manual Worker stays on the requested frame during asynchronous screenshot preparation (#5)', { timeout: 10000 }, async t => {
  let release, prepared
  const gate = new Promise(resolve => { release = resolve })
  const started = new Promise(resolve => { prepared = resolve })
  const controller = new SimulatorController('', {
    clockMode: 'manual',
    imageAssets: { async prepare() { prepared(); await gate; return { images: new Map(), warnings: [] } } },
  })
  t.after(async () => { release(); await controller.dispose() })
  await controller.play('start')
  await controller.play('step', { dt: 2 })
  const screenshot = controller.playScreenshot()
  try {
    await started
    await delay(250)
    const during = await controller.play('get', { light: true })
    assert.equal(during.time, 2)
    assert.equal(during.frame, 1)
  } finally { release() }
  const image = await screenshot
  assert.equal(image.time, 2)
  assert.equal(image.frame, 1)
  assert.equal(image.clockMode, 'manual')
  assert.equal(image.fps, 30)
  assert.equal((await controller.play('get')).time, 2)
})

test('30/60 FPS changes update cadence without changing Lua or Tween duration', { timeout: 15000 }, async t => {
  const controller = new SimulatorController('', { clockMode: 'manual' })
  t.after(() => controller.dispose())
  controller.studio.patch({ op: 'addScript', path: 'frame-rate.lua', controlId: 'n1', controlAsset: 'server-control-template', source: `
local elapsed, updates = 0, 0
function OnStart()
  script:EnableUpdate(true)
  script.object.anchoredPositionX = 0
  game.Tween(script.object, { anchoredPositionX = 120 }, 1):SetEase(Enum.EaseType.Linear):Play()
end
function OnUpdate(dt)
  elapsed = elapsed + dt
  updates = updates + 1
  script.object:GetChild("文本框").text = string.format("%d:%.6f:%.3f", updates, elapsed, script.object.anchoredPositionX)
end` })
  for (const fps of [30, 60]) {
    const start = await controller.play('start', { fps })
    assert.equal(start.fps, fps)
    assert.ok(!start.mountError, start.mountError)
    for (let i = 0; i < fps / 2; i++) await controller.play('step', { light: true })
    const half = await controller.play('get', { inspect: true })
    assert.ok(Math.abs(half.time - 0.5) < 1e-10)
    assert.equal(half.frame, fps / 2)
    assert.equal(half.tree[0].children.find(node => node.kind === 'textbox').text, `${fps / 2}:0.500000:60.000`)
    const spec = await controller.play('saveCase')
    assert.equal(spec.dt, 1 / fps)
    assert.equal((await controller.play('history')).case.dt, 1 / fps)
    await controller.play('pause')
    const switched = await controller.play('fps', { fps: fps === 30 ? 60 : 30 })
    assert.equal(switched.paused, true)
    assert.equal(switched.frame, half.frame)
    assert.equal(switched.time, half.time)
    for (let i = 0; i < switched.fps / 2; i++) await controller.play('step', { light: true })
    const end = await controller.play('get', { inspect: true })
    assert.equal(end.tree[0].children.find(node => node.kind === 'textbox').text, '45:1.000000:120.000')
    assert.equal(end.paused, true)
    await controller.play('resume')
    await delay(60)
    assert.equal((await controller.play('get')).time, end.time, 'manual remains manual after a rate change')
    const explicit = await controller.play('step', { dt: 0.125 })
    assert.ok(Math.abs(explicit.time - 1.125) < 1e-10, 'explicit dt is not quantized to the target rate')
    for (const action of ['start', 'device', 'fps']) {
      await assert.rejects(controller.play(action, { fps: 120, canvasId: 'pc-16-9' }), /fps must be 30 or 60/)
    }
    const unchanged = await controller.play('get')
    assert.equal(unchanged.time, explicit.time)
    assert.equal(unchanged.frame, explicit.frame)
    assert.equal(unchanged.fps, switched.fps)
    const device = await controller.play('device', { canvasId: 'mobile-16-9' })
    assert.equal(device.fps, switched.fps)
    assert.equal(device.clockMode, 'manual')
  }
  assert.equal((await controller.play('start')).fps, 30, 'API starts retain the compatible default')
})

test('realtime Worker runs 60 then 30 updates per simulated second and freezes while paused', { timeout: 10000 }, async t => {
  const controller = new SimulatorController()
  t.after(() => controller.dispose())
  let previous = await controller.play('start', { fps: 60 })
  for (const fps of [60, 30]) {
    if (fps === 30) previous = await controller.play('fps', { fps, light: true })
    await controller.play('resume')
    await delay(400)
    const next = await controller.play('pause', { light: true })
    assert.equal(next.fps, fps)
    assert.ok(next.frame > previous.frame)
    assert.ok(next.time - previous.time > 0.1 && next.time - previous.time < 1,
      `wall-clock advancement: ${next.time - previous.time}`)
    assert.ok(Math.abs((next.time - previous.time) * fps - (next.frame - previous.frame)) < 1e-8)
    await delay(100)
    assert.equal((await controller.play('get', { light: true })).time, next.time)
    previous = next
  }
})
