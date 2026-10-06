import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createWebServer } from '../server.js'
import { AudioAssetStore } from '../../studio/host/audio-assets.js'
import { audioAssetUrl } from '../../studio/assets/audio-catalog.js'
import { tone } from '../../studio/test/fixtures/tone.js'
import { createStudio } from '../../studio/index.js'
import { startTestBrowser } from './browser-helper.mjs'

const source = `
local voice
function OnStart()
  voice = game.PlayAudio2D(10008)
  script.object:AddKeyEventListener(Enum.KeyEventType.KeyboardCraftspersonKey1Down, function() voice = game.PlayAudio2D(10008) end)
  script.object:AddKeyEventListener(Enum.KeyEventType.KeyboardCraftspersonKey2Down, function() game.StopAudio(voice) end)
  script.object:AddKeyEventListener(Enum.KeyEventType.KeyboardCraftspersonKey3Down, function() voice = game.PlayAudio2D(20001) end)
end`

async function setup(t) {
  const directory = await mkdtemp(join(tmpdir(), 'qxqy-audio-web-'))
  const requests = []
  const store = new AudioAssetStore({ cacheDir: join(directory, 'cache'), fetch: async url => {
    requests.push(String(url))
    if (String(url).endsWith('/20001.mp3')) await new Promise(resolve => setTimeout(resolve, 600))
    return new Response(tone)
  } })
  const studio = createStudio()
  studio.patch({ op: 'addScript', controlId: 'n1', path: 'audio.lua', source })
  await writeFile(join(directory, 'audio.save.json'), JSON.stringify(studio.archiveData()))
  const app = await createWebServer({ workspace: directory, initialPath: 'audio.save.json', port: 0, audioAssets: store })
  const env = { directory, requests, store, app }
  t.after(async () => { await env.browser?.close(); await app.close(); await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) })
  return env
}

test('audio HTTP endpoint is lazy, persistent, range-capable and cacheable', async t => {
  const { app, requests } = await setup(t)
  const url = app.url + audioAssetUrl(50888)
  assert.equal(requests.length, 0)
  const [a, b] = await Promise.all([fetch(url), fetch(url)])
  assert.equal(a.status, 200); assert.equal(b.status, 200)
  assert.deepEqual(Buffer.from(await a.arrayBuffer()), tone)
  assert.equal(requests.length, 1)
  assert.equal(a.headers.get('content-type'), 'audio/mpeg')
  assert.equal(a.headers.get('cache-control'), 'private, max-age=43200')
  assert.equal((await fetch(url, { headers: { 'if-none-match': a.headers.get('etag') } })).status, 304)
  const range = await fetch(url, { headers: { range: 'bytes=10-19' } })
  assert.equal(range.status, 206)
  assert.equal(range.headers.get('content-range'), `bytes 10-19/${tone.length}`)
  assert.deepEqual(Buffer.from(await range.arrayBuffer()), tone.subarray(10, 20))
  const suffix = await fetch(url, { headers: { range: 'bytes=-10' } })
  assert.deepEqual(Buffer.from(await suffix.arrayBuffer()), tone.subarray(-10))
  for (const range of ['bytes=999999-', 'bytes=10-1', 'bytes=0-1,5-6', 'bytes=-0']) assert.equal((await fetch(url, { headers: { range } })).status, 416)
  const head = await fetch(url, { method: 'HEAD' })
  assert.equal(head.status, 200); assert.equal((await head.arrayBuffer()).byteLength, 0)
  assert.equal((await fetch(app.url + audioAssetUrl(999999))).status, 404)
  assert.equal((await fetch(app.url + '/qxqy-audio')).status, 404)
  assert.equal(requests.length, 1)
})

