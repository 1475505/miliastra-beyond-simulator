import test from 'node:test'
import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'
import { SimulatorController } from '../host/controller.js'

const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-9, `${message ?? ''} ${actual} != ${expected}`)

test('a driving page owns the clock: each frame advances by its capped dt and the Worker clock waits', { timeout: 10000 }, async t => {
  const controller = new SimulatorController()
  t.after(() => controller.dispose())
  const start = await controller.play('start', { driverId: 'page-a' })
  await delay(300)
  near((await controller.play('get', { light: true })).time, start.time, 'no Worker ticks while the page drives')
  const first = await controller.play('frame', { driverId: 'page-a', dt: 0.05 })
  near(first.time - start.time, 0.05)
  assert.equal(first.frame, start.frame + 1, 'one Lua update per presented frame')
  const capped = await controller.play('frame', { driverId: 'page-a', dt: 5 })
  near(capped.time - first.time, 1 / 3, 'Unity-style maximum dt')
  await controller.play('pause', { driverId: 'page-a' })
  const paused = await controller.play('frame', { driverId: 'page-a', dt: 0.05 })
  near(paused.time, capped.time, 'a paused game does not advance')
  assert.equal(paused.paused, true)
})

test('released or abandoned leases hand the game back to the Worker clock', { timeout: 15000 }, async t => {
  const controller = new SimulatorController()
  t.after(() => controller.dispose())
  await controller.play('start', { driverId: 'page-a' })
  const leased = await controller.play('frame', { driverId: 'page-a', dt: 0.1 })
  await controller.play('release', { driverId: 'page-a' })
  await delay(400)
  const background = await controller.play('get', { light: true })
  assert.ok(background.time - leased.time > 0.2, `a hidden page keeps the game running: ${background.time - leased.time}`)
  // A page whose frames stalled measures the whole gap; the Worker already covered it.
  const resumed = await controller.play('frame', { driverId: 'page-a', dt: 5 })
  assert.ok(resumed.time >= background.time + 1 / 30 - 1e-9, 'the owner resumes from the Worker progress')
  assert.ok(resumed.time - background.time < 0.2, `the stalled gap is not counted twice: ${resumed.time - background.time}`)
  await delay(300)
  near((await controller.play('get', { light: true })).time, resumed.time, 'resuming suspends the Worker clock again')
  await delay(1200)
  const abandoned = await controller.play('get', { light: true })
  assert.ok(abandoned.time > resumed.time, 'a page that stops sending frames cannot freeze the game')
})

test('the newest page or a tool that starts or steps play takes over; the old page can neither drive nor stop it', { timeout: 15000 }, async t => {
  const controller = new SimulatorController('', { clockMode: 'manual' })
  t.after(() => controller.dispose())
  await controller.play('start', { driverId: 'page-a' })
  await controller.play('frame', { driverId: 'page-a', dt: 0.1 })
  const attached = await controller.play('attach', { driverId: 'page-b', view: true, compact: true, sceneRev: 0 })
  near(attached.time, 0.1, 'attach keeps the game')
  for (const action of ['frame', 'get', 'key', 'step', 'pause', 'release', 'stop']) {
    assert.deepEqual(await controller.play(action, { driverId: 'page-a', dt: 1, key: 'KeyboardJumpKeyDown' }), { preempted: true }, action)
  }
  assert.ok(controller.worker, 'a preempted stop leaves the new owner running')
  near((await controller.play('frame', { driverId: 'page-b', dt: 0.1 })).time, 0.2)

  // Tool observation and input go through without taking the game away.
  await controller.play('key', { key: 'KeyboardJumpKeyDown', light: true })
  await controller.play('get', { light: true })
  near((await controller.play('frame', { driverId: 'page-b', dt: 0.1 })).time, 0.3)

  // A tool that advances time without a driver id takes over from the page.
  near((await controller.play('step', { dt: 0.5 })).time, 0.8)
  assert.deepEqual(await controller.play('frame', { driverId: 'page-b', dt: 0.1 }), { preempted: true })

  // Starting again is an explicit takeover; a tool start leaves no page owner.
  await controller.play('start', { driverId: 'page-b' })
  near((await controller.play('frame', { driverId: 'page-b', dt: 0.1 })).time, 0.1)
  await controller.play('start')
  assert.deepEqual(await controller.play('frame', { driverId: 'page-b', dt: 0.1 }), { preempted: true })
  assert.equal((await controller.play('stop')).running, false, 'tools can still stop play')
  assert.equal(controller.worker, null)
})
