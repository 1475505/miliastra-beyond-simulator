import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { readLocalFont, localFont, localFontStack, serveLocalFont } from '../host/local-font.js'
import { SimulatorController } from '../host/controller.js'
import { textWindowMetrics } from '../play/scroll.js'
import { renderScenePng } from '../host-png.js'
import { geometryFont } from './fixtures/geometry-font.mjs'
import { distributable } from '../../scripts/distribution-filter.mjs'
import { defaultFontPaths, normalizeFontConfig, readFontConfig, writeFontConfig } from '../host/font-config.js'

test('local font validates input, stays out of serializable state and drives PNG/measurement/Worker', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'qxqy-font-'))
  const path = join(directory, 'private.ttf'), bytes = geometryFont()
  const previous = process.env.QXQY_FONT_PATH
  t.after(() => { if (previous === undefined) delete process.env.QXQY_FONT_PATH; else process.env.QXQY_FONT_PATH = previous; rmSync(directory, { recursive: true, force: true }) })
  assert.equal(readLocalFont(''), null)
  assert.throws(() => readLocalFont('relative.ttf'), /absolute path/)
  assert.throws(() => readLocalFont(join(directory, 'missing.ttf')), error => !error.message.includes(directory) && /readable/.test(error.message))
  writeFileSync(path, Buffer.alloc(20))
  assert.throws(() => readLocalFont(path), /valid TTF or OTF/)
  writeFileSync(path, bytes)
  process.env.QXQY_FONT_PATH = path
  const font = localFont()
  assert.deepEqual(font.data, bytes)
  const ctx = createCanvas(80, 80).getContext('2d')
  ctx.font = `20px ${localFontStack()}`
  assert.ok(Math.abs(ctx.measureText('AB').width - 28) < 0.2, 'synthetic advances must be 20 + 8 px')
  const metrics = textWindowMetrics({ text: 'AABA', fontSize: 20, showScrollBar: false }, 34, 80)
  assert.deepEqual(metrics.lines, ['A', 'AB', 'A'])
  assert.ok(!JSON.stringify(metrics).includes(directory))

  const item = { id: 1, kind: 'textbox', text: 'A', fontSize: 20, fontColor: 0xffffffff, bgColor: 0,
    enableOutline: false, sourceWidth: 80, sourceHeight: 80, horizontalAlignment: 'Left', verticalAlignment: 'Top',
    matrix: { a: 1, b: 0, c: 0, d: 1, tx: 40, ty: 40 } }
  const png = renderScenePng({ format: 'tree-v1', reset: true, nodes: [item] }, 80, 80)
  ctx.drawImage(await loadImage(png.data), 0, 0)
  const pixels = ctx.getImageData(0, 0, 80, 80).data, xs = [], ys = []
  for (let y = 0; y < 80; y++) for (let x = 0; x < 80; x++) {
    const i = (y * 80 + x) * 4
    if (pixels[i] > 240 && pixels[i + 1] > 240 && pixels[i + 2] > 240) { xs.push(x); ys.push(y) }
  }
  assert.ok(xs.length > 100)
  assert.ok(Math.abs(Math.max(...xs) - Math.min(...xs) + 1 - 12) <= 1, 'PNG uses the 600-unit rectangle, not a system A glyph')
  assert.ok(Math.abs(Math.max(...ys) - Math.min(...ys) + 1 - 14) <= 1)

  // The worker must not read the replaced disk file or inherit a different font.
  writeFileSync(path, 'no longer a font')
  const controller = new SimulatorController(directory, { clockMode: 'manual' })
  try {
    for (const [key, value] of Object.entries({ text: 'AB', fontSize: 40, minimumFontSize: 10,
      adaptiveFontSize: true, width: 32, height: 34 })) controller.patch({ op: 'set', id: 'n2', key, value })
    const editor = controller.get().boxes.find(node => node.id === 'n2').textLayout
    assert.equal(editor.fontSize, 20, '28px available width fits the synthetic AB advances at 20px')
    assert.deepEqual(editor.lines, ['AB'])
    assert.equal(editor.requiredHeight, 33, '24px line box plus 9px textbox occupancy')
    await controller.play('start')
    const snapshot = await controller.play('get', { view: true })
    const node = snapshot.scene.nodes.find(node => node.text === 'AB')
    assert.deepEqual(node.textLayout, editor, 'the real play Worker must use the startup font bytes, not the replaced file')
  } finally {
    await controller.dispose()
  }

  const request = { url: '/qxqy-font/manifest', method: 'GET', headers: { host: '127.0.0.1:1234' }, socket: { remoteAddress: '127.0.0.1' } }
  const call = overrides => {
    const result = {}; serveLocalFont({ ...request, ...overrides }, { writeHead(status, headers) { Object.assign(result, { status, headers }) }, end(body) { result.body = body } }); return result
  }
  // Real HTTP delivery/authentication is covered in web/test/local-font.test.mjs.
  // Keep only connection properties that an in-process HTTP client cannot fake.
  assert.equal(call({ socket: { remoteAddress: '192.0.2.10' } }).status, 403)
  for (const headers of [{ host: 'evil.test' },
    { host: request.headers.host, 'x-forwarded-for': '127.0.0.1' }]) assert.equal(call({ headers }).status, 403)
})

