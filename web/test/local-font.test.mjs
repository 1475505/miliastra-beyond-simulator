import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'
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
  const previousConfig = process.env.QXQY_FONT_CONFIG_PATH
  const config = join(directory, 'font.json')
  process.env.QXQY_FONT_CONFIG_PATH = config
  delete process.env.QXQY_FONT_PATH
  await writeFile(config, JSON.stringify({ mode: 'custom', path }))
  let app, browser
  t.after(async () => {
    await browser?.close(); await app?.close()
    if (previous === undefined) delete process.env.QXQY_FONT_PATH; else process.env.QXQY_FONT_PATH = previous
    if (previousConfig === undefined) delete process.env.QXQY_FONT_CONFIG_PATH; else process.env.QXQY_FONT_CONFIG_PATH = previousConfig
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  })
  await assert.rejects(createWebServer({ workspace: directory, host: '0.0.0.0', port: 0, password: 'test' }), /loopback-only/)
  app = await createWebServer({ workspace: directory, port: 0, password: 'test' })
  const auth = { authorization: `Basic ${Buffer.from('simulator:test').toString('base64')}` }
  const manifestUrl = app.url + '/qxqy-font/manifest'
  assert.equal((await fetch(manifestUrl)).status, 401)
  const settingsUrl = app.url + '/qxqy-font/settings'
  assert.equal((await fetch(settingsUrl)).status, 401)
  const settings = await (await fetch(settingsUrl, { headers: auth })).json()
  assert.equal(settings.path, path)
  assert.equal(settings.scope, 'all')
  const postSettings = value => fetch(settingsUrl, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify(value) })
  assert.equal((await fetch(settingsUrl, { headers: { ...auth, origin: 'https://example.invalid' } })).status, 403)
  const previousSettings = await readFile(config, 'utf8')
  assert.equal((await postSettings({ mode: 'custom', path: join(directory, 'missing.ttf') })).status, 400)
  assert.equal((await postSettings({ mode: 'custom', path, scope: 'invalid' })).status, 400)
  assert.equal(await readFile(config, 'utf8'), previousSettings)
  const changed = await (await postSettings({ mode: 'system' })).json()
  assert.equal(changed.restartRequired, true)
  assert.equal(localFont().data.length, bytes.length, 'active font remains stable until the host restarts')
  const manifest = await fetch(manifestUrl, { headers: auth })
  const { id, scope } = await manifest.json()
  assert.equal(id, localFont().id)
  assert.equal(scope, 'all')
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
    skip: !process.env.QXQY_BROWSER, timeout: 90_000,
  }, async () => {
    browser = await startTestBrowser(directory)
    const { evaluate, wait } = browser
    await browser.navigate(app.url + '/editor')
    await wait(`document.querySelector('.qxsim-box.textbox')?.style.fontFamily.includes('QxqyLocal_')`)
    const family = fontFamily(id)
    assert.ok((await evaluate(`getComputedStyle(document.querySelector('.qxsim-editor-nav')).fontFamily`)).includes(family))
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
    for (const [adaptive, minimum, expected, visible] of [[true, 10, 13, 'A\nB'], [false, 10, 40, ''], [true, 24, 24, 'A'], [true, 10, 13, 'A\nB']]) {
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
        return {family:text.style.fontFamily,width:ctx.measureText('AB').width,white,font:text.style.fontSize,wrap:text.style.wordWrap,text:text.text};
      })()`)
      assert.ok(metrics.family.includes(family))
      assert.ok(Math.abs(metrics.width - 28) < 0.2, JSON.stringify(metrics))
      assert.equal(metrics.font, expected)
      assert.equal(metrics.text, visible)
      assert.equal(metrics.wrap, false, 'Pixi must consume the host line breaks without wrapping a second time')
      // The synthetic A alone covers 0.6 * 0.7 * size²; allow edge
      // antialiasing while scaling the lower bound with the fitted size.
      if (visible) assert.ok(metrics.white > expected * expected * 0.25, JSON.stringify(metrics))
      else assert.equal(metrics.white, 0, 'insufficient textbox height must erase previously uploaded glyphs')
      revision = scene.revision
    }
    await evaluate('fontRenderer.destroy()')
    // The settings surface shares the same editor component with Harness.
    await evaluate(`document.querySelector('[aria-label="字体设置"]').click()`)
    await wait(`document.querySelector('[aria-label="字体来源"]')?.value === 'system'`)
    assert.equal(await evaluate(`document.querySelector('[aria-label="应用范围"]').value`), 'all')
    await evaluate(`(() => {
      const select=document.querySelector('[aria-label="字体来源"]');
      select.value='custom';select.dispatchEvent(new Event('change',{bubbles:true}));
    })()`)
    await wait(`Boolean(document.querySelector('[aria-label="字体文件路径"]'))`)
    const fill = value => evaluate(`(() => {
      const input=document.querySelector('[aria-label="字体文件路径"]');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});
      input.dispatchEvent(new Event('input',{bubbles:true}));
    })()`)
    await fill(join(directory, 'missing.ttf'))
    await evaluate(`document.querySelector('.qxsim-font-dialog button[type="submit"]').click()`)
    await wait(`document.querySelector('.qxsim-font-dialog [role="alert"]')?.textContent.includes('readable')`)
    assert.equal(JSON.parse(await readFile(config, 'utf8')).mode, 'system')
    await fill(`"${path}"`)
    await evaluate(`(() => {
      const select=document.querySelector('[aria-label="应用范围"]');
      select.value='game';select.dispatchEvent(new Event('change',{bubbles:true}));
    })()`)
    await evaluate(`document.querySelector('.qxsim-font-dialog button[type="submit"]').click()`)
    await wait(`document.querySelector('.qxsim-font-dialog [role="status"]')?.textContent.includes('已保存')`)
    assert.deepEqual(JSON.parse(await readFile(config, 'utf8')), { mode: 'custom', path, scope: 'game' })
    assert.ok((await evaluate(`getComputedStyle(document.querySelector('.qxsim-box.textbox span')).fontFamily`)).includes(family))
    assert.ok((await evaluate(`getComputedStyle(document.querySelector('.qxsim-editor-nav')).fontFamily`)).includes(family), 'scope applies after restart, not during an active editing session')
    await evaluate(`document.querySelector('.qxsim-font-dialog button[type="button"]').click()`)

    // Real process restarts verify persisted scope and the manifest/browser path.
    // Each scope must keep the same custom game font while changing only chrome.
    let host, exited
    const stopHost = async () => { if (host && host.exitCode === null && host.signalCode === null) host.kill(); await exited; host = null }
    t.after(stopHost)
    for (const scope of ['game', 'all']) {
      host = spawn(process.execPath, [fileURLToPath(new URL('../server.js', import.meta.url)), '--workspace', directory, '--port', '0'],
        { env: process.env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
      exited = once(host, 'exit')
      const url = await new Promise((resolve, reject) => {
        let output = '', error = ''
        const timer = setTimeout(() => reject(new Error('Font host startup timeout: ' + error)), 10_000)
        host.stdout.on('data', chunk => { output += chunk; const match = output.match(/http:\/\/127\.0\.0\.1:\d+/); if (match) { clearTimeout(timer); resolve(match[0]) } })
        host.stderr.on('data', chunk => { error += chunk })
        host.once('error', reason => { clearTimeout(timer); reject(reason) })
        host.once('exit', () => { clearTimeout(timer); reject(new Error('Font host exited: ' + error)) })
      })
      assert.deepEqual(await (await fetch(url + '/qxqy-font/manifest')).json(), { id, scope })
      await browser.navigate(url + '/editor')
      await wait(`document.querySelector('.qxsim-box.textbox')?.style.fontFamily.includes('QxqyLocal_')`)
      assert.ok((await evaluate(`getComputedStyle(document.querySelector('.qxsim-box.textbox span')).fontFamily`)).includes(family))
      const chrome = async selector => assert.equal((await evaluate(`getComputedStyle(document.querySelector(${JSON.stringify(selector)})).fontFamily`)).includes(family), scope === 'all', selector + ': ' + scope)
      await chrome('.qxsim-editor-nav')
      await chrome('.qxsim-language')
      await evaluate(`document.querySelector('[aria-label="字体设置"]').click()`)
      await wait(`document.querySelector('[aria-label="应用范围"]')?.value === ${JSON.stringify(scope)}`)
      await chrome('.qxsim-font-dialog select')
      if (scope === 'game') {
        await evaluate(`(()=>{const select=document.querySelector('[aria-label="应用范围"]');select.value='all';select.dispatchEvent(new Event('change',{bubbles:true}));})()`)
        await evaluate(`document.querySelector('.qxsim-font-dialog button[type="submit"]').click()`)
        await wait(`document.querySelector('.qxsim-font-dialog [role="status"]')?.textContent.includes('已保存')`)
        assert.equal(JSON.parse(await readFile(config, 'utf8')).scope, 'all')
      }
      await browser.navigate(url + '/editor/play#' + await evaluate(`sessionStorage.getItem('qxqy-editor-session')`))
      await wait(`document.getElementById('state')?.textContent.includes('试玩运行中')`)
      await chrome('#pause')
      await chrome('#log')
      await chrome('#caseAsserts')
      await evaluate(`(async()=>{
        const {PixiPlayRenderer,loadBrowserFont}=await import('/editor/play-renderer.js');
        const cv=document.createElement('canvas');document.body.append(cv);
        const renderer=new PixiPlayRenderer(cv,{fontReady:loadBrowserFont()});await renderer.ready;
        await renderer.applyScene(${JSON.stringify(playSnapshot(session, { view: true }).scene)},240,160);
        const text=renderer.nodes.get(${label.Id}).__visual.children.find(child=>typeof child.text==='string');
        window.scopeGameFont=text.style.fontFamily;renderer.destroy();
      })()`)
      assert.ok((await evaluate('window.scopeGameFont')).includes(family), 'both scopes retain the Pixi game font')
      await browser.navigate(url)
      await wait(`document.getElementById('connection')?.classList.contains('online')`)
      await evaluate(`import('/play-renderer.js').then(m=>m.loadBrowserFont())`)
      await chrome('.topbar')
      await chrome('#runtime-logs')
      await browser.navigate('about:blank')
      await stopHost()
    }
  })
})
