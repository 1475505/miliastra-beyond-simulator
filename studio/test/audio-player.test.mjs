import test from 'node:test'
import assert from 'node:assert/strict'
import { BrowserAudioPlayer } from '../play/audio-player.js'
import { createPlaySession } from '../play/browser-session.js'
import { uiVfxAsset, uiVfxMedia, uiVfxUrl } from '../assets/ui-vfx-catalog.js'

const flush = () => new Promise(resolve => setTimeout(resolve, 0))
const row = (id = 1, extras = {}) => ({ instanceId: id, audioId: 50888, startedAt: 0, duration: 0.495, alive: true, stopped: false, ...extras })
const snap = (rows, extras = {}) => ({ running: true, time: 0, paused: false,
  audio: { sessionId: 'game-a', playerIndex: 1, sequence: rows.at(-1)?.instanceId || 0, revision: 1,
    recent: rows, active: rows.filter(row => row.alive && !row.stopped) }, ...extras })

function harness(t) {
  const starts = [], sources = []
  const ctx = { currentTime: 0, state: 'suspended', destination: {},
    createGain: () => ({ gain: { value: 1 }, connect() {} }),
    resume: async () => { ctx.state = 'running' }, close: async () => { ctx.state = 'closed' },
    decodeAudioData: async () => ({ duration: 1, length: 8000, numberOfChannels: 1 }),
    createBufferSource() {
      const source = { connect() {}, disconnect() {}, start(t, offset) { starts.push({ source, offset }) }, stop() { this.stopped = true } }
      sources.push(source)
      return source
    },
  }
  let requests = 0
  const player = new BrowserAudioPlayer({ contextFactory: () => ctx, fetch: async () => { requests++; return new Response(new Uint8Array([1])) } })
  t.after(() => player.destroy())
  return { player, ctx, starts, sources, requests: () => requests }
}

test('each audio instance plays once, same asset overlaps and shares decoded buffer', async t => {
  const { player, starts, requests } = harness(t)
  player.unlock()
  player.sync(snap([row(1), row(2)]), { fresh: true })
  await flush()
  assert.equal(starts.length, 2)
  assert.equal(requests(), 1)
  player.sync(snap([row(1), row(2)]))
  assert.equal(starts.length, 2, 'poll snapshots do not replay')
  player.sync(snap([row(1, { alive: false, stopped: true }), row(2)]))
  assert.equal(starts[0].source.stopped, true)
  assert.equal(starts[1].source.stopped, undefined)
  player.setMuted(true)
  assert.equal(player.output.gain.value, 0)
  player.sync({ running: false })
  assert.equal(starts[1].source.stopped, true)
})

test('pause/resume uses media offset and attachment resumes only live instances', async t => {
  const { player, starts, ctx } = harness(t)
  player.unlock()
  player.sync(snap([row()], { time: 0.2 }))
  await flush()
  assert.equal(starts[0].offset, 0.2)
  ctx.currentTime = 0.1
  player.sync(snap([row()], { paused: true }))
  assert.equal(starts[0].source.stopped, true)
  player.sync(snap([row()], { paused: false }))
  assert.ok(Math.abs(starts[1].offset - 0.3) < 1e-9)
  const switched = snap([row(1, { alive: false })])
  switched.audio.playerIndex = 2
  player.sync(switched)
  assert.equal(starts[1].source.stopped, true)
  assert.equal(player.voices.size, 0)
})

test('StopAudio/reset during cold fetch never starts late audio; natural expiry still permits one cold playback', async t => {
  const { player, starts } = harness(t)
  let release
  const gate = new Promise(resolve => { release = resolve })
  player.fetcher = async () => { await gate; return new Response(new Uint8Array([1])) }
  player.unlock()
  player.sync(snap([row()]), { fresh: true })
  player.sync(snap([row(1, { alive: false, stopped: true })]))
  release()
  await flush()
  assert.equal(starts.length, 0)
  player.reset()
  player.sync(snap([row(2, { alive: false })]), { fresh: true })
  await flush()
  assert.equal(starts.length, 1)
  player.reset()
  assert.equal(starts[0].source.stopped, true)
  player.sync(snap([row(3)]), { fresh: true })
  player.reset()
  await flush()
  assert.equal(starts.length, 1)
})

test('locked autoplay waits for unlock, errors do not re-fetch every poll', async t => {
  const { player, starts } = harness(t)
  player.sync(snap([row()]), { fresh: true })
  await flush()
  assert.equal(starts.length, 0)
  player.unlock()
  await flush()
  assert.equal(starts.length, 1)
  let requests = 0
  player.fetcher = async () => { requests++; throw new Error('offline') }
  const next = row(2, { audioId: 20001 })
  player.sync(snap([row(), next]))
  await flush()
  player.sync(snap([row(), next]))
  player.sync(snap([row(), next, row(3, { audioId: 20001 })]))
  await flush()
  assert.equal(requests, 1)
  assert.match(player.status().error, /offline/)
})

test('agent-muted sessions stay silent until the sound button, then ignore later mute snapshots', async t => {
  const { player, starts } = harness(t)
  player.sync(snap([row()], { audioMuted: true }), { fresh: true })
  player.unlock()
  await flush()
  assert.equal(player.muted, true)
  assert.equal(player.output.gain.value, 0)
  assert.equal(starts.length, 1, 'muted voices still track the instance so unmute is not required to consume it')
  player.toggle()
  assert.equal(player.audioChoice, 'on')
  assert.equal(player.muted, false)
  assert.equal(player.output.gain.value, 1)
  player.sync(snap([row(2)], { audioMuted: true }))
  await flush()
  assert.equal(player.muted, false, 'a user unmute survives polls of an agent-muted session')
  assert.equal(starts.length, 2)
})

