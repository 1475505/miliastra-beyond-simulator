import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createWebServer } from '../server.js'
import { startTestBrowser } from './browser-helper.mjs'

test('local viewers receive host UI language; an English embedded browser follows it without changing project data', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'qxqy-host-locale-'))
  let calls = 0, browser
  const app = await createWebServer({ workspace: directory, port: 0,
    systemLanguage: async () => { calls++; return { language: 'zh-CN', source: 'windows-ui' } } })
  t.after(async () => { await browser?.close(); await app.close(); await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) })
  assert.equal(calls, 0, 'starting a host does not need to launch the language reader')
  const read = async headers => (await fetch(app.url + '/editor/api/locale', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: '{}' })).json()
  assert.deepEqual((await read()).value, { language: 'zh-CN', source: 'windows-ui' })
  assert.deepEqual((await read({ 'x-forwarded-for': '192.0.2.1' })).value, { language: '', source: 'browser' })
  assert.equal(calls, 1)

  await t.test('native Chinese overrides browser English; manual English and persistence still work in editor/play/preview', {
    skip: !process.env.QXQY_BROWSER, timeout: 60_000,
  }, async () => {
    browser = await startTestBrowser(directory, [], { language: 'en-US', preference: 'auto' })
    const { evaluate, wait } = browser
    await browser.navigate(app.url + '/editor')
    await wait("document.querySelector('.qxsim')?.lang === 'zh-CN'")
    assert.equal(await evaluate('navigator.language'), 'en-US')
    assert.ok(await evaluate("document.querySelector('[aria-label=\"界面语言\"] option[value=auto]').textContent.includes('zh-CN')"))
    const save = () => evaluate("fetch('/editor/api/export',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sessionId:sessionStorage.getItem('qxqy-editor-session'),format:'save'})}).then(r=>r.json()).then(r=>r.value.data)")
    const before = await save()
    await evaluate("(()=>{const select=document.querySelector('[aria-label=\"界面语言\"]');select.value='en';select.dispatchEvent(new Event('change',{bubbles:true}));})()")
    await wait("document.querySelector('.qxsim')?.lang === 'en'")
    assert.equal(await save(), before)
    await browser.navigate(app.url + '/editor')
    await wait("document.querySelector('.qxsim')?.lang === 'en'")
    await evaluate("(()=>{const select=document.querySelector('[aria-label=\"Interface language\"]');select.value='auto';select.dispatchEvent(new Event('change',{bubbles:true}));})()")
    await wait("document.querySelector('.qxsim')?.lang === 'zh-CN'")
    const sessionId = await evaluate("sessionStorage.getItem('qxqy-editor-session')")
    await browser.navigate(app.url + '/editor/play#' + sessionId)
    await wait("document.getElementById('state')?.textContent.includes('试玩运行中')")
    assert.equal(await evaluate('document.documentElement.lang'), 'zh-CN')
    await browser.navigate(app.url)
    await wait("document.documentElement.lang === 'zh-CN'")
  })
})
