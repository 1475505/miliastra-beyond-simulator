import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createWebServer } from '../server.js'
import { localFont } from '../../studio/host/local-font.js'
import { geometryFont } from '../../studio/test/fixtures/geometry-font.mjs'
import { fontFamily } from '../../studio/fonts.js'
import { createRuntime } from '../../client/lua-runtime/src/index.js'
import { playSnapshot } from '../../studio/play/session.js'
import { startTestBrowser } from './browser-helper.mjs'

test('Web local font authentication, privacy, export boundary and real browser rendering', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'qxqy-font-web-'))
  const path = join(directory, 'user-font.ttf'), bytes = geometryFont()
  await writeFile(path, bytes)
  const previous = process.env.QXQY_FONT_PATH
  process.env.QXQY_FONT_PATH = path
  let app, browser
  t.after(async () => {
    await browser?.close(); await app?.close()
    if (previous === undefined) delete process.env.QXQY_FONT_PATH; else process.env.QXQY_FONT_PATH = previous
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  })
  await assert.rejects(createWebServer({ workspace: directory, host: '0.0.0.0', port: 0, password: 'test' }), /loopback-only/)
  app = await createWebServer({ workspace: directory, port: 0, password: 'test' })
  const auth = { authorization: `Basic ${Buffer.from('simulator:test').toString('base64')}` }
  const manifestUrl = app.url + '/qxqy-font/manifest'
  assert.equal((await fetch(manifestUrl)).status, 401)
  const manifest = await fetch(manifestUrl, { headers: auth })
  const { id } = await manifest.json()
  assert.equal(id, localFont().id)
  const response = await fetch(`${app.url}/qxqy-font/file/${id}`, { headers: auth })
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.equal(response.headers.get('cross-origin-resource-policy'), 'same-origin')
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes)
  assert.equal((await fetch(manifestUrl, { headers: { ...auth, origin: 'https://example.invalid' } })).status, 403)
  assert.equal((await fetch(`${app.url}/qxqy-font/file/not-a-font`, { headers: auth })).status, 404)
  const state = await (await fetch(app.url + '/api/state', { headers: auth })).text()
  assert.ok(!state.includes('user-font.ttf') && !state.includes(id), 'project observations never expose font configuration')
  await app.close()
  app = await createWebServer({ workspace: directory, port: 0 })

  await t.test('browser uses the loaded font in editor text and incremental fitted Pixi scenes', {
    skip: !process.env.QXQY_BROWSER, timeout: 60_000,
  }, async () => {
    browser = await startTestBrowser(directory)
    const { evaluate, wait } = browser
    await browser.navigate(app.url + '/editor')
    await wait(`document.querySelector('.qxsim-box.textbox')?.style.fontFamily.includes('QxqyLocal_')`)
    const family = fontFamily(id)
    assert.ok((await evaluate(`getComputedStyle(document.querySelector('.qxsim-box.textbox span')).fontFamily`)).includes(family),
      'the actual text span must not override the loaded font')
    const runtime = createRuntime({ canvasWidth: 240, canvasHeight: 160 })
    t.after(() => runtime.destroy())
    const label = runtime.addRoot({ kind: 'textbox', active: true, visible: true, text: 'A\nB', fontSize: 40,
      minimumFontSize: 10, adaptiveFontSize: true, sizeDeltaX: 160, sizeDeltaY: 40,
      fontColor: 0xffffffff, bgColor: 0, enableOutline: false, horizontalAlignment: 'Left', verticalAlignment: 'Top' })
    const session = { runtime, compiled: { canvasId: 'pc-16-9', platform: 'PC' }, history: [] }
    await evaluate(`(async()=>{
      const {PixiPlayRenderer,loadBrowserFont}=await import('/play-renderer.js');
      const cv=document.createElement('canvas');document.body.append(cv);
      window.fontRenderer=new PixiPlayRenderer(cv,{fontReady:loadBrowserFont()});
      await fontRenderer.ready;
    })()`)
    let revision
    for (const [adaptive, minimum, expected] of [[true, 10, 13], [false, 10, 40], [true, 24, 24]]) {
      label.adaptiveFontSize = adaptive
      label.minimumFontSize = minimum
      label.markPlayDirty()
      const scene = playSnapshot(session, { view: true, sceneRev: revision }).scene
      const metrics = await evaluate(`(async()=>{
        await fontRenderer.applyScene(${JSON.stringify(scene)},240,160);
        const text=fontRenderer.nodes.get(${label.Id}).__visual.children.find(child=>typeof child.text==='string');
        const ctx=document.createElement('canvas').getContext('2d');ctx.font='20px '+text.style.fontFamily;
        const cv=fontRenderer.app.renderer.extract.canvas({target:fontRenderer.app.stage,resolution:1});
        const data=cv.getContext('2d').getImageData(0,0,cv.width,cv.height).data;
        let white=0;for(let i=0;i<data.length;i+=4)if(data[i+3]>100&&data[i]>240&&data[i+1]>240&&data[i+2]>240)white++;
        return {family:text.style.fontFamily,width:ctx.measureText('AB').width,white,font:text.style.fontSize,wrap:text.style.wordWrap};
      })()`)
      assert.ok(metrics.family.includes(family))
      assert.ok(Math.abs(metrics.width - 28) < 0.2, JSON.stringify(metrics))
      assert.equal(metrics.font, expected)
      assert.equal(metrics.wrap, false, 'Pixi must consume the host line breaks without wrapping a second time')
      // The synthetic A alone covers 0.6 * 0.7 * size²; allow edge
      // antialiasing while scaling the lower bound with the fitted size.
      assert.ok(metrics.white > expected * expected * 0.25, JSON.stringify(metrics))
      revision = scene.revision
    }
    await evaluate('fontRenderer.destroy()')
  })
})
