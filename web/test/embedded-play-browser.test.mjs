import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createWebServer } from '../server.js'
import { createStudio } from '../../studio/index.js'
import { startTestBrowser } from './browser-helper.mjs'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'

// QXQY_BROWSER=<Chrome/Edge executable> node --test test/embedded-play-browser.test.mjs
test('blocked play popup falls back to an owned iframe with saved drafts, keyboard focus and deterministic close', { skip: !process.env.QXQY_BROWSER, timeout: 90_000 }, async t => {
  const temp = mkdtempSync(join(tmpdir(), 'qxqy-embedded-play-'))
  const studio = createStudio()
  const source = 'function OnStart()\n script.object:AddKeyEventListener(Enum.KeyEventType.KeyboardCraftspersonKey1Down, function() print("iframe-key") end)\n print("saved-draft")\nend'
  studio.patch({ op: 'addScript', controlId: 'n1', controlAsset: 'server-control-template', path: 'main.lua', source: '-- original' })
  writeFileSync(join(temp, 'game.save.json'), JSON.stringify(studio.archiveData()))
  const app = await createWebServer({ workspace: temp, initialPath: 'game.save.json', port: 0 })
  const fixture = await build({ entryPoints: [fileURLToPath(new URL('./fixtures/play-lifecycle-client.js', import.meta.url))], bundle: true, write: false, format: 'iife', platform: 'browser' })
  const handler = app.server.listeners('request')[0]
  app.server.removeListener('request', handler)
  app.server.on('request', (request, response) => {
    if (request.url === '/fixture') { response.setHeader('content-type', 'text/html'); response.end('<!doctype html><style>html,body,#app{height:100%;margin:0}</style><div id="app"></div><script src="/fixture.js"></script>') }
    else if (request.url === '/fixture.js') { response.setHeader('content-type', 'text/javascript'); response.end(fixture.outputFiles[0].contents) }
    else void handler(request, response)
  })
  let browser
  t.after(async () => {
    await browser?.close()
    await app.close()
    rmSync(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  })
  browser = await startTestBrowser(temp)
  const { evaluate, wait } = browser
  const click = text => evaluate(`(() => { const b = [...document.querySelectorAll('button')].find(b => b.textContent === ${JSON.stringify(text)}); if (!b || b.disabled) throw new Error('Missing button ' + ${JSON.stringify(text)}); b.focus(); b.click() })()`)
  await browser.navigate(`${app.url}/editor`)
  await wait(`!!document.querySelector('.qxsim-editor-nav')`)
  await evaluate(`window.openOriginal = window.open; window.open = () => null`)
  await click('Lua 脚本')
  await wait(`!!document.querySelector('.qxsim-script-editor textarea')`)
  await evaluate(`(() => { const el = document.querySelector('.qxsim-script-editor textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, ${JSON.stringify(source)}); el.dispatchEvent(new Event('input', { bubbles: true })); })()`)
  // Failed saves must keep the draft and never launch a stale game.
  await evaluate(`window.fetchOriginal = window.fetch; window.fetch = (url, init) => String(url).endsWith('/patch') ? Promise.reject(new Error('test save failure')) : fetchOriginal(url, init)`)
  await click('▷ 试玩 ↗')
  await wait(`document.querySelector('[role=alert]')?.textContent.includes('test save failure')`)
  assert.equal(await evaluate(`!!document.querySelector('.qxsim-play-overlay')`), false)
  assert.equal(await evaluate(`document.querySelector('.qxsim-script-editor textarea').value`), source)
  await evaluate(`window.fetch = fetchOriginal`)
  // Delay the save: no frame/start may exist until this completes.
  await evaluate(`window.fetchOriginal = window.fetch; window.fetch = async (url, init) => { if (String(url).endsWith('/patch')) await new Promise(r => { window.releaseSave = r }); return fetchOriginal(url, init) }`)
  await click('▷ 试玩 ↗')
  await wait(`!!window.releaseSave`)
  assert.equal(await evaluate(`!!document.querySelector('.qxsim-play-overlay')`), false)
  await evaluate(`releaseSave(); window.fetch = fetchOriginal`)
  await wait(`!!document.querySelector('.qxsim-play-overlay iframe')?.contentWindow.qxqyEmbeddedPlay`)
  const sessionId = await evaluate(`document.querySelector('.qxsim').dataset.qxsimSessionId`)
  const api = async (action, args = {}) => (await (await fetch(`${app.url}/editor/api/play`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId, action, args }),
  })).json())
  const frame = `document.querySelector('.qxsim-play-overlay iframe')`
  await wait(`${frame}.contentDocument.querySelector('#state').textContent.includes('试玩运行中')`)
  assert.match(JSON.stringify(await api('get')), /saved-draft/)
  assert.equal(await evaluate(`document.activeElement === ${frame}`), true)
  await browser.key('1', 'Digit1')
  await wait(`${frame}.contentDocument.querySelector('#log').textContent.includes('iframe-key')`)
  // Neither a different window nor a different session can dismiss this frame.
  await evaluate(`window.postMessage({ type: 'qxqy-play-close', sessionId: ${JSON.stringify(sessionId)} }, '*'); window.dispatchEvent(new MessageEvent('message', { source: ${frame}.contentWindow, data: { type: 'qxqy-play-close', sessionId: 'wrong' } }))`)
  assert.equal((await api('get')).value.running, true)
  assert.equal(await evaluate(`document.querySelector('.qxsim-play-overlay').open`), true)

  // Stop failure retains the overlay and exposes an explicit retry.
  await evaluate(`window.fetch = (url, init) => String(url).endsWith('/play') && JSON.parse(init.body).action === 'stop' ? Promise.reject(new Error('test stop failure')) : fetchOriginal(url, init)`)
  await evaluate(`${frame}.contentDocument.querySelector('#close').click()`)
  await wait(`document.querySelector('.qxsim-play-error')?.textContent.includes('test stop failure')`)
  assert.equal((await api('get')).value.running, true)
  await evaluate(`window.fetch = async (url, init) => { if (String(url).endsWith('/play') && JSON.parse(init.body).action === 'stop') await new Promise(r => { window.releaseStop = r }); return fetchOriginal(url, init) }`)
  await click('关闭试玩')
  await wait(`!!window.releaseStop`)
  assert.equal(await evaluate(`document.querySelector('.qxsim-play-overlay').open`), true)
  await evaluate(`releaseStop(); window.fetch = fetchOriginal`)
  await wait(`!document.querySelector('.qxsim-play-overlay')`)
  assert.equal((await api('get')).ok, false)
  assert.equal(await evaluate(`document.querySelector('.qxsim-script-editor textarea').value`), source)
  assert.equal(await evaluate(`document.activeElement.textContent`), '▷ 试玩 ↗')

  // Return from the iframe before its start fetch settles; the parent must
  // drain that start before stop and before removing the frame.
  await evaluate(`window.fetch = async (url, init) => { if (String(url).endsWith('/play') && JSON.parse(init.body).action === 'start') await new Promise(r => { window.delayedStart = r }); return fetchOriginal(url, init) }`)
  await click('▷ 试玩 ↗')
  await wait(`!!window.delayedStart`)
  await click('关闭试玩')
  assert.equal(await evaluate(`document.querySelector('.qxsim-play-overlay').open`), true)
  await evaluate(`delayedStart(); window.fetch = fetchOriginal`)
  await wait(`!document.querySelector('.qxsim-play-overlay')`)
  assert.equal((await api('get')).ok, false)

  // The normal browser path still uses a separate tab, not the fallback.
  await evaluate(`window.open = openOriginal`)
  await click('▷ 试玩 ↗')
  await wait(`!document.querySelector('.qxsim-actions button[disabled]')`)
  let popup
  for (let i = 0; i < 100 && !popup; i++) {
    const { targetInfos } = await browser.send('Target.getTargets')
    popup = targetInfos.find(target => target.url.includes(`/editor/play#${sessionId}`))
    if (!popup) await new Promise(resolve => setTimeout(resolve, 50))
  }
  assert.ok(popup, 'Normal play must still open its own tab')
  assert.equal(await evaluate(`!!document.querySelector('.qxsim-play-overlay')`), false)
  await browser.send('Target.closeTarget', { targetId: popup.targetId })

  // Harness can destroy/recreate the view or change its session prop without
  // a full browser navigation. Cleanup must keep using the old session id.
  await browser.navigate(`${app.url}/fixture`)
  await wait(`!!document.querySelector('.qxsim-editor-nav')`)
  await evaluate(`window.open = () => null; window.fetchOriginal = window.fetch; window.fetch = async (url, init) => { if (String(url).endsWith('/play') && JSON.parse(init.body).action === 'start') await new Promise(r => { window.releaseStart = r }); return fetchOriginal(url, init) }`)
  await click('▷ 试玩 ↗')
  await wait(`!!window.releaseStart`)
  await evaluate(`mountSession(null)`)
  await wait(`!document.querySelector('.qxsim')`)
  await evaluate(`mountSession('lifecycle-a')`)
  await wait(`!!document.querySelector('.qxsim-editor-nav')`)
  await click('▷ 试玩 ↗')
  assert.equal(await evaluate(`!!document.querySelector('.qxsim-play-overlay')`), false)
  await evaluate(`window.fetch = fetchOriginal; releaseStart()`)
  await wait(`${frame}?.contentDocument.querySelector('#state')?.textContent.includes('试玩运行中')`)
  await browser.key('Escape', 'Escape')
  await wait(`!document.querySelector('.qxsim-play-overlay')`)
  await click('▷ 试玩 ↗')
  await wait(`${frame}?.contentDocument.querySelector('#state')?.textContent.includes('试玩运行中')`)
  await evaluate(`mountSession('lifecycle-b')`)
  await wait(`document.querySelector('.qxsim')?.dataset.qxsimSessionId === 'lifecycle-b' && !document.querySelector('.qxsim-play-overlay')`)
  await wait(`fetch('/editor/api/play', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({sessionId:'lifecycle-a', action:'get'}) }).then(r => r.json()).then(r => !r.ok)`)
})