test('reset fences an in-flight poll so it cannot revive audio after stop', async t => {
  const synced = []
  let release
  const play = createPlaySession({ renderer: { async applyScene() {} },
    audio: { sync(value) { synced.push(value) }, reset() {}, unlock() {}, destroy() {} },
    api: async action => action === 'get' ? new Promise(resolve => { release = resolve }) : { running: true },
  })
  t.after(() => play.destroy())
  await play.start()
  play.stopPolling()
  const poll = play.poll()
  play.reset()
  release(snap([row()]))
  await poll
  assert.equal(synced.length, 1)
  assert.equal(play.running, false)
})

const effect = (id = 1, extras = {}) => ({ id, kind: 'animation', animationId: 10001017,
  generation: 1, startedAt: 0, playSoundEffect: true, audioPath: uiVfxAsset(10001017).audio[0], ...extras })

test('effect sound shares mute/unlock, plays once per generation and resumes at logical time', async t => {
  const { player, starts, requests } = harness(t)
  player.sync(snap([], { audioMuted: true, effects: [effect(), effect(2)] }))
  await flush()
  assert.equal(starts.length, 0)
  player.unlock()
  await flush()
  assert.equal(starts.length, 2)
  assert.equal(requests(), 1)
  assert.equal(player.output.gain.value, 0)
  player.toggle()
  player.sync(snap([], { paused: true, time: 0.2, effects: [effect(), effect(2)] }))
  assert.ok(starts.every(row => row.source.stopped))
  player.sync(snap([], { time: 0.2, effects: [effect(), effect(2)] }))
  assert.equal(starts.length, 4)
  assert.equal(starts[2].offset, 0.2)
  assert.equal(player.output.gain.value, 1)
  starts[2].source.onended()
  player.sync(snap([], { time: 0.3, effects: [effect(), effect(2)] }))
  assert.equal(starts.length, 4, 'ended sound never repeats on polling')
  player.sync(snap([], { time: 0.3, effects: [effect(1, { generation: 2, startedAt: 0.3 })] }))
  await flush()
  assert.equal(starts.length, 5)
  assert.equal(starts[4].offset, 0)
  assert.equal(starts[3].source.stopped, true, 'removed effect stops its sound')
  player.sync(snap([], { time: 0.4, clockMode: 'manual', effects: [effect(1, { generation: 2, startedAt: 0.3 })] }))
  assert.equal(starts[4].source.stopped, true)
  assert.equal(starts.length, 5, 'manual stepping stays silent')
})

test('effect sound expiry and stop cancel delayed audio; errors stay local and explicit replay retries', async t => {
  const { player, starts } = harness(t)
  let release
  const requests = []
  player.fetcher = url => { requests.push(url); return new Promise(resolve => { release = () => resolve(new Response(new Uint8Array([1]))) }) }
  player.unlock()
  player.sync(snap([], { effects: [effect()] }))
  player.sync(snap([], { time: uiVfxMedia(effect().audioPath).duration + 1, effects: [effect()] }))
  release()
  await flush()
  assert.equal(starts.length, 0, 'expired effect sound is not played late')
  assert.equal(requests[0], uiVfxUrl(effect().audioPath))
  player.buffers.clear()
  player.sync(snap([], { effects: [effect(2)] }))
  player.sync(snap([], { effects: [] }))
  release()
  await flush()
  assert.equal(starts.length, 0, 'stopping while loading cannot revive a voice')
  player.buffers.clear()
  let failures = 0
  player.fetcher = async () => { failures++; throw new Error('offline effect sound') }
  player.sync(snap([], { effects: [effect(3)] }))
  await flush()
  player.sync(snap([], { effects: [effect(3)] }))
  await flush()
  assert.equal(failures, 1)
  assert.match(player.status().error, /offline effect sound/)
  player.fetcher = async url => { requests.push(url); return new Response(new Uint8Array([1])) }
  player.sync(snap([], { effects: [effect(3, { generation: 2 })] }))
  await flush()
  assert.equal(requests.at(-1), uiVfxUrl(effect().audioPath) + '?retry=1')
  assert.equal(starts.length, 1, 'explicit replay recovers within the failure cooldown')
  player.sync(snap([], { effects: [effect(3, { generation: 2, playSoundEffect: false })] }))
  assert.equal(starts[0].source.stopped, true)
})

test('effect rendering is fenced after asynchronous scene work and inactive views release planes', async t => {
  const synced = [], resets = []
  let release, active = true
  const play = createPlaySession({ renderer: {
    applyScene: () => new Promise(resolve => { release = resolve }), syncEffects: value => synced.push(value), resetEffects: () => resets.push(true),
  }, audio: { sync() {}, reset() {}, destroy() {} }, isActive: () => active })
  t.after(() => play.destroy())
  const rendering = play.applyScene({ ...snap([]), scene: { format: 'tree-v1' } })
  play.reset()
  release()
  await rendering
  assert.equal(synced.length, 0, 'a late renderer completion cannot resurrect stopped effects')
  active = false
  const before = resets.length
  play.stopPolling()
  assert.equal(resets.length, before + 1)
})
