import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { apply } from '../lib/index.js'
import { createStudio } from '../../studio/index.js'
import { startTestBrowser } from '../../web/test/browser-helper.mjs'

async function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'qxqy-dsh-lesson-'))
  const routes = [], tools = [], effects = []
  const studio = createStudio()
  studio.patch({ op: 'renameSave', name: 'Downloaded DSH example' })
  studio.patch({ op: 'addScript', controlId: 'n1', path: 'lesson.lua', source: 'function OnStart() print("lesson-ready") end' })
  const archive = studio.archiveData()
  archive.scriptSync = { version: 1, workspaceDir: '', clientImportRoot: 'C:/publisher/default_import_file', clientSubdir: '' }
  let bytes = '<html>unavailable</html>', downloads = 0, reactBundle, holdDownload
  const server = createServer(async (request, response) => {
    const path = new URL(request.url, 'http://localhost').pathname
    if (path === '/example.save.json') { downloads++; if (holdDownload) await holdDownload; response.end(bytes); return }
    if (path === '/') {
      response.setHeader('content-type', 'text/html')
      response.end('<div id="root" style="height:100vh"></div><script src="/react.js"></script><script src="/client.js"></script>')
      return
    }
    if (path === '/react.js' || path === '/client.js') {
      response.setHeader('content-type', 'text/javascript')
      response.end(path === '/react.js' ? reactBundle : readFileSync(new URL('../dist/client.js', import.meta.url)))
      return
    }
    const route = routes.find(row => row.kind === 'exact' && row.path === path)
      || routes.find(row => row.kind === 'prefix' && (path === row.path || path.startsWith(row.path + '/')))
    if (!route) { response.statusCode = 404; response.end(); return }
    await route.handler(request, response)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${server.address().port}`
  const previous = process.env.QXQY_QUICK_START_URL
  process.env.QXQY_QUICK_START_URL = url + '/example.save.json'
  try {
    apply({ tools: { register(tool) { tools.push(tool) } }, webServer: { register(route) { routes.push(route) } },
      effect(factory) { effects.push(factory()) },
      get(name) { if (name === 'sessions') return { get: () => ({ header: { cwd: directory } }) } },
    })
  } finally {
    if (previous === undefined) delete process.env.QXQY_QUICK_START_URL
    else process.env.QXQY_QUICK_START_URL = previous
  }
  t.after(async () => {
    await Promise.all(effects.map(dispose => dispose?.()))
    await new Promise(resolve => { server.close(resolve); server.closeAllConnections() })
    rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  })
  return {
    directory, url, archive,
    get downloads() { return downloads },
    valid() { bytes = JSON.stringify(archive) },
    hold(promise) { holdDownload = promise },
    async dispose() { await Promise.all(effects.map(dispose => dispose?.())) },
    async post(action, body = {}, sessionId = 'conversation') {
      return (await fetch(url + '/qxqy-simulator/api/' + action, { method: 'POST',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId, ...body }) })).json()
    },
    tool(name, args = {}, sessionId = 'conversation') {
      return tools.find(tool => tool.name === name).execute(args, { agent: { id: sessionId, session: { header: { cwd: directory } } } })
    },
    async browserFixture() {
      const result = await build({ stdin: { contents: `
        import React from 'react'; import { createRoot } from 'react-dom/client';
        const root = createRoot(document.getElementById('root'));
        window.__ModuleLoader__ = { load(module) {
          const plugin = module.factory(name => { if (name !== 'react') throw new Error(name); return React; });
          plugin.apply({ effect(factory) { factory(); }, inject() {}, slots: {
            inject(_name, factory) { factory(); },
            register(_slot, View) { root.render(React.createElement(View, { sessionId: 'conversation' })); }
          }});
        }};
      `, resolveDir: fileURLToPath(new URL('../../web', import.meta.url)) }, bundle: true, write: false, format: 'iife', platform: 'browser' })
      reactBundle = result.outputFiles[0].text
    },
  }
}

test('DSH downloads an isolated lesson and keeps HTTP, AI tools, save and play on the active project', async t => {
  const app = await fixture(t)
  let original = (await app.post('get')).value
  original = (await app.post('patch', { op: { op: 'renameSave', name: 'Unsaved original', expectedRevision: original.version } })).value
  assert.equal((await app.post('quick-start-info')).value.enabled, true)
  assert.equal((await app.post('quick-start-open')).ok, false)
  assert.deepEqual((await app.post('get')).value, original)
  app.valid()
  const opened = await Promise.all([app.post('quick-start-open'), app.post('quick-start-open')])
  assert(opened.every(result => result.ok))
  assert.equal(app.downloads, 2, 'one failed request and one deduplicated download')
  const lesson = opened[0].value
  assert.equal(lesson.save.name, app.archive.meta.name)
  assert.equal(lesson.scriptSync, null)
  assert.equal(lesson.storage.path, '')
  assert.equal(lesson.quickStart.originalId, 'conversation')
  assert.deepEqual(await app.tool('qxqy_studio_get'), lesson)
  assert.equal((await app.tool('qxqy_studio_get', {}, 'other')).save.name, '未命名存档')
  assert.deepEqual(readdirSync(app.directory), [], 'downloading does not write the original or lesson to disk')
  const modified = await app.tool('qxqy_studio_patch', { op: { op: 'renameSave', name: 'My practice copy', expectedRevision: lesson.version } })
  assert.equal(modified.quickStart.originalId, 'conversation')
  assert.equal((await app.post('get')).value.save.name, 'My practice copy')
  assert.equal((await app.post('save', { path: lesson.quickStart.savePath, expectedRevision: modified.version })).ok, true)
  assert.equal((await app.tool('qxqy_studio_play', { action: 'start', args: { clockMode: 'manual' } })).running, true)
  assert.deepEqual((await app.post('quick-start-back')).value, original)
  assert.deepEqual(await app.tool('qxqy_studio_get'), original)
  assert.equal((await app.post('play', { action: 'get' })).ok, false, 'the old lesson Worker is stopped and the original has no active play')
  assert.equal((await app.post('quick-start-open')).value.save.name, 'My practice copy')
  assert.equal(app.downloads, 2, 'the existing lesson keeps its edits without downloading again')
  const saved = JSON.parse(readFileSync(join(app.directory, lesson.quickStart.savePath), 'utf8'))
  assert.equal(saved.meta.name, 'My practice copy')
})

test('DSH ModuleLoader shows the download button, retries, restores the lesson and returns to original work', { skip: !process.env.QXQY_BROWSER, timeout: 60_000 }, async t => {
  const app = await fixture(t)
  await app.browserFixture()
  const original = await app.tool('qxqy_studio_patch', { op: { op: 'renameSave', name: 'Keep original work' } })
  const browserDirectory = mkdtempSync(join(tmpdir(), 'qxqy-dsh-lesson-browser-'))
  const browser = await startTestBrowser(browserDirectory)
  t.after(async () => { await browser.close(); rmSync(browserDirectory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) })
  const { evaluate, wait } = browser
  const click = text => evaluate(`[...document.querySelectorAll('button')].find(el => el.textContent === ${JSON.stringify(text)} || el.getAttribute('aria-label') === ${JSON.stringify(text)}).click()`)
  await browser.navigate(app.url)
  await wait(`!!document.querySelector('.qxsim-footer')`)
  await click('快速上手')
  await wait(`document.querySelector('.qxsim-quick-welcome')?.open`)
  await click('下载示例，开始实操')
  await wait(`!!document.querySelector('.qxsim-quick-welcome [role=alert]')`)
  assert.deepEqual(await app.tool('qxqy_studio_get'), original)
  app.valid()
  await click('重试打开示例')
  await wait(`document.querySelector('[data-quick-step]')?.dataset.quickStep === 'debug'`)
  assert.equal(await evaluate(`document.querySelector('.qxsim-brand').textContent.includes('Downloaded DSH example')`), true)
  assert.equal((await app.tool('qxqy_studio_get')).save.name, app.archive.meta.name)
  await evaluate(`(()=>{const select=document.querySelector('[aria-label="导览阶段"]');select.value='1';select.dispatchEvent(new Event('change',{bubbles:true}));})()`)
  await wait(`document.querySelector('[data-quick-step]')?.dataset.quickStep === 'export'`)
  await browser.navigate(app.url)
  await wait(`document.querySelector('[data-quick-step]')?.dataset.quickStep === 'export' && !document.querySelector('.qxsim-quick-welcome')`)
  await click('返回原工程')
  await wait(`document.querySelector('.qxsim-brand').textContent.includes('Keep original work')`)
  assert.deepEqual(await app.tool('qxqy_studio_get'), original)
  await click('快速上手')
  await wait(`document.querySelector('.qxsim-quick-welcome')?.open`)
  await click('下载示例，开始实操')
  await wait(`document.querySelector('[data-quick-step]')?.dataset.quickStep === 'export'`)
  assert.equal(app.downloads, 2)
})

test('unloading DSH cancels an in-flight example download without resurrecting a controller', { timeout: 10_000 }, async t => {
  const app = await fixture(t)
  app.valid()
  const held = Promise.withResolvers()
  app.hold(held.promise)
  const request = app.post('quick-start-open')
  try {
    while (!app.downloads) await new Promise(resolve => setTimeout(resolve, 10))
    await app.dispose()
    const result = await request
    assert.equal(result.ok, false)
    assert.equal((await app.post('get')).ok, false)
  } finally { held.resolve() }
})
