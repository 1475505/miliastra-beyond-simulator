import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { createWebServer } from '../server.js'
import { UIVfxAssetStore } from '../../studio/host/ui-vfx-assets.js'
import { uiVfxMedia, uiVfxUrl } from '../../studio/assets/ui-vfx-catalog.js'
import { ctVideo, ctFullscreenVideo } from '../../studio/test/fixtures/ct-video.js'
import { createStudio } from '../../studio/index.js'
import { startTestBrowser } from './browser-helper.mjs'

const hash = data => createHash('sha256').update(data).digest('hex')
const bad = Buffer.from('This is not a WebM')
const videoPath = 'video/10001001.webm'
const fixtureMedia = path => path === 'video/10001004.webm' ? { bytes: bad.length, sha256: hash(bad) }
  : path === 'video/10002001.webm' ? { bytes: ctFullscreenVideo.length, sha256: hash(ctFullscreenVideo) }
  : path.startsWith('video/') && uiVfxMedia(path) ? { bytes: ctVideo.length, sha256: hash(ctVideo) } : uiVfxMedia(path)

async function setup(t) {
  const directory = await mkdtemp(join(tmpdir(), 'qxqy-vfx-'))
  const requests = []
  const fetcher = async url => {
    const path = new URL(url).pathname
    requests.push(path)
    if (path.endsWith('10001002.webm')) return new Response('offline', { status: 404 })
    if (path.endsWith('10001003.webm')) await new Promise(resolve => setTimeout(resolve, 700))
    if (path.endsWith('10002001.webm')) return new Response(ctFullscreenVideo)
    return new Response(path.endsWith('10001004.webm') ? bad : ctVideo)
  }
  const store = new UIVfxAssetStore({ cacheDir: join(directory, 'cache'), fetch: fetcher, media: fixtureMedia })
  const studio = createStudio()
  const added = studio.patch({ op: 'add', parentId: 'n1', kind: 'animation', name: 'Effect' })
  const id = added.selectedId
  studio.patch({ op: 'set', id, key: 'animationId', value: '10001001' })
  studio.patch({ op: 'set', id, key: 'playSoundEffect', value: false })
  studio.patch({ op: 'addScript', controlId: 'n1', path: 'vfx.lua', source: `
function OnStart()
 local a = script.object:GetChild("Effect")
 script.object:AddKeyEventListener(Enum.KeyEventType.KeyboardCraftspersonKey1Down, function() a:StopAnimation() end)
 script.object:AddKeyEventListener(Enum.KeyEventType.KeyboardCraftspersonKey2Down, function() a:PlayAnimation() end)
 script.object:AddKeyEventListener(Enum.KeyEventType.KeyboardCraftspersonKey3Down, function() a.animationId = 10001002 end)
 script.object:AddKeyEventListener(Enum.KeyEventType.KeyboardCraftspersonKey4Down, function() a.animationId = 10001004 end)
 script.object:AddKeyEventListener(Enum.KeyEventType.KeyboardCraftspersonKey5Down, function() a.animationId = 10001001 end)
end` })
  await writeFile(join(directory, 'vfx.save.json'), JSON.stringify(studio.archiveData()))
  const app = await createWebServer({ workspace: directory, initialPath: 'vfx.save.json', port: 0, uiVfxAssets: store })
  const env = { directory, store, requests, app, id }
  t.after(async () => { await env.browser?.close(); await app.close(); await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) })
  return env
}

