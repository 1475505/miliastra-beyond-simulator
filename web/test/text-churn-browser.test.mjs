import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createWebServer } from '../server.js'
import { startTestBrowser } from './browser-helper.mjs'

test('changing HUD text retains visuals and bounded Pixi resources across scene restarts', {
  skip: !process.env.QXQY_BROWSER, timeout: 90_000,
}, async t => {
  const directory = mkdtempSync(join(tmpdir(), 'qxqy-text-churn-'))
  const app = await createWebServer({ workspace: directory, port: 0 })
  let browser
  t.after(async () => {
    await browser?.close(); await app.close()
    rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  })
  browser = await startTestBrowser(directory)
  await browser.navigate(app.url)
  await browser.wait('document.querySelector("#connection")?.textContent.includes("实时监听中")')
  await browser.evaluate(`(async () => {
    const { PixiPlayRenderer } = await import('/play-renderer.js');
    const canvas = document.createElement('canvas'); document.body.append(canvas);
    const renderer = window.churnRenderer = new PixiPlayRenderer(canvas);
    await renderer.ready;
    // Count real render resources without depending on nondeterministic heap GC.
    // These diagnostic fields belong to the pinned Pixi 8.20 implementation.
    window.resourceCounts = () => {
      const gpu = renderer.app.renderer;
      const texts = gpu.renderPipes.text._managedTexts.items;
      const textures = gpu.canvasText._activeTextures;
      return { gpuSources: Object.values(gpu.texture._managedTextures.items).filter(Boolean).length,
        textKeys: Object.keys(texts).length, liveTexts: Object.values(texts).filter(Boolean).length,
        textureKeys: Object.keys(textures).length, liveTextures: Object.values(textures).filter(Boolean).length };
    };
    window.textNode = (id, text) => ({ id, parent: null, z: 0, kind: 'textbox', text,
      fontSize: 24, fontColor: 0xffffffff, bgColor: 0, enableOutline: false,
      sourceWidth: 280, sourceHeight: 60, horizontalAlignment: 'Left', verticalAlignment: 'Top',
      matrix: { a: 1, b: 0, c: 0, d: 1, tx: 160, ty: 60 } });
    window.runTextBatch = async (start, count) => {
      let replaced = 0, previous;
      for (let i = start; i < start + count; i++) {
        const item = textNode(1, 'Score ' + i);
        await renderer.applyScene({ format: 'tree-v1', reset: false, changed: [item] }, 320, 120);
        const visual = renderer.nodes.get(1).__visual;
        if (previous && previous !== visual) replaced++;
        previous = visual;
      }
      const text = previous.__text;
      return { ...resourceCounts(), replaced, text:text.text,
        uploaded:text._gpuData[renderer.app.renderer.uid].currentKey.startsWith(text.text + ':') };
    };
  })()`)
  const shared = await browser.evaluate(`(async () => {
    const renderer = churnRenderer, gpu = renderer.app.renderer;
    await renderer.applyScene({ format:'tree-v1', reset:true, nodes:[textNode(1,'Shared'),textNode(2,'Shared')] },320,120);
    const text = renderer.nodes.get(2).__visual.__text;
    const data = text._gpuData[gpu.uid], texture = data.texture, source = texture.source;
    const before = gpu.canvasText.getReferenceCount(data.currentKey);
    await renderer.applyScene({ format:'tree-v1', reset:false, removed:[1] },320,120);
    const result = { before, after:gpu.canvasText.getReferenceCount(data.currentKey), destroyed:texture.destroyed || source.destroyed };
    // Exercise deferred text re-upload when a previously rendered node is culled.
    renderer.nodes.get(2).visible = false;
    await renderer.applyScene({ format:'tree-v1', reset:false, changed:[textNode(2,'Hidden update')] },320,120);
    renderer.nodes.get(2).visible = true;
    await renderer.applyScene({ format:'tree-v1', reset:false, changed:[] },320,120);
    result.afterHidden = resourceCounts();
    renderer.clearNodes();
    return result;
  })()`)
  // Production visuals own distinct TextStyles (Pixi keys include style uid).
  // Removing one must not release the surviving label's managed texture.
  assert.deepEqual([shared.before, shared.after, shared.destroyed], [1, 1, false], JSON.stringify(shared))
  assert.equal(shared.afterHidden.textureKeys, 1, JSON.stringify(shared))
  const samples = []
  for (let round = 0; round < 3; round++) {
    samples.push(await browser.evaluate(`runTextBatch(${round * 400}, 400)`))
    assert.equal(samples.at(-1).text, `Score ${round * 400 + 399}`)
    assert.equal(samples.at(-1).uploaded, true, 'the latest value must reach the GPU, not just the JS Text')
    await browser.evaluate(`churnRenderer.applyScene({format:'tree-v1',reset:true,nodes:[]},320,120)`)
    const empty = await browser.evaluate('resourceCounts()')
    assert.equal(empty.liveTexts, 0, JSON.stringify(empty))
    assert.equal(empty.liveTextures, 0, JSON.stringify(empty))
    assert.equal(empty.textKeys, 0, JSON.stringify(empty))
    assert.equal(empty.textureKeys, 0, JSON.stringify(empty))
  }
  t.diagnostic(JSON.stringify(samples))
  assert.ok(samples.every(sample => sample.replaced === 0), 'text-only changes must retain the visual/Text/mask objects')
  assert.ok(samples.every(sample => sample.gpuSources <= samples[0].gpuSources + 4), 'texture sources must plateau after warm-up')
  assert.ok(samples.every(sample => sample.textKeys <= 8 && sample.textureKeys <= 128), 'retired text keys must not accumulate across restart')
  await browser.evaluate('churnRenderer.destroy()')
})
