import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createStudio } from '../../studio/index.js'
import { createWebServer } from '../server.js'
import { startTestBrowser } from './browser-helper.mjs'

test('preview and shared Web/DSH controls switch FPS in place, step one frame and remember the selection', {
  skip: !process.env.QXQY_BROWSER, timeout: 60_000,
}, async t => {
  const directory = mkdtempSync(join(tmpdir(), 'qxqy-frame-rate-'))
  writeFileSync(join(directory, 'clock.save.json'), JSON.stringify(createStudio().archiveData()))
  const app = await createWebServer({ workspace: directory, initialPath: 'clock.save.json', port: 0 })
  let browser
  t.after(async () => {
    await browser?.close(); await app.close()
    rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  })
  browser = await startTestBrowser(directory)
  const { evaluate, wait } = browser
  await browser.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false }, browser.sessionId)
  for (const editor of [false, true]) {
    const endpoint = editor ? '/editor/api/play' : '/api/play'
    const fpsSelect = editor ? '#fpsSel' : '#play-fps'
    const readout = editor ? '#frame' : '#play-readout'
    const api = async (action, args = {}) => {
      const envelope = await (await fetch(app.url + endpoint, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: 'frame-rate-test', action, args }) })).json()
      assert.equal(envelope.ok, true, JSON.stringify(envelope))
      return envelope.value
    }
    await browser.navigate(app.url + (editor ? '/editor/play#frame-rate-test' : '/'))
    if (editor) await wait(`document.querySelector('#state').textContent.includes('试玩运行中')`)
    else {
      await wait(`document.querySelector('#archive-select').value`)
      await evaluate(`document.querySelector('#mode-play').click(); document.querySelector('#play-start').click()`)
      await wait(`!document.querySelector('#play-stop').disabled`)
    }
    assert.equal((await api('get', { light: true })).fps, editor ? 60 : 30,
      'both entry points share the browser preference')
    await evaluate(`document.querySelector('${editor ? '#pause' : '#play-pause'}').click()`)
    await wait(`document.querySelector('${editor ? '#pause' : readout}').textContent.includes('${editor ? '继续运行' : '已暂停'}')`)
    const before = await api('get', { light: true })
    const bounds = await evaluate(`(() => { const r = document.querySelector('${fpsSelect}').getBoundingClientRect();
      return { left:r.left, right:r.right, bottom:r.bottom, width:innerWidth, height:innerHeight }; })()`)
    assert.ok(bounds.left >= 0 && bounds.right <= bounds.width && bounds.bottom <= bounds.height, JSON.stringify(bounds))
    for (const fps of [30, 60]) {
      await evaluate(`(() => { const select = document.querySelector('${fpsSelect}');
        select.value = '${fps}'; select.dispatchEvent(new Event('change')); })()`)
      await wait(`!document.querySelector('${fpsSelect}').disabled && document.querySelector('${fpsSelect}').value === '${fps}'`)
      const current = await api('get', { light: true })
      assert.equal(current.fps, fps)
      assert.equal(current.paused, true)
      assert.equal(current.time, before.time)
      assert.equal(current.frame, before.frame, 'switching must keep the current game')
    }
    await evaluate(`document.querySelector('${editor ? '#step' : '#play-step'}').click()`)
    await wait(`document.querySelector('${readout}').textContent.includes('Frame ${before.frame + 1}')`)
    const stepped = await api('get', { light: true })
    assert.equal(stepped.frame, before.frame + 1)
    assert.ok(Math.abs(stepped.time - before.time - 1 / 60) < 1e-9)
    if (editor) {
      await evaluate(`document.querySelector('#stop').click()`)
      await wait(`!document.querySelector('#restart').classList.contains('hidden')`)
      await evaluate(`document.querySelector('#restart').click()`)
      await wait(`document.querySelector('#state').textContent.includes('试玩运行中')`)
      assert.equal((await api('get', { light: true })).fps, 60)
    } else {
      await browser.navigate(app.url + '/')
      await wait(`document.querySelector('#play-readout').textContent.includes('已暂停')`)
      const attached = await api('get', { light: true })
      assert.equal(attached.fps, 60)
      assert.equal(attached.time, stepped.time)
      assert.equal(await evaluate(`document.querySelector('#play-fps').value`), '60')
    }
    await api('stop')
  }
})