test('VFX HTTP failures, corruption and timeouts stay local; cache and byte ranges survive offline restart', async t => {
  const { directory, app, store, requests } = await setup(t)
  const url = app.url + uiVfxUrl(videoPath)
  const results = await Promise.all([fetch(url), fetch(url)])
  assert.equal(requests.length, 1)
  assert.deepEqual(Buffer.from(await results[0].arrayBuffer()), ctVideo)
  assert.equal(results[1].headers.get('content-type'), 'video/webm')
  await results[1].arrayBuffer()
  const range = await fetch(url, { headers: { range: 'bytes=20-49' } })
  assert.equal(range.status, 206)
  assert.equal(range.headers.get('content-range'), `bytes 20-49/${ctVideo.length}`)
  assert.deepEqual(Buffer.from(await range.arrayBuffer()), ctVideo.subarray(20, 50))
  assert.equal((await fetch(url, { headers: { range: 'bytes=-0' } })).status, 416)
  assert.equal((await fetch(url, { method: 'HEAD' })).headers.get('content-length'), String(ctVideo.length))
  const offline = new UIVfxAssetStore({ cacheDir: join(directory, 'cache'), media: fixtureMedia, fetch: () => { throw new Error('offline') } })
  assert.deepEqual((await offline.get(videoPath)).data, ctVideo)
  await writeFile(join(store.stores.video.directory, '10001001.webm'), 'broken')
  assert.deepEqual((await store.get(videoPath)).data, ctVideo)
  assert.equal(requests.length, 2)
  const missing = app.url + uiVfxUrl('video/10001002.webm')
  assert.equal((await fetch(missing)).status, 404)
  assert.equal((await fetch(missing)).status, 404)
  assert.equal(requests.filter(path => path.endsWith('10001002.webm')).length, 1)
  assert.equal((await fetch(missing + '?retry=1')).status, 404)
  assert.equal(requests.filter(path => path.endsWith('10001002.webm')).length, 2, 'explicit replay bypasses cooldown')
  const etag = results[0].headers.get('etag')
  assert.equal((await fetch(url, { headers: { 'if-none-match': etag } })).status, 304)
  const tail = await fetch(url, { headers: { range: 'bytes=-15' } })
  assert.equal(tail.status, 206)
  assert.deepEqual(Buffer.from(await tail.arrayBuffer()), ctVideo.subarray(-15))
  assert.equal((await fetch(app.url + '/qxqy-vfx/ct-v1/video/999.webm')).status, 404)
  assert.equal((await fetch(url)).status, 200, 'healthy resources remain usable after failed media')
  const corrupt = new UIVfxAssetStore({ cacheDir: join(directory, 'corrupt'), fetch: async () => new Response('<html>no</html>') })
  await assert.rejects(corrupt.get(videoPath), /integrity/)
  const timeout = new UIVfxAssetStore({ cacheDir: join(directory, 'timeout'), timeout: 20,
    fetch: (_url, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('timeout')), { once: true })) })
  await assert.rejects(timeout.get(videoPath), /timeout/)
})

