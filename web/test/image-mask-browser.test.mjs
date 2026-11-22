import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
import { startTestBrowser } from './browser-helper.mjs'
import { editorMaskProject, maskScenes, maskSamples, maskAlphas, contourSamples, contourAlphas, contourScene, disjointReverseMaskScene } from '../../studio/test/fixtures/image-mask.mjs'
import { imageTiltFixture } from '../../studio/test/fixtures/image-tilt.mjs'
import { renderScenePng, flattenScenePaint } from '../../studio/host-png.js'
import { createStudio } from '../../studio/index.js'
import { createWebServer } from '../server.js'
import { ImageAssetStore } from '../../studio/host/image-assets.js'
import { imageAssetKey } from '../../studio/assets/catalog.js'

// Native Canvas instances must come from the same module as Host PNG.
const { createCanvas, loadImage } = createRequire(new URL('../../studio/package.json', import.meta.url))('@napi-rs/canvas')

test('GPU and PNG agree on hierarchy projection, masks and viewport updates', { skip: !process.env.QXQY_BROWSER, timeout: 90_000 }, async t => {
  const bundle = await build({ stdin: { resolveDir: fileURLToPath(new URL('../../', import.meta.url)), sourcefile: 'mask-test.js', contents: `
import { PixiPlayRenderer } from './studio/play/pixi-renderer.js';
import { refreshBrowserImage } from './studio/assets/browser.js';
import { Rectangle } from 'pixi.js';
const renderer = new PixiPlayRenderer(document.querySelector('canvas'));
window.renderer = renderer;
window.refreshMask = id => refreshBrowserImage(id);
window.sample = async (scene, flat = false, samples = ${JSON.stringify(maskSamples)}) => {
  if (flat) await renderer.render(scene, 240, 160); else await renderer.applyScene(scene, 240, 160);
  const out = renderer.app.renderer.extract.pixels({target: renderer.app.stage, frame: new Rectangle(0,0,240,160)});
  return samples.map(([x,y]) => Array.from(out.pixels.slice((y*out.width+x)*4,(y*out.width+x)*4+4)));
};
renderer.ready.then(() => window.ready = true);
` }, bundle: true, platform: 'browser', format: 'esm', write: false, logLevel: 'silent',
    // The virtual entry resolves './studio/...' from the repo root, but bare
    // 'pixi.js' is a studio dependency that pnpm keeps out of the root store,
    // so esbuild needs studio's node_modules on its lookup path explicitly.
    nodePaths: [fileURLToPath(new URL('../../studio/node_modules', import.meta.url))] })
  const assetImage = createCanvas(10, 10), assetCtx = assetImage.getContext('2d')
  assetCtx.fillStyle = '#fff'; assetCtx.fillRect(0, 0, 10, 10); assetCtx.clearRect(2, 2, 6, 6)
  let assetPng = assetImage.toBuffer('image/png')
  const meta = { width: 10, height: 10, border: { left: 2, right: 2, top: 2, bottom: 2 } }
  const app = createServer((req, res) => {
    if (req.url.startsWith('/qxqy-assets/')) {
      const metadata = new URL(req.url, 'http://localhost').pathname.endsWith('.json')
      res.setHeader('content-type', metadata ? 'application/json' : 'image/png')
      res.end(metadata ? JSON.stringify(meta) : assetPng)
      return
    }
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
  const check = async (scene, alpha, flat = false, samples = maskSamples, assets = {}) => {
    const gpu = await browser.evaluate(`window.sample(${JSON.stringify(flat ? flattenScenePaint(scene) : scene)},${flat},${JSON.stringify(samples)})`)
    const ctx = createCanvas(240, 160).getContext('2d')
    ctx.drawImage(await loadImage(renderScenePng(scene, 240, 160, { background: 'transparent', ...assets }).data), 0, 0)
    samples.forEach(([x, y], i) => {
      const png = [...ctx.getImageData(x, y, 1, 1).data]
      const expected = [png[0] * png[3] / 255, png[1] * png[3] / 255, png[2] * png[3] / 255, png[3]]
      assert.ok(Math.abs(png[3] - alpha[i]) <= 1, `PNG alpha at ${x},${y}: ${png[3]}, expected ${alpha[i]}`)
      gpu[i].forEach((channel, c) => assert.ok(Math.abs(channel - expected[c]) <= 2, `flat=${flat} pixel=${x},${y} GPU=${gpu[i]} PNG=${expected}`))
    })
  }
  for (const [name, scene] of Object.entries(maskScenes())) {
    await check(scene, maskAlphas[name])
    await check(scene, maskAlphas[name], true)
  }
  for (const [primitive, alpha] of Object.entries(contourAlphas)) for (const reverseMaskArea of [false, true]) {
    const scene = contourScene(primitive, { reverseMaskArea })
    const expected = alpha.map((a, i) => reverseMaskArea && i !== 0 ? 255 - a : a)
    await check(scene, expected, false, contourSamples)
    await check(scene, expected, true, contourSamples)
  }
  await check(contourScene('ring', { reverseMaskArea: true, sourceWidth: 0 }), contourSamples.map(() => 0), false, contourSamples)
  const inverseSoft = contourScene('rect', { reverseMaskArea: true, enableSoftEdge: true, softEdgeWidthX: 20 })
  for (const flat of [false, true]) await check(inverseSoft, [0, 121, 0, 0, 6], flat)
  for (const angle of [0, 45, 90]) {
    const disjoint = disjointReverseMaskScene(angle)
    for (const flat of [false, true]) await check(disjoint, [0, 0], flat, [[164, 80], [76, 80]])
  }
  const rotated = maskScenes().single
  const s = Math.SQRT1_2
  Object.assign(rotated.nodes[1], { reverseMaskArea: true, matrix: { a: s, b: s, c: -s, d: s, tx: 0, ty: 0 } })
  rotated.nodes[2].sourceHeight = 140
  // (80,50) is inside the screen bounds but outside the rotated rectangle;
  // (148,51) is 9.7 units inside the right feather in mask-local coordinates.
  for (const flat of [false, true]) await check(rotated, [0, 131, 0], flat, [[80, 50], [148, 51], [120, 80]])
  const percentage = contourScene('rect', { enableSoftEdge: true, softEdgeMode: 'Percentage', horizontalSoftRange: 100, verticalSoftRange: 100 })
  // The two edge samples are 10.5 units into the mask; range 60 gives a 20-unit feather on a 100-unit side.
  const percentageSamples = [[60, 80], [80, 80], [120, 40], [120, 80]]
  await check(percentage, [0, 255, 255, 255], false, percentageSamples)
  const percentageMask = percentage.nodes.find(n => n.id === 'mask')
  for (const [extra, alpha] of [
    [{ horizontalSoftRange: 60 }, [0, 134, 255, 255]],
    [{ verticalSoftRange: 60 }, [0, 134, 134, 255]],
    [{ reverseMaskArea: true }, [0, 121, 121, 0]],
    [{ reverseMaskArea: false }, [0, 134, 134, 255]],
  ]) {
    Object.assign(percentageMask, extra)
    const delta = { format: 'tree-v1', reset: false, changed: [percentageMask] }
    const gpu = await browser.evaluate(`window.sample(${JSON.stringify(delta)},false,${JSON.stringify(percentageSamples)})`)
    gpu.forEach((pixel, i) => assert.ok(Math.abs(pixel[3] - alpha[i]) <= 2, `${JSON.stringify(extra)}: pixel ${percentageSamples[i]} alpha ${pixel[3]}, expected ${alpha[i]}`))
  }
  // A 270° sector intersects the reversed feather, rather than revealing
  // pixels cut by either the fill shape or the mask rectangle.
  const radial = contourScene('rect', { sourceWidth: 80, reverseMaskArea: true, enableSoftEdge: true, softEdgeWidthX: 20 })
  const artwork = radial.nodes.at(-1)
  Object.assign(artwork, { sourceWidth: 100, sourceHeight: 60, fillType: 'Radial360', fillRadialType: 'Top', fillAmount: .75 })
  const fillSamples = [[90, 65], [150, 65], [90, 95], [150, 95], [128, 94], [75, 95], [164, 95]]
  await check(radial, [0, 134, 121, 134, 0, 0, 0], false, fillSamples)
  const turned = { format: 'tree-v1', reset: false, changed: [{ ...artwork, fillRadialType: 'Right' }] }
  const filled = await browser.evaluate(`window.sample(${JSON.stringify(turned)},false,${JSON.stringify(fillSamples)})`)
  for (const [i, alpha] of [121, 0, 121, 134, 0, 0, 0].entries()) {
    assert.ok(Math.abs(filled[i][3] - alpha) <= 2, `changing only the origin updates the GPU clip at ${fillSamples[i]}`)
  }
  await check(radial, [0, 134, 121, 134, 0, 0, 0], true, fillSamples)
  const contour = contourScene('circle')
  await check(contour, contourAlphas.circle, false, contourSamples)
  const baseMask = contour.nodes.find(n => n.id === 'mask')
  const changedMask = { ...baseMask, primitive: 'ring', imageId: 100006, reverseMaskArea: true }
  const changed = await browser.evaluate(`window.sample(${JSON.stringify({ format: 'tree-v1', reset: false, changed: [changedMask] })},false,${JSON.stringify(contourSamples)})`)
  changed.forEach((pixel, i) => assert.ok(Math.abs(pixel[3] - (i === 0 ? 0 : 255 - contourAlphas.ring[i])) <= 2, 'incremental shape + reverse'))
  const nested = contourScene('circle')
  const inner = { ...baseMask, id: 'inner', parent: 'mask', primitive: 'ring', imageId: 100006, reverseMaskArea: true }
  nested.nodes.find(n => n.id === 'red').parent = 'inner'
  nested.nodes.splice(2, 0, inner)
  await check(nested, contourAlphas.circle.map((alpha, i) => alpha && !contourAlphas.ring[i] ? 255 : 0), false, contourSamples)
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
  const tilted = imageTiltFixture(t)
  const tiltSamples = [[58, 80], [81, 80], [120, 80], [159, 80], [182, 80]]
  const [clear, cyan, red, yellow] = [[0, 0, 0, 0], [55, 203, 231, 255], [255, 0, 0, 255], [255, 255, 0, 255]]
  const original = [clear, red, cyan, yellow, clear]
  let tiltScene = tilted.scene()
  const sampleTilt = scene => browser.evaluate(`window.sample(${JSON.stringify(scene)},false,${JSON.stringify(tiltSamples)})`)
  assert.deepEqual(await sampleTilt(tiltScene), original)
  for (const [change, expected] of [
    [() => tilted.lua('Pose', 45, 45), Array(5).fill(clear)],
    [() => tilted.lua('Pose', 45, -45), original],
    [() => tilted.lua('SetDepth', 2), [red, cyan, cyan, cyan, yellow]],
    [() => { tilted.lua('SetDepth', 1); tilted.lua('Pose', 90, -90) }, original],
    [() => tilted.lua('Pose', 90, 90), [clear, yellow, cyan, red, clear]],
    [() => tilted.lua('Pose', 0, 0), original],
  ]) {
    change()
    tiltScene = tilted.scene(tiltScene.revision)
    assert.equal(tiltScene.reset, false)
    assert.deepEqual(await sampleTilt(tiltScene), expected)
  }

  // Separate projected planes: viewport x=110..130, image mask x=85..125
  // with an 8-unit on-screen feather. The face behind them remains face-on.
  const projected = maskScenes().grid
  const [, viewport, mask, face] = projected.nodes
  mask.group = true
  const plane = (a, tx = 0) => ({ a, b: 0, c: 0, d: 1, tx, ty: 0 })
  viewport.projectedMatrix = plane(.5)
  mask.projectedMatrix = plane(.4, -15)
  face.projectedMatrix = plane(1)
  const projectedSamples = [[89, 80], [112, 80], [121, 80], [128, 80], [135, 80]]
  for (const flat of [true, false]) await check(projected, [0, 255, 112, 0, 0], flat, projectedSamples)
  await browser.evaluate(`window.tiltMaskTexture = renderer.nodes.get('mask').__imageMask.texture;void 0`)
  const deltaAlphas = async changed => {
    const delta = { format: 'tree-v1', reset: false, changed }
    const pixels = await browser.evaluate(`window.sample(${JSON.stringify(delta)},false,${JSON.stringify(projectedSamples)})`)
    return pixels.map(p => p[3])
  }
  // Projection-only movement must not rebuild the soft edge raster.
  mask.projectedMatrix = plane(.4, -7)
  const movedAlphas = await deltaAlphas([mask])
  for (const [i, alpha] of [0, 255, 255, 143, 0].entries()) {
    assert.ok(Math.abs(movedAlphas[i] - alpha) <= 2, `moved mask alpha at ${projectedSamples[i]}`)
  }
  assert.equal(await browser.evaluate(`renderer.nodes.get('mask').__imageMask.texture === tiltMaskTexture`), true)
  // The edge-on mask clips even when reversed. Disabling it, however, must
  // restore the face inside its independent viewport without flattening it.
  mask.projectedMatrix = plane(0)
  assert.deepEqual(await deltaAlphas([mask]), [0, 0, 0, 0, 0])
  mask.reverseMaskArea = true
  assert.deepEqual(await deltaAlphas([mask]), [0, 0, 0, 0, 0])
  for (const flat of [true, false]) await check(projected, [0, 0, 0, 0, 0], flat, projectedSamples)
  mask.enableMask = false
  assert.deepEqual(await deltaAlphas([mask]), [0, 255, 255, 255, 0])
  viewport.projectedMatrix = plane(0)
  assert.deepEqual(await deltaAlphas([viewport]), [0, 0, 0, 0, 0])
  viewport.projectedMatrix = plane(.5)
  assert.deepEqual(await deltaAlphas([viewport]), [0, 255, 255, 255, 0])

  const textureScene = contourScene('sprite', { imageId: 101001, imageType: 'Basic' })
  const textureMask = textureScene.nodes.find(n => n.id === 'mask')
  const textureSamples = [[60, 80], [82, 80], [120, 80], [169, 80]]
  const assets = { images: new Map([[imageAssetKey(101001), await loadImage(assetPng)]]), imageMetadata: new Map([[imageAssetKey(101001), meta]]) }
  await browser.evaluate(`window.sample(${JSON.stringify(textureScene)})`)
  await browser.wait(`!!renderer.imageTextures.get('StaticReference:101001')?.texture`)
  await check(textureScene, [0, 255, 0, 255], false, textureSamples, assets)
  const spriteFill = { ...radial, nodes: [radial.nodes[0], { ...artwork, parent: 'root', primitive: 'sprite',
    imageId: 101001, imageType: 'Stretch', fillRadialType: 'Bottom', fillAmount: .25 }] }
  await check(spriteFill, [255, 0, 0], false, [[70, 96], [90, 96], [169, 96]], assets)
  textureMask.imageType = 'Stretch'
  await check(textureScene, [0, 0, 0, 255], false, textureSamples, assets)
  textureMask.reverseMaskArea = true
  await check(textureScene, [0, 255, 255, 0], false, textureSamples, assets)
  await check(textureScene, [0, 255, 255, 0], true, textureSamples, assets)
  await browser.wait(`!!renderer.imageTextures.get('StaticReference:101001')?.texture`)
  await browser.evaluate(`window.oldMaskTexture=[...renderer.nodes.values()].find(root=>root.__imageMask).__imageMask.texture;window.oldImageTexture=renderer.imageTextures.get('StaticReference:101001').texture;void 0`)
  assetCtx.fillStyle = '#fff'; assetCtx.fillRect(0, 0, 10, 10)
  assetPng = assetImage.toBuffer('image/png')
  await browser.evaluate(`refreshMask(101001)`)
  await browser.wait(`oldImageTexture.destroyed && !!renderer.imageTextures.get('StaticReference:101001')?.texture`)
  // No scene update: completion must repaint the bounded reversed alpha on
  // the existing GPU resource.
  const refreshed = await browser.evaluate(`window.sample({format:'tree-v1',reset:false,changed:[]},false,${JSON.stringify(textureSamples)})`)
  assert.deepEqual(refreshed.map(p => p[3]), [0, 0, 0, 0])
  assert.equal(await browser.evaluate(`oldMaskTexture.destroyed`), false)
  await browser.evaluate(`renderer.destroy()`)
  assert.equal(await browser.evaluate(`oldMaskTexture.destroyed`), true)
})

test('editor DOM applies grouped feathering, updates mask settings and leaves selection editable', {
  skip: !process.env.QXQY_BROWSER, timeout: 90_000,
}, async t => {
  const directory = mkdtempSync(join(tmpdir(), 'qxqy-editor-mask-'))
  const project = editorMaskProject({ nested: true })
  const inner = project.root.children[0].children.find(n => n.id === 'mask').children[0]
  for (const image of [inner, ...inner.children]) for (const transform of Object.values(image.transformByPlatform)) transform.size.y = 100
  const studio = createStudio(project)
  const assetImage = createCanvas(10, 10), assetContext = assetImage.getContext('2d')
  assetContext.fillStyle = '#fff'; assetContext.fillRect(0, 0, 10, 10); assetContext.clearRect(2, 2, 6, 6)
  const metadata = { m_Rect: { width: 10, height: 10 }, m_Border: { X: 2, Y: 2, Z: 2, W: 2 },
    m_RD: { textureRectOffset: { X: 0, Y: 0 }, textureRect: { width: 10, height: 10 }, settingsRaw: { packingRotation: 'None' } } }
  const images = new ImageAssetStore({ cacheDir: join(directory, 'cache'), fetch: async url =>
    String(url).endsWith('.png') ? new Response(assetImage.toBuffer('image/png')) : Response.json(metadata) })
  writeFileSync(join(directory, 'mask.save.json'), JSON.stringify(studio.archiveData()))
  const app = await createWebServer({ workspace: directory, port: 0, initialPath: 'mask.save.json', imageAssets: images })
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
  const select = async id => {
    await evaluate(`Array.from(document.querySelectorAll('.qxsim-row')).find(row=>row.querySelector('.qxsim-row-label')?.textContent===${JSON.stringify(id)}).click()`)
    await wait(`Boolean(document.querySelector('[data-selection-id="${id}"]'))`)
  }
  const toggle = async label => {
    await evaluate(`Array.from(document.querySelectorAll('.qxsim-switch-row')).find(row=>row.querySelector('span').textContent===${JSON.stringify(label)}).querySelector('input').click()`)
  }
  const number = async (label, value) => {
    await evaluate(`(()=>{const input=Array.from(document.querySelectorAll('.qxsim-field')).find(row=>row.querySelector('.qxsim-field-label')?.textContent===${JSON.stringify(label)}).querySelector('input');input.focus();Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(String(value))});input.dispatchEvent(new Event('input',{bubbles:true}));})()`)
    await evaluate(`document.activeElement.blur()`)
  }
  await select('mask')
  await toggle('开启遮罩')
  await wait(`!document.querySelector('[data-mask-id="mask"]')`)
  await select('inner')
  await toggle('边缘羽化')
  await wait(`!Array.from(document.querySelectorAll('.qxsim-switch-row')).find(row=>row.textContent==='边缘羽化').querySelector('input').checked`)
  await number('imageId', 100002)
  await wait(`document.querySelector('[data-control-id="inner"]').style.borderRadius === '50%' && document.querySelector('[data-mask-id="inner"]').style.maskImage.includes('image')`)
  // Samples avoid the independent selection outline on the mask rectangle.
  pixel = await sample()
  assert.deepEqual(pixel(800, 450), [255, 0, 0, 255])
  assert.deepEqual(pixel(760, 410), [0, 0, 0, 255], 'circle clips the rectangle corner in DOM')
  await toggle('遮罩区域反转')
  await wait(`Array.from(document.querySelectorAll('.qxsim-switch-row')).find(row=>row.textContent==='遮罩区域反转').querySelector('input').checked`)
  pixel = await sample()
  assert.deepEqual(pixel(800, 450), [0, 0, 0, 255])
  assert.deepEqual(pixel(760, 410), [255, 0, 0, 255])
  assert.deepEqual(pixel(730, 450), [0, 0, 0, 255], 'reversed DOM mask still clips outside its rectangle')
  await number('imageId', 100006)
  await wait(`document.querySelector('[data-control-id="inner"]').style.maskImage.includes('radial-gradient')`)
  pixel = await sample()
  assert.deepEqual(pixel(800, 450), [255, 0, 0, 255], 'inverted ring preserves the hole')
  assert.deepEqual(pixel(845, 450), [0, 0, 0, 255], 'inverted ring hides its band')
  await toggle('遮罩区域反转')
  await number('imageId', 101001)
  await wait(`!!document.querySelector('[data-control-id="inner"] canvas[data-image-id="101001"]')`)
  await wait(`document.querySelector('[data-mask-id="inner"]').style.maskImage.includes('image')`)
  pixel = await sample()
  assert.deepEqual(pixel(800, 450), [0, 0, 0, 255], 'remote alpha hole reaches DOM')
  assert.deepEqual(pixel(762, 450), [0, 0, 0, 255], 'default Stretch retains a two-unit border')
  await evaluate(`(()=>{const select=document.querySelector('[aria-label="图片类型"]');select.value='Basic';select.dispatchEvent(new Event('change',{bubbles:true}));})()`)
  await wait(`document.querySelector('[data-control-id="inner"] canvas').dataset.imageType === 'Basic'`)
  pixel = await sample()
  assert.deepEqual(pixel(762, 450), [255, 0, 0, 255], 'Basic alpha border expands with the image')
  const oldMask = await evaluate(`document.querySelector('[data-mask-id="inner"]').style.maskImage`)
  assetContext.fillStyle = '#fff'; assetContext.fillRect(0, 0, 10, 10)
  await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='↻ 重新下载此素材').click()`)
  await wait(`document.querySelector('[data-mask-id="inner"]').style.maskImage !== ${JSON.stringify(oldMask)}`)
  pixel = await sample()
  assert.deepEqual(pixel(800, 450), [255, 0, 0, 255], 'refresh changes coverage without reload')
})
