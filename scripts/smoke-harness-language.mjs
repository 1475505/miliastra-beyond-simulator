// Optional real Harness UI check, using the installed plugin and its ModuleLoader.
import assert from 'node:assert/strict'
import { resolveLocale } from '../studio/i18n.js'
import { startTestBrowser } from '../web/test/browser-helper.mjs'

export async function smokeHarnessLanguage(url, directory, hostLanguage) {
  const browser = await startTestBrowser(directory, [], { language: 'en-US', preference: 'auto' })
  try {
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 1000, deviceScaleFactor: 1, mobile: false }, browser.sessionId)
    // Buffer the real locale response, then hold delivery until the editor
    // mounts. This isolates the late-render race from browser/network timing.
    await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: `
      const originalFetch = window.fetch.bind(window);
      const languageReady = new Promise(resolve => { window.releaseSimulatorLanguage = resolve; });
      window.fetch = async (input, init) => {
        const response = await originalFetch(input, init);
        if (String(input) === '/qxqy-simulator/api/locale') {
          const body = await response.text();
          await languageReady;
          window.simulatorLanguageDelivered = true;
          return new Response(body, { status: response.status, headers: response.headers });
        }
        return response;
      };
    ` }, browser.sessionId)
    await browser.navigate(url)
    await browser.wait(`[...document.querySelectorAll('button')].some(e=>e.textContent.trim()==='Continue')`)
    await browser.evaluate(`[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='Continue').click()`)
    await browser.wait(`![...document.querySelectorAll('button')].some(e=>e.textContent.trim()==='Continue')`)
    await browser.wait(`!!document.querySelector('button[aria-label=Close]') || [...document.querySelectorAll('button')].some(e=>e.textContent==='Configure later')`)
    await browser.evaluate(`(document.querySelector('button[aria-label=Close]') || [...document.querySelectorAll('button')].find(e=>e.textContent==='Configure later')).click()`)
    await browser.wait(`!document.querySelector('button[aria-label=Close]') && ![...document.querySelectorAll('button')].some(e=>e.textContent==='Configure later')`)
    await browser.wait(`document.body.innerText.includes('game')`)
    await browser.evaluate(`document.querySelector('button[aria-label="Open sidebar"]')?.click()`)
    await browser.wait(`document.body.innerText.includes('Harness language smoke')`)
    await browser.evaluate(`[...document.querySelectorAll('*')].find(e=>e.children.length===0 && e.textContent==='Harness language smoke').click()`)
    await browser.wait(`document.querySelector('[data-conversation-tabs]') !== null`)
    await browser.evaluate(`[...document.querySelectorAll('[data-conversation-tabs] button')].find(e=>e.textContent==='Simulator').click()`)
    await browser.wait(`document.querySelector('.qxsim')?.lang === 'en'`)
    assert.equal(await browser.evaluate('navigator.language'), 'en-US')
    await browser.evaluate(`document.querySelectorAll('.qxsim-editor-nav button')[1].click()`)
    await browser.wait(`document.querySelector('.qxsim-script-page textarea') !== null`)
    const original = await browser.evaluate(`document.querySelector('.qxsim-script-page textarea').value`)
    const draft = '-- language smoke draft\n' + original
    await browser.evaluate(`(()=>{const input=document.querySelector('.qxsim-script-page textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,${JSON.stringify(draft)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`)
    await browser.wait(`document.querySelector('.qxsim-script-page textarea').value === ${JSON.stringify(draft)}`)
    const sessionId = await browser.evaluate(`document.querySelector('.qxsim').dataset.qxsimSessionId`)
    const exported = () => browser.evaluate(`fetch('/qxqy-simulator/api/export',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sessionId:${JSON.stringify(sessionId)},format:'save'})}).then(r=>r.json()).then(r=>{if(!r.ok)throw new Error(r.error);return r.value.data})`)
    const before = await exported()
    await browser.evaluate('window.simulatorRootBeforeLanguage = document.querySelector(".qxsim"); window.releaseSimulatorLanguage()')
    const expected = resolveLocale('auto', 'en-US', hostLanguage.language) === 'zh' ? 'zh-CN' : 'en'
    await browser.wait(`document.querySelector('.qxsim')?.lang === ${JSON.stringify(expected)}`)
    await browser.wait(`document.querySelector('.qxsim-editor-nav .qxsim-language option[value=auto]').textContent.includes(${JSON.stringify(hostLanguage.language || 'en-US')})`)
    const tabLabel = () => browser.evaluate(`document.querySelector('[data-conversation-tabs] [aria-selected=true]').textContent`)
    assert.equal(await tabLabel(), expected === 'zh-CN' ? '模拟器' : 'Simulator', 'host tab follows the delayed system-language response')
    assert.equal(await browser.evaluate('document.querySelector(".qxsim") === window.simulatorRootBeforeLanguage'), true, 'language update preserves the mounted editor')
    assert.equal(await browser.evaluate(`document.querySelector('.qxsim-script-page textarea').value`), draft)
    await browser.evaluate(`(()=>{const select=document.querySelector('.qxsim-editor-nav .qxsim-language'); select.value='en';select.dispatchEvent(new Event('change',{bubbles:true}))})()`)
    await browser.wait(`document.querySelector('.qxsim')?.lang === 'en'`)
    assert.equal(await tabLabel(), 'Simulator', 'manual English also updates the Harness tab')
    assert.equal(await browser.evaluate(`localStorage.getItem('qxqy-ui-language')`), 'en')
    assert.equal(await browser.evaluate(`document.querySelector('.qxsim-script-page textarea').value`), draft)
    await browser.evaluate(`(()=>{const select=document.querySelector('.qxsim-editor-nav .qxsim-language'); select.value='auto';select.dispatchEvent(new Event('change',{bubbles:true}))})()`)
    await browser.wait(`document.querySelector('.qxsim')?.lang === ${JSON.stringify(expected)}`)
    assert.equal(await exported(), before, 'language changes never rewrite the save or commit a script draft')
    assert.equal(await browser.evaluate(`document.querySelector('.qxsim-script-page textarea').value`), draft)
    // A new play page initializes a separate translation module, which must
    // retain manual English even after reading the native language again.
    await browser.evaluate(`(()=>{const input=document.querySelector('.qxsim-script-page textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,${JSON.stringify(original)});input.dispatchEvent(new Event('input',{bubbles:true}));const select=document.querySelector('.qxsim-editor-nav .qxsim-language');select.value='en';select.dispatchEvent(new Event('change',{bubbles:true}));})()`)
    await browser.wait(`document.querySelector('.qxsim')?.lang === 'en'`)
    await browser.navigate(new URL('/qxqy-simulator/play#' + sessionId, url).href)
    await browser.wait(`document.getElementById('state')?.textContent.includes('Playtest running')`)
    await browser.evaluate('window.releaseSimulatorLanguage()')
    await browser.wait(`window.simulatorLanguageDelivered && document.documentElement.lang === 'en'`)
    assert.equal(await browser.evaluate(`localStorage.getItem('qxqy-ui-language')`), 'en', 'manual English survives a fresh page and native language response')
    // Simulate the storage event sent when a second same-origin editor chooses
    // Auto; this updates the running play page without restarting its Worker.
    await browser.evaluate(`localStorage.setItem('qxqy-ui-language','auto');window.dispatchEvent(new StorageEvent('storage',{key:'qxqy-ui-language',newValue:'auto'}))`)
    await browser.wait(`document.documentElement.lang === ${JSON.stringify(expected)}`)
    await browser.wait(`document.getElementById('state').textContent.includes(${JSON.stringify(expected === 'zh-CN' ? '试玩运行中' : 'Playtest running')})`)
    console.log(`PASS Harness client language: browser=en-US, host=${hostLanguage.language || 'unavailable'}, auto=${expected}, delayed response, manual/persisted English, unchanged draft/save, stable editor and play page`)
  } finally { await browser.close() }
}
