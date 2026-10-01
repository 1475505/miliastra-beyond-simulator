import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createWebServer } from '../server.js'
import { createStudio } from '../../studio/index.js'
import { createNode } from '../../studio/ui/authoring.js'
import { startTestBrowser } from './browser-helper.mjs'
import { createCanvas, loadImage } from '@napi-rs/canvas'

function archive() {
  const save = createStudio().archiveData()
  const stage = save.assets.server.root.children[0]
  stage.showCursor = true
  const text = createNode('textwindow', { id: 'scroll-text', name: 'LongText', text: Array.from({ length: 60 }, (_, i) => `第 ${i + 1} 行 · 可滚动文本`).join('\n'), fontSize: 24 })
  const grid = createNode('grid', { id: 'scroll-grid', name: 'Grid', itemPrefabId: 1073742999, cellSizeX: 260, cellSizeY: 45, spacingY: 5,
    padding1X: 0, padding1Y: 0, padding2X: 0, padding2Y: 0 })
  for (const node of [text, grid]) for (const transform of Object.values(node.transformByPlatform)) {
    transform.size = { x: 300, y: 160 }
    transform.offset = { x: node === text ? -200 : 200, y: 0 }
  }
  stage.children = [text, grid]
  save.assets.client.root.children = [createNode('textbox', { id: 'scroll-item', guid: 1073742999, name: 'Item', text: '', fontSize: 24, bgColor: 0xff365570 })]
  save.assets.scripts = [{ id: 'scroll-main', path: 'scroll.lua', controlId: stage.id, controlAsset: 'server-control-template', source: `
function OnStart()
  local grid = script.object:GetChild('Grid')
  grid:RefreshItems(30, function(item, index) item.text = 'Item ' .. index end)
end` }]
  return save
}

async function harness(t) {
  const workspace = mkdtempSync(join(tmpdir(), 'qxqy-scroll-'))
  writeFileSync(join(workspace, 'scroll.save.json'), JSON.stringify(archive()))
  const app = await createWebServer({ workspace, initialPath: 'scroll.save.json', port: 0 })
  let browser
  t.after(async () => { await browser?.close(); await app.close(); rmSync(workspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) })
  const api = async (action, args = {}) => {
    const response = await fetch(`${app.url}/api/play`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, args }) })
    const result = await response.json()
    assert.equal(result.ok, true, JSON.stringify(result))
    return result.value
  }
  return { app, api, async browser() { browser = await startTestBrowser(workspace); return browser } }
}

test('Web/Worker carries wheel deltas, grid Lua initialization and scene updates', async t => {
  const { api } = await harness(t)
  const started = await api('start', { view: true, inspect: true })
  assert.equal(started.mountError, null)
  for (const [name, x] of [['LongText', 600], ['Grid', 1000]]) {
    await api('pointer', { type: 'wheel', x, y: 450, deltaY: 48 })
    const next = await api('get', { view: true })
    assert.ok(Math.abs(next.scene.nodes.find(n => n.name === name).scroll.offset - 48) < 1e-8)
  }
  await api('stop')
})

test('browser wheel, real mouse drag, scrollbar and touch scroll both viewport types', { skip: !process.env.QXQY_BROWSER, timeout: 90_000 }, async t => {
  const h = await harness(t), browser = await h.browser()
  await browser.send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 950, deviceScaleFactor: 1, mobile: false }, browser.sessionId)
  await browser.navigate(h.app.url)
  await browser.wait(`!document.querySelector('#mode-play').disabled && document.querySelector('#archive-select').value`)
  await browser.evaluate(`document.querySelector('#mode-play').click(); document.querySelector('#play-start').click()`)
  await browser.wait(`!document.querySelector('#stage-canvas').hidden && !document.querySelector('#play-stop').disabled`)
  const rect = await browser.evaluate(`(() => { const r = document.querySelector('#stage-canvas').getBoundingClientRect(); return { left:r.left, top:r.top, width:r.width, height:r.height } })()`)
  const point = (x, y) => ({ x: rect.left + x * rect.width / 1600, y: rect.top + (900 - y) * rect.height / 900 })
  const input = (params) => browser.send('Input.dispatchMouseEvent', params, browser.sessionId)
  const offset = async name => (await h.api('get', { view: true })).scene.nodes.find(n => n.name === name).scroll.offset
  const waitOffset = async (name, predicate) => {
    for (let i = 0; i < 100; i++) { const value = await offset(name); if (predicate(value)) return value; await new Promise(r => setTimeout(r, 40)) }
    assert.fail(`${name} offset did not change`)
  }
  for (const [name, x] of [['LongText', 600], ['Grid', 1000]]) {
    const p = point(x, 450)
    await input({ type: 'mouseWheel', ...p, deltaX: 0, deltaY: 30 })
    await waitOffset(name, n => n > 30)
    const before = await offset(name)
    await input({ type: 'mousePressed', ...p, button: 'left', buttons: 1, clickCount: 1 })
    await input({ type: 'mouseMoved', ...point(x, 490), button: 'left', buttons: 1 })
    await input({ type: 'mouseReleased', ...point(x, 490), button: 'left', buttons: 0, clickCount: 1 })
    await waitOffset(name, n => n > before + 35)
    // Click the bottom of the real rendered scrollbar.
    const bar = point(x + 144, 376)
    await input({ type: 'mousePressed', ...bar, button: 'left', buttons: 1, clickCount: 1 })
    await input({ type: 'mouseReleased', ...bar, button: 'left', buttons: 0, clickCount: 1 })
    await waitOffset(name, n => n > 1000)
    // Scroll back, then exercise a touch gesture through PointerEvents.
    await h.api('pointer', { type: 'wheel', x, y: 450, deltaY: -10000 })
    await browser.send('Emulation.setTouchEmulationEnabled', { enabled: true }, browser.sessionId)
    await browser.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...p, id: 1 }] }, browser.sessionId)
    await browser.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...point(x, 500), id: 1 }] }, browser.sessionId)
    await browser.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }, browser.sessionId)
    await waitOffset(name, n => n >= 45)
    await browser.send('Emulation.setTouchEmulationEnabled', { enabled: false }, browser.sessionId)
  }
  const screenshot = await browser.send('Page.captureScreenshot', { format: 'png' }, browser.sessionId)
  const image = await loadImage(Buffer.from(screenshot.data, 'base64'))
  const context = createCanvas(image.width, image.height).getContext('2d')
  context.drawImage(image, 0, 0)
  const pixel = (x, y) => { const p = point(x, y); return [...context.getImageData(Math.round(p.x), Math.round(p.y), 1, 1).data].slice(0, 3) }
  assert.deepEqual(pixel(1095, 500), [54, 85, 112], 'GPU shows the scrolled item inside the viewport')
  assert.notDeepEqual(pixel(1095, 350), [54, 85, 112], 'GPU clips list items below the viewport')
  const state = await h.api('get')
  assert.equal(state.logs.some(row => row.level === 'lua-error'), false)
  await h.api('stop')
})