test('browser decodes MP3, unlocks on gesture, plays Lua once, pauses/stops and cancels cold-load playback', {
  skip: !process.env.QXQY_BROWSER, timeout: 90_000,
}, async t => {
  const env = await setup(t), { app, directory, requests } = env
  const browser = env.browser = await startTestBrowser(directory, ['--autoplay-policy=document-user-activation-required'])
  await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.audioProbe={starts:[],stops:0,contexts:[],decodes:0};
    const Context=window.AudioContext;
    window.AudioContext=class extends Context {
      constructor(...args){super(...args);audioProbe.contexts.push(this)}
      decodeAudioData(...args){audioProbe.decodes++;return super.decodeAudioData(...args)}
      createBufferSource(){const s=super.createBufferSource(),start=s.start.bind(s),stop=s.stop.bind(s);
        s.start=(...args)=>{audioProbe.starts.push({offset:args[1]||0,duration:s.buffer.duration,energy:s.buffer.getChannelData(0).some(x=>Math.abs(x)>0.001)});return start(...args)};
        s.stop=(...args)=>{audioProbe.stops++;return stop(...args)};return s}
    };
  ` }, browser.sessionId)
  // Initialize the saved editor session through the real API, then open its
  // production standalone play page, which automatically calls Lua OnStart.
  await fetch(app.url + '/editor/api/get', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: 'audio-test' }) })
  await browser.navigate(app.url + '/editor/play#audio-test')
  const readNoGesture = async expression => (await browser.send('Runtime.evaluate', { expression, returnByValue: true }, browser.sessionId)).result.value
  for (let i = 0; i < 100 && !(await readNoGesture('audioProbe.decodes > 0')); i++) await new Promise(resolve => setTimeout(resolve, 30))
  assert.equal(await readNoGesture('audioProbe.starts.length'), 0, 'autoplay has not received a trusted user gesture')
  // A real keyboard input unlocks audio even though it is not a gameplay key.
  await browser.key(' ', 'Space')
  try { await browser.wait('audioProbe.starts.length === 1') }
  catch (error) { throw new Error(`${error.message}\n${JSON.stringify(await browser.evaluate('({starts:audioProbe.starts,decodes:audioProbe.decodes,contexts:audioProbe.contexts.map(c=>c.state),title:document.getElementById("audio").title})'))}\n${JSON.stringify(requests)}`) }
  assert.equal(await browser.evaluate('audioProbe.starts[0].energy'), true, 'decoded synthetic sound contains nonzero samples')
  assert.equal(requests.length, 1)
  await browser.evaluate('new Promise(r=>setTimeout(r,100))')
  assert.equal(await browser.evaluate('audioProbe.starts.length'), 1, 'polling does not replay an instance')
  await browser.evaluate(`document.getElementById('pause').click()`)
  await browser.wait('audioProbe.stops >= 1')
  await browser.evaluate(`document.getElementById('pause').click()`)
  await browser.wait('audioProbe.starts.length === 2')
  assert.ok(await browser.evaluate('audioProbe.starts[1].offset > 0'))
  await browser.key('2', 'Digit2')
  await browser.wait('audioProbe.stops >= 2')
  await browser.key('1', 'Digit1')
  await browser.wait('audioProbe.starts.length === 3')
  assert.equal(requests.length, 1)
  assert.equal(await browser.evaluate('audioProbe.decodes'), 1)
  await browser.key('3', 'Digit3')
  await browser.key('2', 'Digit2')
  await browser.evaluate('new Promise(r=>setTimeout(r,900))')
  assert.equal(await browser.evaluate('audioProbe.starts.length'), 3, 'StopAudio cancelled the delayed download before playback')
  const before = requests.length
  await browser.evaluate(`fetch(${JSON.stringify(audioAssetUrl(10008))}).then(r=>r.arrayBuffer())`)
  assert.equal(requests.length, before)
  await browser.evaluate(`document.getElementById('audio').click()`)
  await browser.wait(`document.getElementById('audio').textContent === '声音已关闭'`)
  await browser.evaluate(`document.getElementById('stop').click()`)
  await browser.wait(`document.getElementById('state').textContent.includes('试玩已结束')`)
})
