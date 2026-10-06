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
  assert.equal((await controller.play('get')).time, 2)
})
