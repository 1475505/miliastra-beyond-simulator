import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createWebServer } from '../server.js'
import { startTestBrowser } from './browser-helper.mjs'

test('English defaults, language persistence, contacts and update retry preserve project data', {
  skip: !process.env.QXQY_BROWSER, timeout: 60_000,
}, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'qxqy-i18n-'))
  let calls = 0
  const app = await createWebServer({ workspace: directory, port: 0,
    systemLanguage: async () => ({ language: 'de-DE', source: 'test-host' }), checkUpdates: async () => {
    if (++calls === 1) throw new Error('Unknown editor action')
    if (calls === 2) throw new Error('simulated offline')
    return { currentVersion: '0.4.1', latestVersion: '0.5.0', status: 'available',
      url: 'https://github.com/1475505/miliastra-beyond-simulator/releases/tag/test',
      downloadUrl: 'https://github.com/1475505/miliastra-beyond-simulator/releases/download/test/beyond-simulator-web-0.5.0.tgz' }
  } })
  const browser = await startTestBrowser(directory, [], { language: 'de-DE', preference: 'auto' })
  t.after(async () => { await browser.close(); await app.close(); await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) })
  const { evaluate, wait } = browser
  await browser.navigate(app.url + '/editor')
  await wait("document.querySelector('.qxsim')?.lang === 'en'")
  const has = text => "([...document.querySelectorAll('button')].some(el=>el.textContent===" + JSON.stringify(text) + "))"
  const click = text => evaluate("([...document.querySelectorAll('button')].find(el=>el.textContent===" + JSON.stringify(text) + ")).click()")
  assert.ok(await evaluate(has('UI Editor')))
  assert.ok(await evaluate(has('Contact Author')))
  for (const kind of ['Grid Scroller', 'Text Window', 'Image']) {
    await evaluate("[...document.querySelectorAll('.qxsim-row')].find(row=>row.title.startsWith(" + JSON.stringify(kind + ' ·') + ")).click()")
    await wait("document.querySelector('.qxsim-inspector-line strong')?.textContent === " + JSON.stringify(kind))
  }
  await evaluate("[...document.querySelectorAll('.qxsim-switch-row')].find(row=>row.textContent==='Fill by Progress').querySelector('input').click()")
  await wait("[...document.querySelectorAll('select option')].some(option=>option.value==='Radial90'&&option.textContent==='Radial90')")
  assert.ok(await evaluate("document.querySelector('.qxsim-inspector').textContent.includes('Soft Edge')"))
  assert.equal(calls, 0, 'opening the UI must not contact update servers automatically')
  const saveData = () => evaluate("fetch('/editor/api/export',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sessionId:sessionStorage.getItem('qxqy-editor-session'),format:'save'})}).then(r=>r.json()).then(r=>r.value.data)")
  const before = await saveData()
  await click('Contact Author')
  await wait("document.querySelector('dialog[open]')?.textContent.includes('1007538100')")
  assert.equal(await evaluate("document.querySelector('dialog a[href^=\"mailto:\"]').getAttribute('href')"), 'mailto:725230880@qq.com')
  assert.equal(await evaluate("document.querySelector('dialog a[href^=\"https:\"]').href"), 'https://github.com/1475505/miliastra-beyond-simulator')
  await click('Close')
  await click('Check for Updates')
  await wait("document.querySelector('dialog [role=\"alert\"]')?.textContent.includes('Restart')")
  assert.ok(await evaluate("!document.querySelector('dialog [role=\"alert\"]').textContent.includes('network')"))
  assert.equal(await evaluate("document.querySelector('dialog a').href"), 'https://github.com/1475505/miliastra-beyond-simulator/releases')
  await click('Retry')
  await wait("document.querySelector('dialog [role=\"alert\"]')?.textContent.includes('network')")
  await click('Retry')
  await wait("document.querySelector('dialog')?.textContent.includes('0.5.0')")
  assert.ok(await evaluate("document.querySelector('dialog').textContent.includes('A new version is available')"))
  await click('Close')
  assert.equal(await saveData(), before)
  await click('Lua Scripts')
  await click('＋ New Script')
  await wait("Boolean(document.querySelector('.qxsim-script-page textarea'))")
  const beforeDraft = await saveData()
  const draft = '-- 玩家文字保持中文 {0}\nfunction OnStart() end'
  await evaluate("(()=>{const input=document.querySelector('.qxsim-script-page textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input," + JSON.stringify(draft) + ");input.dispatchEvent(new Event('input',{bubbles:true}));})()")
  await evaluate("(()=>{const select=document.querySelector('[aria-label=\"Interface language\"]');select.value='zh';select.dispatchEvent(new Event('change',{bubbles:true}));})()")
  await wait("document.querySelector('.qxsim')?.lang === 'zh-CN'")
  assert.equal(await evaluate("document.querySelector('.qxsim-script-page textarea').value"), draft)
  assert.ok(await evaluate(has('联系作者')))
  assert.equal(await saveData(), beforeDraft, 'language changes must not change the save or auto-save drafts')
  await browser.navigate(app.url + '/editor')
  await wait("document.querySelector('.qxsim')?.lang === 'zh-CN'")
  await evaluate("(()=>{const select=document.querySelector('[aria-label=\"界面语言\"]');select.value='auto';select.dispatchEvent(new Event('change',{bubbles:true}));})()")
  await wait("document.querySelector('.qxsim')?.lang === 'en'")
  // A previous host can still serve newly built static assets while retaining
  // its old routes in memory. Recovery must not require discarding this tab.
  await evaluate("(()=>{window.fontOriginalFetch=window.fetch;window.simulateLegacyFont=true;window.fetch=(...args)=>String(args[0])==='/qxqy-font/settings'&&window.simulateLegacyFont?Promise.resolve(new Response('Font not found',{status:404})):window.fontOriginalFetch(...args);})()")
  await click('Font Settings')
  await wait("document.querySelector('.qxsim-font-dialog [role=\"alert\"]')?.textContent.includes('Restart')")
  assert.equal(await evaluate("document.querySelector('.qxsim-font-dialog button[type=\"submit\"]').disabled"), true)
  await evaluate('window.simulateLegacyFont=false')
  await click('Retry')
  await wait("Boolean(document.querySelector('[aria-label=\"Font source\"]'))")
  assert.equal(await evaluate("document.querySelector('.qxsim-font-dialog [role=\"alert\"]')"), null)
  assert.ok(await evaluate("document.querySelector('.qxsim-font-dialog').textContent.includes('Use a local font file')"))
  await evaluate('window.fetch=window.fontOriginalFetch;delete window.fontOriginalFetch;delete window.simulateLegacyFont')
  await click('Close')
  const userText = '检查更新 Contact Author 玩家文字 {0}'
  await evaluate("(async()=>{const sessionId=sessionStorage.getItem('qxqy-editor-session');const api=async(action,body={})=>{const r=await fetch('/editor/api/'+action,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sessionId,...body})});return (await r.json()).value};const current=await api('get');await api('patch',{op:{op:'set',id:'n2',key:'text',value:" + JSON.stringify(userText) + ",expectedRevision:current.version}});})()")
  await browser.navigate(app.url + '/editor')
  await wait("document.querySelector('.qxsim-box.textbox span')?.textContent.split(String.fromCharCode(10)).join('') === " + JSON.stringify(userText))
  const sessionId = await evaluate("sessionStorage.getItem('qxqy-editor-session')")
  await browser.navigate(app.url + '/editor/play#' + sessionId)
  await wait("document.getElementById('state')?.textContent.includes('Playtest running')")
  await click('Logs')
  assert.ok(await evaluate("document.body.textContent.includes('Runtime Scene Tree')"))
  assert.ok(await evaluate("document.body.textContent.includes('Client Script Logs')"))
  await evaluate("import('/editor/play-renderer.js').then(m=>m.setLanguagePreference('zh'))")
  await wait("document.getElementById('playerCountSel')?.options[0].textContent === '1 人'")
  await evaluate("import('/editor/play-renderer.js').then(m=>m.setLanguagePreference('en'))")
  await wait("document.getElementById('playerCountSel')?.options[0].textContent === '1 player'")
  await browser.navigate(app.url)
  await wait("document.documentElement.lang === 'en'")
  assert.ok(await evaluate("document.body.textContent.includes('Live Preview')"))
})
