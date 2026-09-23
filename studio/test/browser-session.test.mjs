import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createPlaySession, keyEventName, PLAY_POLL_INTERVAL_MS } from '../play/browser-session.js'

test('reloading a browser attaches to the existing paused game without a start or player change', async t => {
  const calls = [], rendered = []
  const snapshot = { running: true, paused: true, frame: 1254, time: 41.8,
    canvasWidth: 1280, canvasHeight: 720, viewPlayerIndex: 2,
    scene: { format: 'tree-v1', revision: 7, reset: true, nodes: [] } }
  const play = createPlaySession({
    renderer: { async applyScene(scene) { rendered.push(scene) } },
    async api(action, args) { calls.push({ action, args }); return snapshot },
  })
  t.after(() => play.destroy())
  await play.attach()
  play.stopPolling()
  assert.deepEqual(calls, [{ action: 'get', args: { view: true, compact: true, sceneRev: 0 } }])
  assert.equal(play.running, true)
  assert.equal(play.snapshot.paused, true)
  assert.equal(play.snapshot.frame, 1254)
  assert.equal(play.snapshot.viewPlayerIndex, 2)
  assert.equal(play.sceneRev, 7)
  assert.equal(rendered.length, 1)
})

test('shared play loop polls compact scene views and sends light input', async () => {
  const calls = []
  const scenes = []
  const statuses = []
  let sceneRevSeen
  const renderer = {
    applied: [],
    async applyScene(scene, width, height) { this.applied.push({ scene, width, height }) },
    async render() {},
    destroy() { this.destroyed = true },
  }
  const play = createPlaySession({
    renderer,
    async api(action, args = {}) {
      calls.push({ action, args })
      if (action === 'start' || action === 'get') {
        sceneRevSeen = args.sceneRev
        return {
          running: true,
          paused: false,
          frame: calls.length,
          time: 0.1,
          canvasWidth: 1600,
          canvasHeight: 900,
          scene: { format: 'tree-v1', revision: 2, reset: action === 'start', nodes: [] },
        }
      }
      if (action === 'pointer' || action === 'key' || action === 'step') {
        return { running: true, paused: false, frame: 3, time: 0.2 }
      }
      if (action === 'stop') return { running: false }
      return { running: true }
    },
    onSnapshot: (next) => scenes.push(next),
    onStatus: (next) => statuses.push(next),
  })

  await play.start({ canvasId: 'pc-16-9' })
  assert.equal(calls[0].action, 'start')
  assert.equal(calls[0].args.view, true)
  assert.equal(calls[0].args.compact, true)
  assert.equal(calls[0].args.canvasId, 'pc-16-9')
  assert.equal(renderer.applied.length, 1)
  assert.equal(scenes.length, 1)

  await play.act('pointer', { type: 'down', x: 10, y: 20 })
  const pointer = calls.find((call) => call.action === 'pointer')
  assert.equal(pointer.args.light, true)
  assert.equal(pointer.args.type, 'down')
  assert.equal(statuses.length, 1)

  await play.poll()
  const get = calls.find((call) => call.action === 'get')
  assert.equal(get.args.view, true)
  assert.equal(get.args.compact, true)
  assert.equal(get.args.sceneRev, 2)
  assert.equal(sceneRevSeen, 2)

  play.destroy()
  assert.equal(renderer.destroyed, true)
  assert.equal(PLAY_POLL_INTERVAL_MS, 33)
  assert.equal(keyEventName({ code: 'Digit1' }, 'Down'), 'KeyboardCraftspersonKey1Down')
  assert.equal(keyEventName({ code: 'KeyA' }, 'Down'), '')
})