test('distribution excludes font containers and the local-only directory', () => {
  for (const name of ['private.ttf', 'PRIVATE.OTF', 'font.woff', 'font.woff2', 'collection.ttc', '.local-fonts/private.bin']) {
    assert.equal(distributable(join('public', name)), false, name)
  }
  assert.equal(distributable(join('public', 'styles.css')), true)
  assert.equal(distributable(join('studio', 'play', 'browser-font.js')), true)
})

test('font settings use portable defaults and survive real host restarts without changing projects', t => {
  const directory = mkdtempSync(join(tmpdir(), 'qxqy-font-config-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const config = join(directory, 'settings', 'font.json'), path = join(directory, 'private.ttf')
  writeFileSync(path, geometryFont())
  const module = new URL('../host/local-font.js', import.meta.url).href
  const env = { ...process.env, QXQY_FONT_CONFIG_PATH: config, QXQY_FONT_PATH: '' }
  const run = script => JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e',
    `import {localFont,localFontSettings,saveLocalFontSettings,serveLocalFont} from ${JSON.stringify(module)};
    const manifest=()=>{let body;serveLocalFont({url:'/qxqy-font/manifest',method:'GET',headers:{host:'localhost'},socket:{remoteAddress:'127.0.0.1'}},{writeHead(){},end(value){body=value}});return JSON.parse(body)};
    ${script}`],
  { env, windowsHide: true, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }))
  assert.deepEqual(defaultFontPaths('linux', {}), [])
  const candidates = defaultFontPaths('win32', {})
  assert.equal(candidates[0], 'C:\\Program Files\\Genshin Impact\\Genshin Impact Game\\YuanShen_Data\\StreamingAssets\\MiHoYoSDKRes\\HttpServerResources\\font\\zh-cn.ttf')
  assert.ok(candidates.every(value => value.startsWith('C:\\')))
  assert.ok(defaultFontPaths('win32', { SystemDrive: 'D:', ProgramFiles: 'D:\\Apps' })[0].startsWith('D:\\Apps\\'))
  assert.deepEqual(normalizeFontConfig({ mode: 'custom', path: `"${path}"` }), { mode: 'custom', path, scope: 'all' })
  assert.deepEqual(readFontConfig(config), { mode: 'auto', path: '', scope: 'all' })
  assert.throws(() => normalizeFontConfig({ mode: 'system', scope: 'invalid' }), /应用范围/)
  writeFontConfig({ mode: 'system', path: '' }, config)
  const selected = run(`saveLocalFontSettings({mode:'custom',path:${JSON.stringify(path)}}); console.log(JSON.stringify({settings:localFontSettings(),id:localFont()?.id??null}));`)
  assert.equal(selected.id, null, 'saving must not change the active host/Worker font before restart')
  assert.equal(selected.settings.restartRequired, true)
  assert.equal(readFontConfig(config).path, path)
  const restarted = run('console.log(JSON.stringify({settings:localFontSettings(),id:localFont()?.id??null}));')
  assert.match(restarted.id, /^[a-f0-9]{64}$/)
  assert.equal(restarted.settings.restartRequired, false)
  assert.equal(restarted.settings.active.path, path)
  assert.equal(restarted.settings.scope, 'all', 'old settings keep whole-UI behavior')
  const scopeChange = run(`saveLocalFontSettings({mode:'custom',path:${JSON.stringify(path)},scope:'game'}); console.log(JSON.stringify({settings:localFontSettings(),manifest:manifest()}));`)
  assert.equal(scopeChange.settings.scope, 'game')
  assert.equal(scopeChange.settings.active.scope, 'all')
  assert.equal(scopeChange.manifest.scope, 'all', 'saving scope does not change the startup snapshot')
  const gameScope = run('console.log(JSON.stringify({settings:localFontSettings(),manifest:manifest()}));')
  assert.equal(gameScope.settings.active.scope, 'game')
  assert.equal(gameScope.manifest.scope, 'game')
  assert.equal(gameScope.manifest.id, restarted.id, 'scope changes must not replace the game font')
  const before = readFileSync(config, 'utf8')
  assert.throws(() => run(`saveLocalFontSettings({mode:'custom',path:'relative.ttf'});`))
  assert.equal(readFileSync(config, 'utf8'), before, 'invalid paths must preserve the last saved settings')
  assert.throws(() => run(`process.env.QXQY_FONT_PATH=${JSON.stringify(path)}; saveLocalFontSettings({mode:'system'});`))
  assert.equal(readFileSync(config, 'utf8'), before, 'the environment variable keeps priority')
  const environmentScope = run(`process.env.QXQY_FONT_PATH=${JSON.stringify(path)}; saveLocalFontSettings({scope:'all'}); console.log(JSON.stringify({settings:localFontSettings(),manifest:manifest()}));`)
  assert.equal(environmentScope.settings.scope, 'all', 'scope remains editable with an environment-selected font')
  assert.equal(environmentScope.settings.path, path, 'scope-only writes preserve the saved font source')
  assert.equal(environmentScope.settings.active.source, 'environment')
  assert.equal(environmentScope.manifest.scope, 'game', 'environment-selected fonts also retain the startup scope')
  writeFileSync(path, 'font moved or corrupted')
  const recovered = run('console.log(JSON.stringify({settings:localFontSettings(),id:localFont()?.id??null}));')
  assert.equal(recovered.id, null)
  assert.match(recovered.settings.error, /valid TTF or OTF/)
  run("saveLocalFontSettings({mode:'system'}); console.log(JSON.stringify(localFontSettings()));")
  assert.equal(run('console.log(JSON.stringify(localFontSettings()));').error, '')
})
