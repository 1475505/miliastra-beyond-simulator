import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { startTestBrowser } from './browser-helper.mjs'
import { editorMaskProject, maskScenes, maskSamples, maskAlphas } from '../../studio/test/fixtures/image-mask.mjs'
import { renderScenePng, flattenScenePaint } from '../../studio/host-png.js'
import { createStudio } from '../../studio/index.js'
import { createWebServer } from '../server.js'

test('GPU and PNG agree on grouped masks, flat fallback, empty masks and viewport updates', { skip: !process.env.QXQY_BROWSER, timeout: 90_000 }, async t => {
  const bundle = await build({ stdin: { resolveDir: fileURLToPath(new URL('../../', import.meta.url)), sourcefile: 'mask-test.js', contents: `
import { PixiPlayRenderer } from './studio/play/pixi-renderer.js';
import { Rectangle } from 'pixi.js';
const renderer = new PixiPlayRenderer(document.querySelector('canvas'));
window.sample = async (scene, flat = false) => {
  if (flat) await renderer.render(scene, 240, 160); else await renderer.applyScene(scene, 240, 160);
  const out = renderer.app.renderer.extract.pixels({target: renderer.app.stage, frame: new Rectangle(0,0,240,160)});
  return ${JSON.stringify(maskSamples)}.map(([x,y]) => Array.from(out.pixels.slice((y*out.width+x)*4,(y*out.width+x)*4+4)));
};
renderer.ready.then(() => window.ready = true);
` }, bundle: true, platform: 'browser', format: 'esm', write: false, logLevel: 'silent',
    // The virtual entry resolves './studio/...' from the repo root, but bare
    // 'pixi.js' is a studio dependency that pnpm keeps out of the root store,
    // so esbuild needs studio's node_modules on its lookup path explicitly.
    nodePaths: [fileURLToPath(new URL('../../studio/node_modules', import.meta.url))] })
  const app = createServer((req, res) => {
    res.setHeader('content-type', req.url === '/bundle.js' ? 'text/javascript' : 'text/html')
    res.end(req.url === '/bundle.js' ? bundle.outputFiles[0].text : '<!doctype html><canvas></canvas><script type="module" src="/bundle.js"></script>')
  })
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve))
  const directory = mkdtempSync(join(tmpdir(), 'qxqy-mask-'))
  let browser
  t.after(async () => { await browser?.close(); await new Promise(resolve => app.close(resolve)); rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) })
  browser = await startTestBrowser(directory)
  await browser.navigate(`http://127.0.0.1:${app.address().port}`)
  await browser.wait('window.ready')
  const check = async (scene, alpha, flat = false) => {
    const gpu = await browser.evaluate(`window.sample(${JSON.stringify(flat ? flattenScenePaint(scene) : scene)},${flat})`)
    const ctx = createCanvas(240, 160).getContext('2d')
    ctx.drawImage(await loadImage(renderScenePng(scene, 240, 160, { background: 'transparent' }).data), 0, 0)
    maskSamples.forEach(([x, y], i) => {
      const png = [...ctx.getImageData(x, y, 1, 1).data]
      const expected = [png[0] * png[3] / 255, png[1] * png[3] / 255, png[2] * png[3] / 255, png[3]]
      assert.ok(Math.abs(png[3] - alpha[i]) <= 1, `independent expected alpha at ${x},${y}`)
      gpu[i].forEach((channel, c) => assert.ok(Math.abs(channel - expected[c]) <= 2, `flat=${flat} pixel=${x},${y} GPU=${gpu[i]} PNG=${expected}`))
    })
  }
  for (const [name, scene] of Object.entries(maskScenes())) {
    await check(scene, maskAlphas[name])
    await check(scene, maskAlphas[name], true)
  }
  const grid = maskScenes().grid
  await check(grid, maskAlphas.grid)
  const item = grid.nodes.find(n => n.id === 'mask')
  for (const [extra, alpha] of [
    [{ softEdgeWidthX: 40 }, [0, 0, 194, 255, 0]],
    [{ sourceWidth: 0 }, [0, 0, 0, 0, 0]],
    [{}, maskAlphas.grid],
    [{ enableMask: false }, maskAlphas.grid],
    [{ clipToParent: false }, maskAlphas.single],
  ]) {
    const updated = { ...item, ...extra }
    const pixels = await browser.evaluate(`window.sample(${JSON.stringify({ format: 'tree-v1', reset: false, changed: [updated] })})`)
    pixels.forEach((p, i) => {
      assert.ok(Math.abs(p[3] - alpha[i]) <= 2, `incremental ${JSON.stringify(extra)}: ${pixels}`)
      assert.equal(p[1], 0, 'no abandoned white clip graphic')
      assert.equal(p[2], 0, 'no abandoned white clip graphic')
    })
  }
})

