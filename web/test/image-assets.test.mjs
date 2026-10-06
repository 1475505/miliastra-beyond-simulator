import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { createWebServer } from '../server.js'
import { ImageAssetStore } from '../../studio/host/image-assets.js'
import { imageAssetUrl } from '../../studio/assets/catalog.js'
import { createStudio } from '../../studio/index.js'
import { startTestBrowser } from './browser-helper.mjs'

const { createCanvas } = createRequire(new URL('../../studio/package.json', import.meta.url))('@napi-rs/canvas')

async function setup(t) {
  const directory = await mkdtemp(join(tmpdir(), 'qxqy-image-web-'))
  const canvas = createCanvas(2, 2), ctx = canvas.getContext('2d')
  ctx.fillStyle = '#80c840'; ctx.fillRect(0, 0, 2, 2)
  let png = canvas.toBuffer('image/png')
  const metadata = { m_Rect: { width: 10, height: 8 }, m_RD: {
    textureRectOffset: { X: 2, Y: 1 }, textureRect: { width: 2, height: 2 }, settingsRaw: { packingRotation: 'None' },
  } }
  const requests = []
  const store = new ImageAssetStore({ cacheDir: join(directory, 'cache'), fetch: async url => {
    requests.push(String(url))
    if (String(url).includes('101002')) await new Promise(resolve => setTimeout(resolve, 200))
    return String(url).endsWith('.png') ? new Response(png) : Response.json(metadata)
  } })
  const studio = createStudio()
  studio.patch({ op: 'set', id: 'n9', key: 'imageId', value: 101001 })
  studio.patch({ op: 'set', id: 'n9', key: 'imageColor', value: 0xffff80ff })
  studio.patch({ op: 'select', id: 'n9' })
  await writeFile(join(directory, 'images.save.json'), JSON.stringify(studio.archiveData()))
  const app = await createWebServer({ workspace: directory, port: 0, initialPath: 'images.save.json', imageAssets: store })
  const handler = app.server.listeners('request')[0]
  app.server.removeListener('request', handler)
  app.server.on('request', (request, response) => {
    if (request.url === '/asset-frame') { response.setHeader('content-type', 'text/html'); response.end('<!doctype html><body></body>') }
    else void handler(request, response)
  })
  const env = { directory, app, requests, store, recolor() { ctx.fillStyle = '#4080c0'; ctx.fillRect(0, 0, 2, 2); png = canvas.toBuffer('image/png') } }
  t.after(async () => { await env.browser?.close(); await app.close(); await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) })
  return env
}

test('image route supports HTTP cache/ETag, rejects unknown IDs and shares cache with PNG preview', async t => {
  const { app, requests } = await setup(t)
  const url = app.url + imageAssetUrl(101001)
  const responses = await Promise.all([fetch(url), fetch(url)])
  assert.ok(responses.every(r => r.status === 200))
  assert.equal(requests.length, 2)
  const response = responses[0]
  assert.equal(response.headers.get('cache-control'), 'private, max-age=43200')
  assert.equal(response.headers.get('content-type'), 'image/png')
  assert.equal((await fetch(url, { headers: { 'if-none-match': response.headers.get('etag') } })).status, 304)
  const head = await fetch(url, { method: 'HEAD' })
  assert.equal(head.status, 200); assert.equal((await head.arrayBuffer()).byteLength, 0)
  assert.equal((await fetch(app.url + imageAssetUrl(101019))).status, 404)
  assert.equal((await fetch(app.url + '/qxqy-assets/sprite-v1/http.png')).status, 404)
  assert.equal((await fetch(app.url + '/api/editor.png')).status, 200)
  assert.equal(requests.length, 2)
  const refresh = await fetch(app.url + '/editor/api/image-refresh', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: 'images', imageId: 101001 }) })
  assert.equal(refresh.status, 200)
  assert.equal(requests.length, 4)
})

