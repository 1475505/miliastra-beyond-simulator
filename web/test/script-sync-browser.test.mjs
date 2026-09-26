import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createWebServer } from '../server.js'
import { createStudio } from '../../studio/index.js'

// Optional real Chromium UI check; no global browser/profile or external samples.
// QXQY_BROWSER=<Chrome/Edge executable> node --test test/script-sync-browser.test.mjs
test('browser buttons save configuration, preview without copying, and explicitly confirm copy', { skip: !process.env.QXQY_BROWSER, timeout: 45000 }, async t => {
  const temp = mkdtempSync(join(tmpdir(), 'qxqy-sync-browser-'))
  const workspace = join(temp, 'workspace')
  const target = join(temp, 'client/default_import_file')
  mkdirSync(join(workspace, 'game'), { recursive: true }); mkdirSync(join(target, 'game'), { recursive: true })
  const studio = createStudio()
  studio.patch({ op: 'addScript', path: 'game/main.lua', source: '-- browser new' })
  writeFileSync(join(workspace, 'game.save.json'), JSON.stringify(studio.archiveData()))
  writeFileSync(join(target, 'game/main.lua'), '-- browser old')
  const app = await createWebServer({ workspace, initialPath: 'game.save.json', port: 0 })
  const browser = spawn(process.env.QXQY_BROWSER, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--remote-debugging-port=0', `--user-data-dir=${join(temp, 'profile')}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true })
  let socket
  t.after(async () => {
    if (socket?.readyState === 1) socket.close()
    if (browser.exitCode === null) { const exited = once(browser, 'exit'); browser.kill(); await exited }
    await app.close()
    rmSync(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  })
  const endpoint = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Browser CDP startup timeout')), 15000)
    let stderr = ''
    browser.stderr.on('data', chunk => { stderr += chunk; const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/); if (match) { clearTimeout(timer); resolve(match[1]) } })
    browser.once('error', reject)
  })
  socket = new WebSocket(endpoint)
  await once(socket, 'open')
  const pending = new Map()
  let sequence = 0
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data)
    const callbacks = pending.get(message.id)
    if (!callbacks) return
    pending.delete(message.id)
    if (message.error) callbacks.reject(new Error(message.error.message)); else callbacks.resolve(message.result)
  })
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++sequence
    pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
  })
  const created = await send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await send('Target.attachToTarget', { targetId: created.targetId, flatten: true })
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId)
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
    return result.result.value
  }
  const wait = async expression => {
    for (let i = 0; i < 100; i++) { if (await evaluate(expression)) return; await new Promise(resolve => setTimeout(resolve, 100)) }
    throw new Error(`Browser wait failed: ${expression}\n${await evaluate('document.body.innerText')}`)
  }
  const click = async text => {
    const result = await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find(b => b.textContent === ${JSON.stringify(text)}); if (!b || b.disabled) return false; b.click(); return true })()`)
    assert.equal(result, true, `click ${text}`)
  }
  const fill = (label, value) => evaluate(`(() => { const el = [...document.querySelectorAll('label')].find(e => e.textContent.includes(${JSON.stringify(label)})).querySelector('input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input', { bubbles: true })); })()`)
  await send('Page.navigate', { url: `${app.url}/editor` }, sessionId)
  await wait(`!!document.querySelector('.qxsim-editor-nav')`)
  await click('Lua 脚本')
  await wait(`!![...document.querySelectorAll('summary')].find(e => e.textContent.includes('实机脚本同步'))`)
  await evaluate(`[...document.querySelectorAll('summary')].find(e => e.textContent.includes('实机脚本同步')).click()`)
  await fill('工作区脚本目录', 'game')
  await fill('实机导入根目录', target)
  await fill('实机对应子目录', 'game')
  await click('保存目录配置')
  await wait(`!![...document.querySelectorAll('button')].find(e => e.textContent === '保存存档并检查差异' && !e.disabled)`)
  assert.equal(JSON.parse(readFileSync(join(workspace, 'game.save.json'), 'utf8')).scriptSync.clientImportRoot, target)
  await click('保存存档并检查差异')
  await wait(`!!document.querySelector('[aria-label="脚本同步确认"]')`)
  assert.equal(readFileSync(join(target, 'game/main.lua'), 'utf8'), '-- browser old')
  await click('取消')
  assert.equal(readFileSync(join(target, 'game/main.lua'), 'utf8'), '-- browser old')
  await click('保存存档并检查差异')
  await wait(`!![...document.querySelectorAll('button')].find(e => e.textContent === '确认复制 1 个脚本' && !e.disabled)`)
  await click('确认复制 1 个脚本')
  await wait(`document.body.innerText.includes('同步完成')`)
  assert.equal(readFileSync(join(target, 'game/main.lua'), 'utf8'), '-- browser new')
})
