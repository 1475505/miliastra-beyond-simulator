import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AudioAssetStore, validateMp3 } from '../host/audio-assets.js'
import { audioDuration } from '../assets/audio-catalog.js'
import { tone } from './fixtures/tone.js'
import { createStudio } from '../index.js'

test('audio catalog pins all 1997 IDs and provider durations', () => {
  let count = 0
  for (let id = 1; id < 60000; id++) if (audioDuration(id) !== null) count++
  assert.equal(count, 1997)
  assert.equal(audioDuration(50888), 0.495)
  assert.equal(audioDuration(10003), 106.857)
  for (const id of [0, 10075, 20205, 30150, 40475, 51097, 50888.5, '50888']) assert.equal(audioDuration(id), null)
})

test('MP3 cache is lazy, singleflight across stores, survives offline restart and rejects corrupt responses', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'qxqy-audio-cache-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const requests = []
  const fetcher = async url => { requests.push(String(url)); return new Response(tone) }
  const a = new AudioAssetStore({ cacheDir: directory, fetch: fetcher })
  const b = new AudioAssetStore({ cacheDir: directory, fetch: fetcher })
  assert.equal(requests.length, 0)
  validateMp3(tone)
  const values = await Promise.all([a.get(50888), a.get(50888), b.get(50888)])
  assert.deepEqual(values[0].data, tone)
  assert.deepEqual(requests, ['https://oss.070077.xyz/audio/50888.mp3'])
  const offline = new AudioAssetStore({ cacheDir: directory, fetch: () => { throw new Error('offline') } })
  assert.deepEqual((await offline.get(50888)).data, tone)
  await assert.rejects(a.get(999999), /allowlist/)
  a.fetcher = async () => new Response('<html>error</html>')
  await assert.rejects(a.refresh(50888), /MP3/)
  assert.deepEqual((await a.get(50888)).data, tone)
  await writeFile(join(a.directory, '50888.mp3'), 'damaged')
  a.fetcher = fetcher
  await a.get(50888)
  assert.equal(requests.length, 2)
  let failures = 0
  a.fetcher = async () => { failures++; return new Response('bad', { status: 404 }) }
  await assert.rejects(a.get(50889), /404/)
  await assert.rejects(a.get(50889), /404/)
  assert.equal(failures, 1)
  assert.throws(() => validateMp3(tone.subarray(0, tone.length - 1)), /MP3/)
})

test('audio snapshots are non-consuming, isolated per player and naturally expire without a browser', () => {
  const studio = createStudio()
  studio.patch({ op: 'addScript', path: 'audio.lua', controlId: 'n1', source: `
function OnStart()
  id = game.PlayAudio2D(50888)
  script.object:AddKeyEventListener(Enum.KeyEventType.KeyboardCraftspersonKey1Down, function() game.StopAudio(id) end)
end` })
  try {
    const start = studio.playStart({ playerCount: 2 })
    assert.equal(start.audio.active.length, 1)
    assert.deepEqual(studio.playGet().audio, start.audio)
    studio.playKey('KeyboardCraftspersonKey1Down')
    assert.equal(studio.playGet().audio.recent[0].stopped, true)
    studio.playSetView(2)
    assert.equal(studio.playGet().audio.active.length, 1)
    studio.playStep(0.5)
    assert.equal(studio.playGet().audio.active.length, 0)
    assert.equal(studio.playGet().audio.recent[0].stopped, false)
    const restart = studio.playStart()
    assert.notEqual(restart.audio.sessionId, start.audio.sessionId)
    assert.equal(restart.audio.sequence, 1)
  } finally { studio.playStop() }
})
