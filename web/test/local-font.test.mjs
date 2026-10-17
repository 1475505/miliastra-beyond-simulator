import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createWebServer } from '../server.js'
import { localFont } from '../../studio/host/local-font.js'
import { geometryFont } from '../../studio/test/fixtures/geometry-font.mjs'
import { fontFamily } from '../../studio/fonts.js'
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
    await rm(directory, { recursive: true, force: true })
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
  const state = await (await fetch(app.url + '/api/state', { headers: auth })).text()
  assert.ok(!state.includes('user-font.ttf') && !state.includes(id), 'project observations never expose font configuration')
  await app.close()
  app = await createWebServer({ workspace: directory, port: 0 })

  await t.test('browser waits for font, uses it in DOM/Pixi and preserves geometry metrics', {
    skip: !process.env.QXQY_BROWSER, timeout: 60_000,
  }, async () => {
    browser = await startTestBrowser(directory)
    const { evaluate, wait } = browser
    await browser.navigate(app.url + '/editor')
    await wait(`document.querySelector('.qxsim-box.textbox')?.style.fontFamily.includes('QxqyLocal_')`)
    const family = fontFamily(id)
    assert.ok((await evaluate(`getComputedStyle(document.querySelector('.qxsim-box.textbox')).fontFamily`)).includes(family))
    await evaluate(`(async()=>{
      const {PixiPlayRenderer,loadBrowserFont}=await import('/play-renderer.js');
      const cv=document.createElement('canvas');document.body.append(cv);
      window.fontRenderer=new PixiPlayRenderer(cv,{fontReady:loadBrowserFont()});
      await fontRenderer.applyScene({format:'tree-v1',reset:true,nodes:[{
        id:1,parent:null,z:0,kind:'textbox',text:'AB',fontSize:20,fontColor:0xffffffff,bgColor:0,
        enableOutline:false,horizontalAlignment:'Left',verticalAlignment:'Top',sourceWidth:80,sourceHeight:80,
        matrix:{a:1,b:0,c:0,d:1,tx:40,ty:40}
      }]},80,80);
    })()`)
    const metrics = await evaluate(`(()=>{
      const text=fontRenderer.nodes.get(1).__visual.children.find(child=>child.text==='AB');
      const ctx=document.createElement('canvas').getContext('2d');ctx.font='20px '+text.style.fontFamily;
      const cv=fontRenderer.app.renderer.extract.canvas({target:fontRenderer.nodes.get(1).__visual,resolution:1,clearColor:'#000000'});
      const data=cv.getContext('2d').getImageData(0,0,cv.width,cv.height).data;
      let white=0;for(let i=0;i<data.length;i+=4)if(data[i]>240&&data[i+1]>240&&data[i+2]>240)white++;
      return {family:text.style.fontFamily,width:ctx.measureText('AB').width,white};
    })()`)
    assert.ok(metrics.family.includes(family))
    assert.ok(Math.abs(metrics.width - 28) < 0.2, JSON.stringify(metrics))
    assert.ok(metrics.white > 150, 'actual WebGL output contains our rectangular glyphs')
    await evaluate('fontRenderer.destroy()')
  })
})
