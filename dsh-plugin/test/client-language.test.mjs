import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('../dist/client.js', import.meta.url), 'utf8')
const settle = () => new Promise(resolve => setImmediate(resolve))

function client(t, { localeService = true } = {}) {
  const response = Promise.withResolvers()
  const window = new EventTarget()
  let module, entry, registrations = 0, dictionary, revisions = 0
  const cleanups = [], requests = []
  const global = Object.create(globalThis)
  Object.defineProperties(global, {
    navigator: { value: { language: 'en-US', languages: ['en-US'] } },
    localStorage: { value: { getItem: () => null } },
    fetch: { value: (...args) => { requests.push(args); return response.promise } },
  })
  window.__ModuleLoader__ = { load(value) { module = value } }
  const document = { getElementById() {}, createElement: () => ({}), head: { appendChild() {} } }
  new Function('window', 'globalThis', 'document', source)(window, global, document)
  const exports = module.factory(name => { assert.equal(name, 'react'); return { createElement() {} } })
  const effect = setup => { cleanups.push(setup()) }
  const locale = {
    bind: () => key => dictionary?.en[key] ?? key,
    register(namespace, values) {
      assert.equal(namespace, 'qxqy-simulator')
      assert.equal(dictionary, undefined, 'old dictionary must be disposed before replacement')
      dictionary = values; revisions++
      return () => { dictionary = undefined; revisions++ }
    },
  }
  const ctx = {
    effect,
    inject(deps, setup) { assert.deepEqual(deps, ['locale']); if (localeService) setup({ locale, effect }) },
    slots: {
      inject(name, setup) { assert.equal(name, 'conversation.view'); effect(setup) },
      register(options, component) { registrations++; entry = { options, component }; return () => { entry = undefined } },
    },
  }
  exports.apply(ctx)
  let disposed = false
  const dispose = () => { if (disposed) return; disposed = true; for (const cleanup of cleanups.reverse()) cleanup?.() }
  t.after(dispose)
  return {
    response, requests, dispose,
    title: () => entry.options.label(),
    component: () => entry.component,
    registrations: () => registrations,
    revisions: () => revisions,
    manual: language => window.dispatchEvent(new CustomEvent('qxqy-ui-language-change', { detail: language })),
  }
}

test('DSH tab follows delayed native and manual language without replacing the editor or host preference', async t => {
  const app = client(t)
  assert.equal(app.title(), 'Simulator')
  assert.equal(app.requests.length, 1)
  assert.equal(app.requests[0][0], '/qxqy-simulator/api/locale')
  assert.equal(app.requests[0][1].body, '{}', 'locale does not depend on an editor session')
  const component = app.component()
  app.response.resolve({ ok: true, json: async () => ({ ok: true, value: { language: 'zh-CN', source: 'windows-ui' } }) })
  await settle()
  assert.equal(app.title(), '模拟器')
  app.manual('en')
  assert.equal(app.title(), 'Simulator')
  const revisions = app.revisions()
  app.manual('en')
  assert.equal(app.revisions(), revisions, 'unchanged text does not churn the host locale registry')
  app.manual('auto')
  assert.equal(app.title(), '模拟器')
  assert.equal(app.component(), component)
  assert.equal(app.registrations(), 1)
  app.dispose()
  const afterDispose = app.revisions()
  app.manual('en')
  assert.equal(app.revisions(), afterDispose, 'plugin unload removes the language subscription')
})

test('DSH client keeps working when an older host has no locale service', async t => {
  const app = client(t, { localeService: false })
  app.response.resolve({ ok: true, json: async () => ({ ok: true, value: { language: 'zh-CN', source: 'windows-ui' } }) })
  await settle()
  assert.equal(app.title(), '模拟器')
  assert.equal(app.registrations(), 1)
})

test('old or unavailable DSH language endpoint retains browser English', async t => {
  const app = client(t)
  app.response.resolve({ ok: false })
  await settle()
  assert.equal(app.title(), 'Simulator')
  app.manual('zh')
  assert.equal(app.title(), '模拟器')
})

test('built DSH play renderer exports every binding imported by the served play page', async () => {
  const html = await readFile(new URL('../lib/play.html', import.meta.url), 'utf8')
  const renderer = await import('../dist/play-renderer.js')
  const imports = html.match(/import\s*\{([^}]+)\}\s*from\s*['"]\/qxqy-simulator\/play-renderer\.js['"]/)[1]
  for (const name of imports.split(',').map(value => value.trim().split(/\s+as\s+/)[0])) {
    assert.equal(typeof renderer[name], 'function', `missing play export: ${name}`)
  }
})