test('real browser: DOM tint, HTTP cache, Pixi static completion, stale-ID races, shared textures and refresh', {
  skip: !process.env.QXQY_BROWSER, timeout: 90_000,
}, async t => {
  const env = await setup(t)
  const { directory, app, requests } = env
  const browser = env.browser = await startTestBrowser(directory)
  const { evaluate, wait } = browser
  await browser.navigate(app.url + '/editor')
  await wait(`document.querySelector('canvas[data-image-id="101001"]')?.width === 10`)
  assert.deepEqual(await evaluate(`Array.from(document.querySelector('canvas[data-image-id="101001"]').getContext('2d').getImageData(2,5,1,1).data)`), [128, 100, 64, 255])
  assert.deepEqual(await evaluate(`Array.from(document.querySelector('canvas[data-image-id="101001"]').getContext('2d').getImageData(2,1,1,1).data)`), [0, 0, 0, 0])
  assert.equal(requests.length, 2)
  let localHits = 0
  const count = req => { if (req.url === imageAssetUrl(101001)) localHits++ }
  app.server.prependListener('request', count)
  await evaluate(`fetch(${JSON.stringify(imageAssetUrl(101001))}).then(r=>r.arrayBuffer())`)
  assert.equal(localHits, 0, 'normal repeated request uses browser HTTP cache')

  // Exercise the actual bundled renderer without advancing Runtime or polling.
  await evaluate(`(async()=>{
    const {PixiPlayRenderer}=await import('/play-renderer.js');
    const cv=document.createElement('canvas');document.body.append(cv);
    window.r=new PixiPlayRenderer(cv);
    window.item={id:1,parent:null,z:0,kind:'image',primitive:'sprite',imageId:101001,imageColor:0x80ff80ff,sourceWidth:100,sourceHeight:80,matrix:{a:1,b:0,c:0,d:1,tx:60,ty:50}};
    await r.applyScene({format:'tree-v1',reset:true,nodes:[item]},120,100);
  })()`)
  await wait(`!!r.imageTextures.get(101001)?.texture`)
  // Extract over opaque black: Pixi 8's raw transparent readback is
  // premultiplied, whereas Canvas2D getImageData returns straight RGBA.
  const colors = await evaluate(`(()=>{const cv=r.app.renderer.extract.canvas({target:r.nodes.get(1).__visual,resolution:1,clearColor:'#000000'});return Array.from(cv.getContext('2d').getImageData(25,55,1,1).data)})()`)
  for (let i = 0; i < 4; i++) assert.ok(Math.abs(colors[i] - [64, 50, 32, 255][i]) <= 2, JSON.stringify(colors))
  // Same ID across controls shares one GPU texture.
  await evaluate(`r.applyScene({format:'tree-v1',changed:[{...item,id:2}]},120,100)`)
  assert.equal(await evaluate(`r.nodes.get(1).__visual.children[0].texture === r.nodes.get(2).__visual.children[0].texture`), true)
  // A slow old ID cannot resurrect a removed node or replace its newer ID.
  await evaluate(`(async()=>{await r.applyScene({format:'tree-v1',changed:[{...item,imageId:101002}]},120,100);await r.applyScene({format:'tree-v1',changed:[item],removed:[2]},120,100)})()`)
  await evaluate(`new Promise(resolve=>setTimeout(resolve,500))`)
  assert.equal(await evaluate(`r.nodes.size===1 && r.nodes.get(1).__sceneItem.imageId===101001 && !r.imageTextures.has(101002)`), true)
  // Load completion doesn't need another scene delta; removal frees GPU source.
  await evaluate(`r.applyScene({format:'tree-v1',reset:true,nodes:[{...item,imageId:101002}]},120,100)`)
  await wait(`!!r.imageTextures.get(101002)?.texture`)
  assert.equal(await evaluate(`r.nodes.get(1).__visual.children[0].texture === r.imageTextures.get(101002).texture`), true)
  await evaluate(`window.oldTexture=r.imageTextures.get(101002).texture;r.destroy()`)
  assert.equal(await evaluate('oldTexture.destroyed'), true)

  // Refresh notifications cross documents (the real editor/play relationship),
  // replace texture bytes, and force redraw while no scene deltas are arriving.
  await evaluate(`(()=>{const frame=document.createElement('iframe');frame.id='asset-frame';frame.src='/asset-frame';document.body.append(frame)})()`)
  await wait(`document.querySelector('#asset-frame')?.contentDocument?.URL.endsWith('/asset-frame') && document.querySelector('#asset-frame').contentDocument.readyState === 'complete'`)
  await evaluate(`(async()=>{const w=document.querySelector('#asset-frame').contentWindow;const m=await w.eval("import('/play-renderer.js')");const cv=w.document.createElement('canvas');w.document.body.append(cv);w.r=new m.PixiPlayRenderer(cv);await w.r.applyScene({format:'tree-v1',reset:true,nodes:[item]},120,100)})()`)
  await wait(`!!document.querySelector('#asset-frame').contentWindow.r.imageTextures.get(101001)?.texture`)
  await evaluate(`(()=>{const w=document.querySelector('#asset-frame').contentWindow;w.old=w.r.imageTextures.get(101001).texture})()`)
  env.recolor()
  const before = requests.length
  await evaluate(`document.querySelectorAll('button').forEach(b=>{if(b.textContent==='↻ 重新下载此素材')b.click()})`)
  await wait(`document.body.textContent.includes('图片 101001 已重新下载')`)
  assert.equal(requests.length, before + 2)
  await wait(`document.querySelector('canvas[data-image-id="101001"]')?.width === 10`)
  await wait(`(()=>{const w=document.querySelector('#asset-frame').contentWindow;return w.old.destroyed && !!w.r.imageTextures.get(101001)?.texture})()`)
  assert.deepEqual(await evaluate(`Array.from(document.querySelector('canvas[data-image-id="101001"]').getContext('2d').getImageData(2,5,1,1).data)`), [64, 64, 192, 255])
  const refreshed = await evaluate(`(()=>{const w=document.querySelector('#asset-frame').contentWindow;const cv=w.r.app.renderer.extract.canvas({target:w.r.nodes.get(1).__visual,resolution:1,clearColor:'#000000'});return Array.from(cv.getContext('2d').getImageData(25,55,1,1).data)})()`)
  refreshed.forEach((v, i) => assert.ok(Math.abs(v - [32, 32, 96, 255][i]) <= 2, JSON.stringify(refreshed)))
  await evaluate(`document.querySelector('#asset-frame').contentWindow.r.destroy();document.querySelector('#asset-frame').remove()`)
  app.server.removeListener('request', count)
})
