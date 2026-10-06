import test from 'node:test'
import assert from 'node:assert/strict'
import { BrowserAudioPlayer } from '../play/audio-player.js'
import { createPlaySession } from '../play/browser-session.js'

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
