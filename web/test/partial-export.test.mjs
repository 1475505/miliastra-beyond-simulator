import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createWebServer } from '../server.js'
import { exportFixture } from '../../studio/test/fixtures/partial-export.js'
import { importGia } from '../../studio/gia/codec.js'
import { startTestBrowser } from './browser-helper.mjs'

async function setup(t) {
  const directory = mkdtempSync(join(tmpdir(), 'qxqy-export-'))
  writeFileSync(join(directory, 'fixture.save.json'), JSON.stringify(exportFixture().archiveData()))
  const app = await createWebServer({ workspace: directory, initialPath: 'fixture.save.json', port: 0 })
  const env = { directory, app, browser: null }
  t.after(async () => {
    await env.browser?.close()
    await app.close()
    rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  })
  return env
}

test('Web exports selected client subtrees without changing editor state', async t => {
  const { app } = await setup(t)
  const call = async (action, body = {}) => {
    const response = await fetch(app.url + '/editor/api/' + action, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: 'export-test', ...body }) })
    return { status: response.status, ...await response.json() }
  }
  const before = (await call('get')).value
  const choices = (await call('export-list')).value
  const args = { controlIds: ['image', 'b'], expectedRevision: choices.revision }
  const preview = (await call('export-preview', args)).value
  assert.deepEqual(preview.selection.controlIds, ['image', 'b'])
  const exported = (await call('export', { format: 'gia-partial', ...args })).value
  assert.deepEqual(importGia(Buffer.from(exported.data, 'base64')).project.root.children.map(node => node.name), ['Badge', 'Other'])
  assert.deepEqual((await call('get')).value, before)
  assert.equal((await call('export', { format: 'gia-partial', controlIds: [] })).status, 400)
})

test('browser inspector export and partial-combination dialog preview/check/download selected controls', { skip: !process.env.QXQY_BROWSER, timeout: 60000 }, async t => {
  const env = await setup(t)
  const browser = env.browser = await startTestBrowser(env.directory)
  await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.exportDownloads=[];
    const blobs=new Map(),create=URL.createObjectURL.bind(URL);
    URL.createObjectURL=function(blob){const url=create(blob);blobs.set(url,blob);return url};
    HTMLAnchorElement.prototype.click=function(){if(this.download){const name=this.download;blobs.get(this.href).arrayBuffer().then(b=>exportDownloads.push({name,bytes:Array.from(new Uint8Array(b))}));}};
  ` }, browser.sessionId)
  await browser.navigate(env.app.url + '/editor')
  await browser.wait(`!!document.querySelector('.qxsim-asset-switch')`)
  const click = async text => {
    const found = await browser.evaluate(`(() => { const b=[...document.querySelectorAll('button')].find(b=>b.textContent===${JSON.stringify(text)});if(!b||b.disabled)return false;b.click();return true})()`)
    assert.equal(found, true, text)
  }
  await click('UI控件-客户端')
  await browser.wait(`!!document.querySelector('.qxsim-export-single')`)
  await browser.evaluate(`document.querySelector('.qxsim-export-single').click()`)
  await browser.wait('exportDownloads.length===1')
  let downloaded = await browser.evaluate('exportDownloads[0]')
  assert.deepEqual(importGia(Buffer.from(downloaded.bytes)).project.root.children.map(node => node.name), ['Card'])
  await browser.evaluate(`(() => {const s=document.querySelector('[aria-label="导出格式"]');s.value='gia-partial';s.dispatchEvent(new Event('change',{bubbles:true}))})()`)
  await browser.wait(`!!(document.querySelector('.qxsim-export-dialog')?.open && document.querySelector('[data-export-preview-id="a"]'))`)
  await browser.evaluate(`document.querySelector('[aria-label="导出 Card"]').click();document.querySelector('[aria-label="导出 Badge"]').click();document.querySelector('[aria-label="导出 Other"]').click();document.querySelector('[aria-label="预览 Badge"]').click()`)
  await browser.wait(`!!document.querySelector('[data-export-preview-id="image"] [data-control-id="image"]')`)
  assert.equal(await browser.evaluate(`document.querySelector('.qxsim-export-preview [data-control-id="image"]').style.background.includes('255, 0, 0')`), true)
  if (process.env.QXQY_EXPORT_SCREENSHOT) {
    const image = await browser.send('Page.captureScreenshot', { format: 'png' }, browser.sessionId)
    writeFileSync(process.env.QXQY_EXPORT_SCREENSHOT, Buffer.from(image.data, 'base64'))
  }
  await browser.evaluate(`(() => {const d=document.querySelector('.qxsim-export-dialog');[...d.querySelectorAll('button')].find(b=>b.textContent==='导出 GIA').click()})()`)
  await browser.wait('exportDownloads.length===2')
  downloaded = await browser.evaluate('exportDownloads[1]')
  assert.deepEqual(importGia(Buffer.from(downloaded.bytes)).project.root.children.map(node => node.name), ['Badge', 'Other'])
  await browser.wait(`!document.querySelector('.qxsim-export-dialog')`)
  // Reopen and cancel via the actual dialog Escape path.
  await browser.evaluate(`(() => {const s=document.querySelector('[aria-label="导出格式"]');s.value='gia-partial';s.dispatchEvent(new Event('change',{bubbles:true}))})()`)
  await browser.wait(`document.querySelector('.qxsim-export-dialog')?.open`)
  await browser.key('Escape', 'Escape')
  await browser.wait(`!document.querySelector('.qxsim-export-dialog')`)
  assert.equal(await browser.evaluate(`document.querySelector('.qxsim-row.active .qxsim-row-label').textContent`), 'Card')
  // Ordinary child controls have the same inspector shortcut; no promotion of
  // the live authoring tree is required.
  await browser.evaluate(`[...document.querySelectorAll('.qxsim-row')].find(row=>row.querySelector('.qxsim-row-label').textContent==='Badge').click()`)
  await browser.wait(`document.querySelector('.qxsim-row.active .qxsim-row-label').textContent==='Badge'`)
  await browser.evaluate(`document.querySelector('.qxsim-export-single').click()`)
  await browser.wait('exportDownloads.length===3')
  downloaded = await browser.evaluate('exportDownloads[2]')
  assert.deepEqual(importGia(Buffer.from(downloaded.bytes)).project.root.children.map(node => node.name), ['Badge'])
  // English UI keeps the same functionality and preserves authored names.
  await browser.evaluate(`(() => {const s=document.querySelector('.qxsim-language');s.value='en';s.dispatchEvent(new Event('change',{bubbles:true}))})()`)
  await browser.wait(`document.querySelector('.qxsim-export-single').textContent==='Export GIA'`)
  await browser.evaluate(`(() => {const s=document.querySelector('[aria-label="Export format"]');s.value='gia-partial';s.dispatchEvent(new Event('change',{bubbles:true}))})()`)
  await browser.wait(`!!document.querySelector('[aria-label="Export Selected Controls"]')`)
  await browser.wait(`!!document.querySelector('[aria-label="Preview Badge"]')`)
  assert.equal(await browser.evaluate(`document.querySelector('.qxsim-export-row.active strong').textContent`), 'Badge')
})
