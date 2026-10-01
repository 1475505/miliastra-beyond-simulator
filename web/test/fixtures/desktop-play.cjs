// Reproduce DSH 0.2's actual Electron window and authenticated protocol policy.
// This is not the complete signed Desktop app. All profile data is disposable.
const { app, BrowserWindow, protocol } = require('electron')
const assert = require('node:assert/strict')
const { setTimeout: delay } = require('node:timers/promises')
const { join } = require('node:path')
app.setPath('userData', join(process.env.QXQY_TEST_DIRECTORY, 'electron-profile'))
app.commandLine.appendSwitch('use-angle', 'swiftshader')
app.commandLine.appendSwitch('enable-unsafe-swiftshader')
protocol.registerSchemesAsPrivileged([{ scheme: 'dsh-app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }])
let window
async function main() {
  await app.whenReady()
  protocol.handle('dsh-app', async request => {
    const source = new URL(request.url)
    const headers = new Headers(request.headers)
    for (const name of ['host', 'origin', 'cookie', 'sec-fetch-site']) headers.delete(name)
    headers.set('cookie', 'test-desktop-auth=1')
    const result = await fetch(process.env.QXQY_TEST_HOST + source.pathname + source.search, {
      method: request.method, headers, body: request.body, duplex: 'half', redirect: 'manual',
    })
    const outgoing = new Headers(result.headers)
    for (const name of ['set-cookie', 'content-encoding', 'content-length', 'transfer-encoding', 'connection', 'keep-alive']) outgoing.delete(name)
    return new Response(result.body, { status: result.status, headers: outgoing })
  })
  window = new BrowserWindow({ show: false, width: 1280, height: 820, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true } })
  let denied = 0
  window.webContents.setWindowOpenHandler(() => { denied++; return { action: 'deny' } })
  const js = expression => window.webContents.executeJavaScript(expression, true)
  const wait = async expression => {
    for (let i = 0; i < 150; i++) { if (await js(expression)) return; await delay(100) }
    throw new Error(`Desktop wait failed: ${expression}\n${await js('document.body.innerText')}`)
  }
  await window.loadURL('dsh-app://app/')
  await wait(`!!document.querySelector('.qxsim-editor-nav')`)
  await js(`(() => { const b = [...document.querySelectorAll('button')].find(b => b.textContent === '▷ 试玩 ↗'); b.focus(); b.click() })()`)
  const frame = `document.querySelector('.qxsim-play-overlay iframe')`
  await wait(`${frame}?.contentDocument.querySelector('#state')?.textContent.includes('试玩运行中')`)
  assert.equal(denied, 1)
  assert.match(await js(`${frame}.src`), /^dsh-app:\/\/app\/qxqy-simulator\/play\?embedded=1#desktop-play$/)
  assert.equal(await js(`document.activeElement === ${frame}`), true)
  // Native input through Chromium, not a synthetic key event in the frame.
  window.webContents.debugger.attach('1.3')
  await window.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyDown', key: '1', code: 'Digit1' })
  await window.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', key: '1', code: 'Digit1' })
  await wait(`${frame}.contentDocument.querySelector('#log').textContent.includes('desktop-key')`)
  await js(`${frame}.contentDocument.querySelector('#close').click()`)
  await wait(`!document.querySelector('.qxsim-play-overlay')`)
  assert.equal(await js(`document.activeElement.textContent`), '▷ 试玩 ↗')
  assert.equal(await js(`fetch('/qxqy-simulator/api/play', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({sessionId:'desktop-play', action:'get'}) }).then(r=>r.json()).then(r=>r.ok)`), false)
  console.log('PASS Electron Desktop policy: native popup denied, dsh-app iframe, authenticated Host API, keyboard input and stopped Worker')
}
main().then(() => { window?.destroy(); app.exit(0) }, error => { console.error(error.stack); window?.destroy(); app.exit(1) })