test('browser plays packed effects, preserves manual frames and composition, and survives missing/invalid video', {
  skip: !process.env.QXQY_BROWSER, timeout: 90_000,
}, async t => {
  const env = await setup(t), { app, directory } = env
  const browser = env.browser = await startTestBrowser(directory)
  await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.vfxErrors=[]; window.addEventListener('error', e=>vfxErrors.push(e.message));
    window.addEventListener('unhandledrejection', e=>vfxErrors.push(String(e.reason)));
  ` }, browser.sessionId)
  await fetch(app.url + '/editor/api/get', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: 'vfx-test' }) })
  await browser.navigate(app.url + '/editor/play#vfx-test')
  await browser.wait(`document.querySelector('[data-ui-vfx]')?.style.display === ''`)
  await browser.key('1', 'Digit1')
  await browser.wait(`document.querySelectorAll('[data-ui-vfx]').length === 0`)
  await browser.key('2', 'Digit2')
  await browser.wait(`document.querySelector('[data-ui-vfx]')?.style.display === ''`)
  await browser.key('3', 'Digit3')
  await browser.wait(`document.querySelector('[data-ui-vfx-status]')?.title.includes('10001002')`)
  assert.equal(await browser.evaluate(`document.getElementById('fatal').classList.contains('hidden')`), true)
  await browser.key('4', 'Digit4')
  await browser.wait(`document.querySelector('[data-ui-vfx-status]')?.title.includes('10001004')`)
  await browser.key('5', 'Digit5')
  await browser.wait(`document.querySelector('[data-ui-vfx]')?.style.display === '' && !document.querySelector('[data-ui-vfx-status]').textContent`)
  await browser.evaluate(`document.getElementById('stop').click()`)
  await browser.wait(`document.querySelectorAll('[data-ui-vfx]').length === 0`)

  // Use the production Pixi+DOM adapter over a known opaque RGB backdrop. The
  // expected C+B*T values are independent of the code under test.
  await browser.evaluate(`(async()=>{
    const {PixiPlayRenderer}=await import('/editor/play-renderer.js');
    const stage=document.createElement('div'); stage.id='test-stage';
    Object.assign(stage.style,{position:'fixed',left:'0px',top:'0px',width:'320px',height:'240px',background:'rgb(80,100,120)',isolation:'isolate',zIndex:'999999'});
    document.body.append(stage); const cv=document.createElement('canvas');
    Object.assign(cv.style,{position:'absolute',inset:'0',width:'100%',height:'100%'});stage.append(cv);
    window.vfxRenderer=new PixiPlayRenderer(cv); await vfxRenderer.render([],320,240);
    window.frame=(time=0.1,extra={})=>({running:true,clockMode:'manual',time,canvasWidth:320,canvasHeight:240,effects:[{
      id:1,kind:'animation',animationId:10001001,generation:1,startedAt:0,matrix:{a:1,b:0,c:0,d:1,tx:160,ty:120},masks:[],...extra}]});
    vfxRenderer.syncEffects(frame());
  })()`)
  await browser.wait(`vfxRenderer.effects.entries.get('1')?.ready && !vfxRenderer.effects.entries.get('1').video.seeking && document.querySelector('#test-stage [data-ui-vfx]').style.display === ''`)
  const pixel = async () => {
    const { data } = await browser.send('Page.captureScreenshot', { format: 'png', clip: { x: 159, y: 119, width: 1, height: 1, scale: 1 } }, browser.sessionId)
    const canvas = createCanvas(1, 1), ctx = canvas.getContext('2d')
    ctx.drawImage(await loadImage(Buffer.from(data, 'base64')), 0, 0)
    return [...ctx.getImageData(0, 0, 1, 1).data]
  }
  const first = await pixel()
  for (const [i, expected] of [42, 63, 147].entries()) assert.ok(Math.abs(first[i] - expected) <= 5, `C+B*T channel ${i}: ${first}`)
  await browser.evaluate(`new Promise(r=>setTimeout(r,300))`)
  assert.deepEqual(await pixel(), first, 'manual clock does not advance while waiting')
  await browser.evaluate(`vfxRenderer.syncEffects(frame(1.2))`)
  await browser.wait(`!vfxRenderer.effects.entries.get('1').video.seeking && Math.abs(vfxRenderer.effects.entries.get('1').video.currentTime-1.2)<0.01`)
  const next = await pixel()
  assert.ok(next[0] > first[0] + 15 && next[2] < first[2] - 20, `${first} -> ${next}`)
  await browser.evaluate(`vfxRenderer.syncEffects(frame(10.2))`)
  await browser.wait(`Math.abs(vfxRenderer.effects.entries.get('1').video.currentTime-5.2)<0.01`)
  // Alpha-0.5 at the center of a feathered ancestor: C'=m*C, T'=1-m+m*T.
  await browser.evaluate(`vfxRenderer.syncEffects(frame(0.1,{masks:[{id:9,matrix:{a:1,b:0,c:0,d:1,tx:160,ty:120},width:182,height:182,featherX:182,featherY:0}]}))`)
  await browser.wait(`!vfxRenderer.effects.entries.get('1').video.seeking`)
  const masked = await pixel()
  for (const [i, expected] of [61, 81.5, 133.5].entries()) assert.ok(Math.abs(masked[i] - expected) <= 6, `mask channel ${i}: ${masked}`)
  await browser.evaluate(`vfxRenderer.syncEffects(frame(0.1,{matrix:{a:0,b:0.5,c:-1,d:0,tx:160,ty:120},masks:[
    {id:9,matrix:{a:1,b:0,c:0,d:1,tx:160,ty:120},width:182,height:182,featherX:182,featherY:0},
    {id:10,matrix:{a:1,b:0,c:0,d:1,tx:160,ty:120},width:182,height:182,featherX:0,featherY:182}]}))`)
  const nested = await pixel()
  for (const [i, expected] of [70.5, 90.75, 126.75].entries()) assert.ok(Math.abs(nested[i] - expected) <= 6, `nested mask channel ${i}: ${nested}`)
  const rotatedRect = await browser.evaluate(`(()=>{const r=document.querySelector('#test-stage [data-ui-vfx]').getBoundingClientRect();return {width:r.width,height:r.height}})()`)
  assert.ok(Math.abs(rotatedRect.width - 182) < 1 && Math.abs(rotatedRect.height - 91) < 1, 'rotation and nonuniform scale reach the planes')
  // Two independently timed instances must remain adjacent T/C pairs. Reversing
  // painter order changes the result; sharing a decoder would erase that change.
  await browser.evaluate(`window.two=frame(1.2); two.effects.push({...two.effects[0],id:2,startedAt:1.1}); vfxRenderer.syncEffects(two)`)
  await browser.wait(`vfxRenderer.effects.entries.size === 2 && [...vfxRenderer.effects.entries.values()].every(e=>e.ready&&!e.video.seeking&&e.planes[0].style.display==='')`)
  const overlap = await pixel()
  for (const [i, expected] of [39, 51, 138].entries()) assert.ok(Math.abs(overlap[i] - expected) <= 6, `overlap channel ${i}: ${overlap}`)
  await browser.evaluate(`two.effects.reverse(); vfxRenderer.syncEffects(two)`)
  const reversed = await pixel()
  for (const [i, expected] of [59, 58, 131].entries()) assert.ok(Math.abs(reversed[i] - expected) <= 6, `reverse channel ${i}: ${reversed}`)
  assert.deepEqual(await browser.evaluate(`[...document.querySelectorAll('#test-stage [data-ui-vfx]')].map(c=>c.dataset.uiVfx)`),
    ['2:multiply', '2:plus-lighter', '1:multiply', '1:plus-lighter'])
  // A normal opaque control covers below effects; above effects blend with it.
  await browser.evaluate(`vfxRenderer.syncEffects(frame(0.1,{layer:'BelowAllControls'}));
    const cover=document.createElement('div');cover.id='vfx-cover';Object.assign(cover.style,{position:'absolute',inset:'0',background:'rgb(20,40,60)'});document.getElementById('test-stage').append(cover)`)
  await browser.wait(`!vfxRenderer.effects.entries.get('1').video.seeking`)
  assert.deepEqual(await pixel(), [20, 40, 60, 255])
  await browser.evaluate(`vfxRenderer.syncEffects(frame(0.1,{layer:'AboveAllControls'}))`)
  const above = await pixel()
  for (const [i, expected] of [30, 33, 99].entries()) assert.ok(Math.abs(above[i] - expected) <= 5, `above channel ${i}: ${above}`)
  await browser.evaluate(`document.getElementById('vfx-cover').remove();vfxRenderer.syncEffects(frame(0.1,{animationId:999}))`)
  await browser.wait(`vfxRenderer.effects.errors.size === 1`)
  await browser.evaluate(`vfxRenderer.syncEffects(frame(0.1))`)
  await browser.wait(`vfxRenderer.effects.entries.get('1')?.ready && vfxRenderer.effects.errors.size === 0`)
  // Over-budget instances are skipped, then admitted when existing ones stop.
  await browser.evaluate(`const s=frame(); s.effects=Array.from({length:14},(_,i)=>({...s.effects[0],id:i+1}));vfxRenderer.syncEffects(s)`)
  assert.equal(await browser.evaluate(`vfxRenderer.effects.entries.size`), 12)
  await browser.evaluate(`vfxRenderer.syncEffects(frame(0.1,{id:14}))`)
  assert.equal(await browser.evaluate(`vfxRenderer.effects.entries.size`), 1)
  assert.equal(await browser.evaluate(`vfxRenderer.effects.errors.size`), 0)
  await browser.evaluate(`vfxRenderer.syncEffects(frame(2,{animationId:10001109}))`)
  assert.equal(await browser.evaluate(`vfxRenderer.effects.entries.size`), 0, 'single-shot effects release after logical duration')
  await browser.evaluate(`vfxRenderer.syncEffects(frame(0.1,{kind:'fullscreen',animationId:10002001,matrix:{a:0,b:0,c:0,d:0,tx:-900,ty:-900}}))`)
  await browser.wait(`vfxRenderer.effects.entries.get('1')?.ready && !vfxRenderer.effects.entries.get('1').video.seeking`)
  const fullscreen = await pixel()
  for (const [i, expected] of [42, 63, 147].entries()) assert.ok(Math.abs(fullscreen[i] - expected) <= 5, `fullscreen channel ${i}: ${fullscreen}`)
  const fullscreenRect = await browser.evaluate(`(()=>{const p=document.querySelector('#test-stage [data-ui-vfx]'),r=p.getBoundingClientRect();return {left:r.left,top:r.top,width:r.width,height:r.height,layer:p.style.zIndex}})()`)
  assert.equal(fullscreenRect.layer, '-1')
  assert.ok(Math.abs(fullscreenRect.height - 240) < 1 && Math.abs(fullscreenRect.width - 426.67) < 1, JSON.stringify(fullscreenRect))
  assert.ok(Math.abs(fullscreenRect.left + 53.33) < 1 && Math.abs(fullscreenRect.top) < 1, 'fullscreen cover ignores the control transform')
  await browser.evaluate(`vfxRenderer.effects.timeout=40;vfxRenderer.syncEffects(frame(0.1,{animationId:10001003,generation:2}))`)
  await browser.wait(`vfxRenderer.effects.entries.get('1')?.failed && vfxRenderer.effects.badge.title.includes('timed out')`)
  await browser.evaluate(`vfxRenderer.resetEffects()`)
  await browser.evaluate(`new Promise(r=>setTimeout(r,900))`)
  assert.equal(await browser.evaluate(`document.querySelectorAll('#test-stage [data-ui-vfx]').length`), 0, 'stop during download cannot resurrect a pair')
  await browser.evaluate(`for(let i=0;i<40;i++){vfxRenderer.syncEffects(frame(0.1,{generation:i+2}));vfxRenderer.resetEffects()}`)
  assert.deepEqual(await browser.evaluate(`({entries:vfxRenderer.effects.entries.size,raf:vfxRenderer.effects.raf,planes:document.querySelectorAll('#test-stage [data-ui-vfx]').length})`),
    { entries: 0, raf: null, planes: 0 })
  await browser.evaluate(`vfxRenderer.destroy(); document.getElementById('test-stage').remove()`)
  assert.deepEqual(await browser.evaluate('vfxErrors'), [])
})

test('editor picker, layering, replay and failure recovery remain editable; preview mode releases effects', {
  skip: !process.env.QXQY_BROWSER, timeout: 90_000,
}, async t => {
  const env = await setup(t), { app, directory, id } = env
  const browser = env.browser = await startTestBrowser(directory)
  await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.vfxErrors=[];window.addEventListener('error',e=>vfxErrors.push(e.message));
    window.addEventListener('unhandledrejection',e=>vfxErrors.push(String(e.reason)));
  ` }, browser.sessionId)
  await browser.navigate(app.url + '/editor')
  await browser.wait(`document.querySelector('.qxsim-stage [data-ui-vfx]')?.style.display === ''`)
  await browser.evaluate(`Array.from(document.querySelectorAll('.qxsim-row')).find(row=>row.querySelector('.qxsim-row-label')?.textContent==='Effect').click()`)
  await browser.wait(`Boolean(document.querySelector('[data-ui-vfx-picker]'))`)
  const click = text => browser.evaluate(`Array.from(document.querySelectorAll('[data-ui-vfx-picker] button')).find(b=>b.textContent===${JSON.stringify(text)}).click()`)
  await click('停止预览')
  await browser.wait(`document.querySelectorAll('.qxsim-stage [data-ui-vfx]').length === 0`)
  await click('重播 / 重试')
  await browser.wait(`document.querySelector('.qxsim-stage [data-ui-vfx]')?.style.display === ''`)
  await browser.evaluate(`const s=Array.from(document.querySelectorAll('.qxsim-field')).find(f=>f.textContent.includes('动效层级')).querySelector('select');s.value='BelowAllControls';s.dispatchEvent(new Event('change',{bubbles:true}))`)
  await browser.wait(`document.querySelector('.qxsim-stage [data-ui-vfx]')?.style.zIndex === '-1'`)
  await click('选择素材')
  await browser.wait(`Boolean(document.querySelector('[aria-label="搜索动效"]'))`)
  const search = async value => {
    await browser.evaluate(`(()=>{const input=document.querySelector('[aria-label="搜索动效"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}))})()`)
    await browser.wait(`document.querySelectorAll('[data-ui-vfx-picker] button[title]').length === 1`)
    await browser.evaluate(`document.querySelector('[data-ui-vfx-picker] button[title]').click()`)
    await browser.wait(`!document.querySelector('[aria-label="搜索动效"]')`)
  }
  await search('10001002')
  await browser.wait(`document.querySelector('[data-ui-vfx-status]')?.title.includes('10001002')`)
  const failures = env.requests.filter(path => path.endsWith('10001002.webm')).length
  await browser.evaluate(`window.previousEffect=document.querySelector('.qxsim-stage [data-ui-vfx]')`)
  await click('重播 / 重试')
  await browser.wait(`!previousEffect.isConnected && document.querySelector('[data-ui-vfx-status]')?.title.includes('10001002')`)
  assert.ok(env.requests.filter(path => path.endsWith('10001002.webm')).length > failures)
  await click('选择素材')
  await search('10001001')
  await browser.wait(`document.querySelector('.qxsim-stage [data-ui-vfx]')?.style.display === '' && !document.querySelector('[data-ui-vfx-status]').textContent`)
  assert.equal(await browser.evaluate(`Boolean(document.querySelector('[data-selection-id="${id}"]'))`), true)
  await browser.evaluate(`document.querySelector('[aria-label="Effect画布可见性"]').click()`)
  await browser.wait(`document.querySelectorAll('.qxsim-stage [data-ui-vfx]').length === 0`)
  await browser.evaluate(`document.querySelector('[aria-label="Effect画布可见性"]').click()`)
  await browser.wait(`document.querySelector('.qxsim-stage [data-ui-vfx]')?.style.display === ''`)
  assert.deepEqual(await browser.evaluate('vfxErrors'), [])

  // The read-only preview uses a static PNG in editor mode. A live effect must
  // disappear immediately on that transition, even when polling has stopped.
  await browser.navigate(app.url)
  await browser.wait(`document.getElementById('active-path').textContent === 'vfx.save.json' && !document.getElementById('play-start').disabled`)
  await browser.evaluate(`document.getElementById('mode-play').click();document.getElementById('play-start').click()`)
  await browser.wait(`document.querySelector('[data-ui-vfx]')?.style.display === ''`)
  assert.equal(await browser.evaluate(`(()=>{const c=document.getElementById('stage-canvas').getBoundingClientRect(),p=document.getElementById('stage-play').getBoundingClientRect();return Math.abs(c.width-(p.width-2))<1&&Math.abs(c.height-(p.height-2))<1})()`), true, 'canvas and effect viewport share the same content box')
  await browser.evaluate(`document.getElementById('mode-editor').click()`)
  await browser.wait(`document.querySelectorAll('[data-ui-vfx]').length === 0`)
  await browser.evaluate(`document.getElementById('mode-play').click()`)
  await browser.wait(`document.querySelector('[data-ui-vfx]')?.style.display === ''`)
  await browser.evaluate(`document.getElementById('play-stop').click()`)
  await browser.wait(`document.querySelectorAll('[data-ui-vfx]').length === 0`)
  assert.deepEqual(await browser.evaluate('vfxErrors'), [])
})
