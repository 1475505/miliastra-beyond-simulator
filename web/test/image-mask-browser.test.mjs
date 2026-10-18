import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { startTestBrowser } from './browser-helper.mjs'
import { maskScenes, maskSamples, maskAlphas } from '../../studio/test/fixtures/image-mask.mjs'
import { renderScenePng, flattenScenePaint } from '../../studio/host-png.js'

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