test('editor DOM applies grouped feathering, updates mask settings and leaves selection editable', {
  skip: !process.env.QXQY_BROWSER, timeout: 90_000,
}, async t => {
  const directory = mkdtempSync(join(tmpdir(), 'qxqy-editor-mask-'))
  const studio = createStudio(editorMaskProject({ nested: true }))
  writeFileSync(join(directory, 'mask.save.json'), JSON.stringify(studio.archiveData()))
  const app = await createWebServer({ workspace: directory, port: 0, initialPath: 'mask.save.json' })
  let browser
  t.after(async () => { await browser?.close(); await app.close(); rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) })
  browser = await startTestBrowser(directory)
  const { evaluate, wait, send, sessionId } = browser
  await send('Emulation.setDeviceMetricsOverride', { width: 2400, height: 1250, deviceScaleFactor: 1, mobile: false }, sessionId)
  const sample = async () => {
    const clip = await evaluate(`(()=>{const r=document.querySelector('.qxsim-stage').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,scale:1}})()`)
    const shot = await send('Page.captureScreenshot', { format: 'png', clip }, sessionId)
    const ctx = createCanvas(1600, 900).getContext('2d')
    ctx.drawImage(await loadImage(Buffer.from(shot.data, 'base64')), 0, 0)
    return (x, y) => [...ctx.getImageData(x, y, 1, 1).data]
  }
  await browser.navigate(app.url + '/editor')
  await wait(`Boolean(document.querySelector('.qxsim-stage'))`)
  await evaluate(`(() => {
    const zoom=document.querySelector('[aria-label="画布缩放"]');zoom.value='1';zoom.dispatchEvent(new Event('change',{bubbles:true}));
    const style=document.createElement('style');style.textContent='.qxsim-stage{background:#000!important;border:0!important}.qxsim-stage:before,.qxsim-stage:after{display:none}';document.head.append(style);
  })()`)
  await wait(`document.querySelector('.qxsim-stage').getBoundingClientRect().width === 1600`)
  assert.equal(await evaluate(`document.querySelectorAll('[data-mask-id="mask"] [data-control-id]').length`), 4)
  let pixel = await sample()
  assert.deepEqual(pixel(740, 450), [0, 0, 0, 255])
  assert.ok(Math.abs(pixel(760, 450)[0] - 70) <= 3, 'nested groups multiply; overlapping children share each feather')
  assert.deepEqual(pixel(800, 450), [255, 0, 0, 255])
  assert.deepEqual(pixel(910, 450), [0, 0, 255, 255])
  await evaluate(`Array.from(document.querySelectorAll('.qxsim-row')).find(row=>row.querySelector('.qxsim-row-label')?.textContent==='mask').click()`)
  await wait(`Boolean(document.querySelector('[data-selection-id="mask"]'))`)
  const previousMask = await evaluate(`document.querySelector('[data-mask-id="mask"]').style.maskImage`)
  await evaluate(`(() => {
    const row=Array.from(document.querySelectorAll('.qxsim-pair')).find(row=>row.querySelector('.qxsim-pair-name')?.textContent==='羽化宽度');
    const input=row.querySelector('input');input.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'40');
    input.dispatchEvent(new Event('input',{bubbles:true}));
  })()`)
  await evaluate(`document.activeElement.blur()`)
  await wait(`document.querySelector('[data-mask-id="mask"]').style.maskImage !== ${JSON.stringify(previousMask)}`)
  pixel = await sample()
  assert.ok(Math.abs(pixel(760, 450)[0] - 35) <= 3, 'inspector commit updates feathering without a page refresh')
  await evaluate(`Array.from(document.querySelectorAll('.qxsim-row')).find(row=>row.querySelector('.qxsim-row-label')?.textContent==='red').click()`)
  await wait(`Boolean(document.querySelector('[data-selection-id="red"]'))`)
  assert.equal(await evaluate(`document.querySelector('[data-selection-id="red"]').closest('.qxsim-mask-group') === null`), true)
  await evaluate(`document.querySelector('[aria-label="mask画布可见性"]').click()`)
  await wait(`!document.querySelector('[data-control-id="red"]')`)
  assert.equal(await evaluate(`Boolean(document.querySelector('[data-control-id="sibling"]'))`), true)
  await evaluate(`document.querySelector('[aria-label="mask画布可见性"]').click()`)
  await wait(`Boolean(document.querySelector('[data-control-id="red"]'))`)
})
