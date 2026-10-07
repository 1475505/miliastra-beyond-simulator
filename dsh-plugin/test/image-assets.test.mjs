import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { apply, SimulatorController } from '../lib/index.js'
import { sharedImageAssets } from '../../studio/host/image-assets.js'
import { imageAssetUrl } from '../../studio/assets/catalog.js'
import { sharedAudioAssets } from '../../studio/host/audio-assets.js'
import { audioAssetUrl } from '../../studio/assets/audio-catalog.js'
import { tone } from '../../studio/test/fixtures/tone.js'

const { createCanvas } = createRequire(new URL('../../studio/package.json', import.meta.url))('@napi-rs/canvas')

test('DSH registered asset route and headless screenshot reuse the same cache', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'qxqy-dsh-images-'))
  const store = sharedImageAssets(), original = { directory: store.directory, fetcher: store.fetcher }
  const audioStore = sharedAudioAssets(), originalAudio = { directory: audioStore.directory, fetcher: audioStore.fetcher }
  audioStore.directory = join(directory, 'audio')
  let audioRequests = 0
  audioStore.fetcher = async () => { audioRequests++; return new Response(tone) }
  store.directory = directory
  const canvas = createCanvas(2, 2)
  canvas.getContext('2d').fillRect(0, 0, 2, 2)
  let count = 0
  store.fetcher = async url => {
    count++
    return String(url).endsWith('.png') ? new Response(canvas.toBuffer('image/png')) : Response.json({
      m_Rect: { width: 2, height: 2 }, m_RD: { textureRectOffset: { X: 0, Y: 0 }, textureRect: { width: 2, height: 2 }, settingsRaw: { packingRotation: 'None' } },
    })
  }
  const routes = [], tools = []
  const disposers = []
  apply({ tools: { register(tool) { tools.push(tool) } }, webServer: { register(route) { routes.push(route) } }, effect(factory) { disposers.push(factory()) } })
  const server = createServer((request, response) => {
    const path = new URL(request.url, 'http://localhost').pathname
    const route = routes.find(row => row.kind === 'exact' ? path === row.path : path === row.path || path.startsWith(row.path + '/'))
    if (route) void route.handler(request, response)
    else { response.statusCode = 404; response.end() }
  })
  const controller = new SimulatorController()
  t.after(async () => {
    await controller.dispose()
    await Promise.all(disposers.map(dispose => dispose?.()))
    await new Promise(resolve => server.close(resolve))
    Object.assign(store, original)
    Object.assign(audioStore, originalAudio)
    await rm(directory, { recursive: true, force: true })
  })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const base = `http://127.0.0.1:${server.address().port}`
  const first = await fetch(base + imageAssetUrl(101001))
  assert.equal(first.status, 200)
  assert.equal(first.headers.get('cache-control'), 'private, max-age=43200')
  assert.equal(count, 2)
  assert.equal((await fetch(base + '/qxqy-assets')).status, 404)
  controller.patch({ op: 'set', id: 'n9', key: 'imageId', value: 101001 })
  assert.deepEqual((await controller.requestUiScreenshot()).assetWarnings, [])
  assert.equal(count, 2)
  const refreshed = await fetch(base + '/qxqy-simulator/api/image-refresh', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: 'images', imageId: 101001 }) })
  assert.equal((await refreshed.json()).value.refreshed, true)
  assert.equal(count, 4)
  const sound = await fetch(base + audioAssetUrl(50888))
  assert.equal(sound.status, 200)
  assert.equal(sound.headers.get('content-type'), 'audio/mpeg')
  assert.deepEqual(Buffer.from(await sound.arrayBuffer()), tone)
  assert.equal((await fetch(base + audioAssetUrl(50888))).status, 200)
  assert.equal(audioRequests, 1)
  assert.equal((await fetch(base + audioAssetUrl(999999))).status, 404)
})
