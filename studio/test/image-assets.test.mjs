import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { ImageAssetStore } from '../host/image-assets.js'
import { isRemoteImage } from '../assets/catalog.js'
import { restoreSprite } from '../assets/raster.js'
import { imagePrimitive } from '../constants.js'
import { renderEditorPng, renderPaintPng } from '../host-png.js'
import { SimulatorController } from '../host/controller.js'
import { Container, Matrix, Sprite, Texture, CanvasSource } from 'pixi.js'
import { PixiPlayRenderer } from '../play/pixi-renderer.js'

// Independent fixture: a 2x2 colored trim in a 10x8 logical canvas, offset
// (2,1) from the bottom-left. Atlas x/y must never affect standalone PNGs.
export function fixture() {
  const canvas = createCanvas(2, 2)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#80c840'; ctx.fillRect(0, 0, 2, 2)
  return { png: canvas.toBuffer('image/png'), metadata: {
    m_Rect: { width: 10, height: 8 }, m_Border: { X: 0, Y: 0, Z: 0, W: 0 },
    m_RD: { textureRectOffset: { X: 2.05, Y: 1.05 }, textureRect: { x: 345, y: 678, width: 1.95, height: 1.95 }, settingsRaw: { packingRotation: 'None' } },
  } }
}

async function setup(t) {
  const directory = await mkdtemp(join(tmpdir(), 'qxqy-image-test-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const data = fixture(), requests = []
  const fetcher = async url => {
    requests.push(String(url))
    return String(url).endsWith('.png') ? new Response(data.png) : Response.json(data.metadata)
  }
  return { directory, data, requests, fetcher, store: new ImageAssetStore({ cacheDir: directory, fetch: fetcher }) }
}

function pixel(canvas, x, y) { return [...canvas.getContext('2d').getImageData(x, y, 1, 1).data] }
async function decoded(bytes) {
  const image = await loadImage(bytes), canvas = createCanvas(image.width, image.height)
  canvas.getContext('2d').drawImage(image, 0, 0)
  return canvas
}

test('pinned allowlist excludes empty/unknown IDs and preserves all six primitives', () => {
  assert.equal(imagePrimitive(100001), 'rect')
  assert.equal(imagePrimitive(100006), 'ring')
  assert.equal(isRemoteImage(100101), true)
  assert.equal(imagePrimitive(101001), 'sprite')
  for (const id of [0, -1, 100007, 101019, 107008, 999999, '100101', 100101.5]) assert.equal(isRemoteImage(id), false)
  let count = 0
  for (let id = 100000; id <= 112100; id++) if (isRemoteImage(id)) count++
  assert.equal(count, 1516)
})

test('two stores share disk downloads, restart works offline, refresh and corruption regenerate', async t => {
  const { directory, fetcher, requests, store } = await setup(t)
  const second = new ImageAssetStore({ cacheDir: directory, fetch: fetcher })
  const assets = await Promise.all([store.get(101001), store.get(101001), second.get(101001)])
  assert.equal(requests.length, 2, 'one sprite and one metadata download across concurrent stores')
  assert.equal(assets[0].image.width, 10)
  const canvas = await decoded(assets[0].data)
  assert.deepEqual(pixel(canvas, 2, 5), [128, 200, 64, 255])
  assert.deepEqual(pixel(canvas, 2, 1), [0, 0, 0, 0], 'trim offset uses bottom-left, not top-left')
  assert.deepEqual(pixel(canvas, 4, 5), [0, 0, 0, 0])
  const offline = new ImageAssetStore({ cacheDir: directory, fetch: () => { throw new Error('offline') } })
  assert.deepEqual((await offline.get(101001)).data, assets[0].data)
  await assert.rejects(store.get(101019), /allowlist/)
  assert.equal(requests.length, 2)
  await store.refresh(101001)
  assert.equal(requests.length, 4)
  await writeFile(join(store.directory, '101001.png'), 'broken')
  await store.get(101001)
  assert.equal(requests.length, 6)
  store.fetcher = async () => { throw new Error('offline') }
  await assert.rejects(store.refresh(101001), /offline/)
  assert.deepEqual((await store.get(101001)).data, assets[0].data, 'failed refresh preserves good cached bytes')
})

test('failure cooldown, invalid PNG and unsupported packing fail visibly without poisoning cache', async t => {
  const { directory, data } = await setup(t)
  let requests = 0
  const store = new ImageAssetStore({ cacheDir: directory, fetch: async () => { requests++; return new Response('missing', { status: 404 }) } })
  await assert.rejects(store.get(100101), /404/)
  const first = requests
  await assert.rejects(store.get(100101), /404/)
  assert.equal(requests, first)
  store.fetcher = async url => String(url).endsWith('.png') ? new Response('not a PNG') : Response.json(data.metadata)
  await assert.rejects(store.refresh(100101), /Invalid sprite PNG/)
  const image = await loadImage(data.png)
  assert.throws(() => restoreSprite(image, { ...data.metadata, m_RD: { ...data.metadata.m_RD, settingsRaw: { packingRotation: 'Rotate90' } } }, createCanvas), /packing rotation/)
  assert.throws(() => restoreSprite(image, { ...data.metadata, m_Rect: { width: 100000, height: 8 } }, createCanvas), /dimensions/)
})

test('Host paint/editor PNG preserve trim, multiply RGB/alpha and clip fill', async t => {
  const { store } = await setup(t)
  const images = new Map([[101001, (await store.get(101001)).image]])
  const base = { id: 1, kind: 'image', primitive: 'sprite', imageId: 101001, imageColor: 0xffff80ff,
    left: 10, bottom: 10, width: 100, height: 80, sourceWidth: 100, sourceHeight: 80 }
  const a = await decoded(renderPaintPng([base], 120, 100, { images }).data)
  assert.deepEqual(pixel(a, 35, 65), [128, 100, 64, 255])
  const empty = await decoded(renderPaintPng([], 120, 100).data)
  assert.deepEqual(pixel(a, 15, 15), pixel(empty, 15, 15))
  const alpha = await decoded(renderPaintPng([{ ...base, imageColor: 0x80ff80ff }], 120, 100, { images }).data)
  const bg = pixel(empty, 35, 65)
  const expected = [128, 100, 64].map((v, i) => Math.round(v * 128 / 255 + bg[i] * 127 / 255))
  pixel(alpha, 35, 65).slice(0, 3).forEach((v, i) => assert.ok(Math.abs(v - expected[i]) <= 1))
  const clipped = { ...base, enableFill: true, fillType: 'Vertical', fillVerticalType: 'Top', fillAmount: 0.5 }
  const b = await decoded(renderPaintPng([clipped], 120, 100, { images }).data)
  assert.deepEqual(pixel(b, 35, 65), bg)
  const editor = await decoded(renderEditorPng({ canvas: { width: 120, height: 100 }, boxes: [base] }, { images }).data)
  assert.deepEqual(pixel(editor, 35, 65), [128, 100, 64, 255])
})

test('Pixi sprite uses shared texture, tint, fill and parent transform without destroying shared source', t => {
  const renderer = Object.create(PixiPlayRenderer.prototype)
  const texture = new Texture({ source: new CanvasSource({ resource: createCanvas(10, 8) }) })
  renderer.imageTextures = new Map([[101001, { texture }]])
  renderer.scratch = new Matrix()
  renderer.canvasHeight = 100
  const root = new Container(), second = new Container()
  t.after(() => { renderer.clearVisual(root); renderer.clearVisual(second); root.destroy(); second.destroy(); texture.destroy(true) })
  const item = { id: 1, kind: 'image', primitive: 'sprite', imageId: 101001, imageColor: 0x80ff80ff,
    sourceWidth: 100, sourceHeight: 80, matrix: { a: 0, b: 1, c: -1, d: 0, tx: 25, ty: 30 } }
  renderer.updateNode(root, item, { nested: true })
  renderer.updateNode(second, { ...item, id: 2 })
  const sprite = root.__visual.children[0]
  assert.ok(sprite instanceof Sprite)
  assert.equal(sprite.width, 100); assert.equal(sprite.height, 80)
  assert.equal(sprite.tint, 0xff80ff); assert.equal(sprite.alpha, 128 / 255)
  assert.equal(sprite.texture, second.__visual.children[0].texture)
  assert.equal(root.y, -30)
  renderer.updateNode(root, { ...item, fillType: 'Horizontal', fillAmount: 0.5 })
  assert.equal(texture.destroyed, false)
  assert.equal(root.__visual.children.at(-1).mask.width, 50)
  renderer.clearVisual(root)
  assert.equal(texture.destroyed, false)
})

test('controller screenshots prepare remote assets independently of any browser', async t => {
  const { store, requests } = await setup(t)
  const controller = new SimulatorController('', { imageAssets: store })
  t.after(() => controller.dispose())
  controller.patch({ op: 'set', id: 'n9', key: 'imageId', value: 101001 })
  const editor = await controller.uiScreenshot()
  assert.deepEqual(editor.assetWarnings, [])
  assert.equal(requests.length, 2)
  await controller.play('start', { view: true })
  const play = await controller.playScreenshot()
  assert.deepEqual(play.assetWarnings, [])
  assert.equal(requests.length, 2)
})

test('cancelled screenshots do not cancel a shared asset download', async t => {
  const { store, data } = await setup(t)
  let release
  const gate = new Promise(resolve => { release = resolve })
  store.fetcher = async url => {
    await gate
    return String(url).endsWith('.png') ? new Response(data.png) : Response.json(data.metadata)
  }
  const abort = new AbortController()
  const screenshot = store.prepare([{ kind: 'image', imageId: 101001 }], abort.signal)
  const shared = store.get(101001)
  abort.abort(new Error('caller cancelled'))
  await assert.rejects(screenshot, /caller cancelled/)
  release()
  assert.equal((await shared).image.width, 10)
})
