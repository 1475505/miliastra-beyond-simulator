import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createWebServer } from '../server.js'
import { createStudio } from '../../studio/index.js'
import { startTestBrowser } from './browser-helper.mjs'

test('preview and shared DSH/Web play pages deliver official keys and honor the input toggle', {
  skip: !process.env.QXQY_BROWSER, timeout: 90_000,
}, async t => {
  const directory = mkdtempSync(join(tmpdir(), 'qxqy-key-input-'))
  const studio = createStudio()
  const names = ['CraftspersonKey10', 'CraftspersonKey19', 'CraftspersonKey23', 'CraftspersonKey33',
    'MoveForwardKey', 'JumpKey', 'InteractKey', 'NormalAttackKey', 'SprintKey']
  studio.patch({ op: 'addScript', path: 'keys.lua', controlId: 'n1', controlAsset: 'server-control-template', source: `
function OnStart()
  script.object.showCursor = true
  for _, key in ipairs({${names.map(name => JSON.stringify('Keyboard' + name)).join(',')}}) do
    for _, phase in ipairs({'Down', 'Up'}) do
      local name = key .. phase
      script.object:AddKeyEventListener(Enum.KeyEventType[name], function() print(name) end)
    end
  end
  script.object:FindChild('预设按钮'):AddCursorEventListener(Enum.CursorEventType.CursorClick, function() print('cursor-click') end)
end` })
  writeFileSync(join(directory, 'keys.save.json'), JSON.stringify(studio.archiveData()))
  const app = await createWebServer({ workspace: directory, initialPath: 'keys.save.json', port: 0 })
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
    const surface = editor ? '#stage' : '#stage-shell'
    const button = editor ? '#keyInput' : '#play-keys'
    const api = async (action, args = {}) => {
      const envelope = await (await fetch(app.url + endpoint, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: 'key-probe', action, args }) })).json()
      assert.equal(envelope.ok, true, JSON.stringify(envelope))
      return envelope.value
    }
    await browser.navigate(app.url + (editor ? '/editor/play#key-probe' : '/'))
    if (editor) {
      await wait(`document.querySelector('#state').textContent.includes('试玩运行中')`)
      await browser.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false }, browser.sessionId)
      const toolbar = await evaluate(`['#keyInput','#close'].map(selector=>{const r=document.querySelector(selector).getBoundingClientRect();return {left:r.left,right:r.right,width:innerWidth}})`)
      assert.ok(toolbar.every(rect => rect.left >= 0 && rect.right <= rect.width), JSON.stringify(toolbar))
    }
    else {
      await wait(`document.querySelector('#archive-select').value`)
      await evaluate(`document.querySelector('#mode-play').click(); document.querySelector('#play-start').click()`)
      await wait(`!document.querySelector('#play-stop').disabled`)
    }
    const focus = () => evaluate(`document.querySelector('${surface}').tabIndex=0; document.querySelector('${surface}').focus()`)
    const logs = async () => (await api('get')).logs.map(row => row.text)
    const until = async predicate => {
      for (let i = 0; i < 100; i++) { if (predicate(await logs())) return; await new Promise(resolve => setTimeout(resolve, 30)) }
      assert.fail(JSON.stringify(await logs()))
    }
    await focus()
    for (const [key, code, name] of [['0', 'Digit0', 'CraftspersonKey10'], ['j', 'KeyY', 'CraftspersonKey19'],
      ['F5', 'F5', 'CraftspersonKey23'], [',', 'Comma', 'CraftspersonKey33'], [' ', 'Space', 'JumpKey'], ['f', 'KeyF', 'InteractKey']]) {
      await browser.key(key, code)
      await until(rows => rows.includes(`Keyboard${name}Up`))
    }
    assert.equal(await evaluate('document.readyState'), 'complete', 'F5 must reach Lua instead of reloading')
    await browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'w', code: 'KeyW' }, browser.sessionId)
    await until(rows => rows.includes('KeyboardMoveForwardKeyDown'))
    await evaluate(`document.querySelector('${button}').click()`)
    await until(rows => rows.includes('KeyboardMoveForwardKeyUp'))
    assert.equal(await evaluate(`document.querySelector('${button}').getAttribute('aria-pressed')`), 'false')
    const before = (await logs()).filter(row => row.startsWith('Keyboard')).length
    await browser.key('j', 'KeyJ')
    const rect = await evaluate(`(()=>{const r=document.querySelector('${surface}').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`)
    for (const type of ['mousePressed', 'mouseReleased']) {
      await browser.send('Input.dispatchMouseEvent', { type, ...rect, button: 'left', clickCount: 1 }, browser.sessionId)
    }
    await until(rows => rows.includes('cursor-click'))
    assert.equal((await logs()).filter(row => row.startsWith('Keyboard')).length, before)
    await evaluate(`document.querySelector('${button}').click()`)
    await focus()
    for (const type of ['mousePressed', 'mouseReleased']) {
      await browser.send('Input.dispatchMouseEvent', { type, ...rect, button: 'right', clickCount: 1 }, browser.sessionId)
    }
    await until(rows => rows.includes('KeyboardSprintKeyUp'))
    if (editor) {
      await evaluate(`document.querySelector('[data-view="log"]').click(); document.querySelector('#caseAsserts').focus()`)
      const count = (await logs()).length
      await browser.key('j', 'KeyJ')
      await new Promise(resolve => setTimeout(resolve, 100))
      assert.equal((await logs()).length, count, 'typing in the log editor must not drive the game')
    }
    assert.equal((await api('get')).logs.some(row => row.level === 'lua-error'), false)
    await api('stop')
  }
})
