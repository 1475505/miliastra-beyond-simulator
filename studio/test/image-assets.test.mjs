import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { ImageAssetStore } from '../host/image-assets.js'
import { isRemoteImage, imageAssetKey } from '../assets/catalog.js'
import { prefabImageSize } from '../assets/prefab-catalog.js'
import { restoreSprite } from '../assets/raster.js'
import { imagePrimitive } from '../constants.js'
import { flattenScenePaint, renderEditorPng, renderPaintPng, renderScenePng } from '../host-png.js'
import { SimulatorController } from '../host/controller.js'
import { Container, Matrix, Sprite, Texture, CanvasSource } from 'pixi.js'
import { PixiPlayRenderer } from '../play/pixi-renderer.js'
import { createStudio } from '../index.js'
import { createNode } from '../ui/authoring.js'
import { createRectTransform } from '../ui/layout.js'

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

test('image lookup distinguishes primitives, remote assets and unsupported IDs', () => {
  assert.equal(imagePrimitive(100001), 'rect')
  assert.equal(imagePrimitive(100006), 'ring')
  assert.equal(isRemoteImage(100101), true)
  assert.equal(imagePrimitive(101001), 'sprite')
  for (const id of [101019, 105141, 106048, 107008, 107279, 108018, 109035]) {
    assert.equal(imagePrimitive(id, 'StaticReference'), 'sprite')
  }
  for (const id of [0, -1, 100007, 100214, 107021, 107030, 112043, 999999, '100101', 100101.5]) assert.equal(isRemoteImage(id), false)
  for (const source of ['Item', 'Equipment', 'Skill', 'UnitStatus', 'Faction', 'Currency']) {
    assert.equal(imagePrimitive(101019, source), 'missing')
  }
  // Audited 7.2 catalogue samples: harbor buildings, lights, snow and the new
  // creature ranges must resolve without admitting null slots or future IDs.
  for (const id of [20003469, 20003518, 20003564, 20003565, 20003566, 20003664, 20003669, 20003670, 20003674, 30005023, 30006028, 30007014, 30008015]) {
    assert.equal(isRemoteImage(id, 'Prefab'), true)
    assert.equal(prefabImageSize(id), 256)
    assert.equal(isRemoteImage(id, 'StaticReference'), false)
  }
  for (const id of [10003001, 20001075, 20001122, 20001157, 20001303, 20001569, 20002756, 20003675, 30005024, 30006029, 30007015, 30008016]) {
    assert.equal(isRemoteImage(id, 'Prefab'), false)
  }
  assert.equal(prefabImageSize(10003004), 128)
  assert.equal(prefabImageSize(10008001), 128)
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
  await assert.rejects(store.get(107021), /allowlist/)
  assert.equal(requests.length, 2)
  await store.refresh(101001)
  assert.equal(requests.length, 4)
  await writeFile(join(store.directory, '101001.png'), 'broken')
  await store.get(101001)
  assert.equal(requests.length, 5, 'regenerating damaged PNG reuses cached border metadata')
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
  const images = new Map([[imageAssetKey(101001), (await store.get(101001)).image]])
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
  const radial = { ...clipped, fillType: 'Radial360', fillRadialType: 'Bottom', fillAmount: .25 }
  const visible = await decoded(renderPaintPng([radial], 120, 100, { images }).data)
  assert.deepEqual(pixel(visible, 35, 65), [128, 100, 64, 255], 'the bottom-left sector uses the original tint and trim')
  const hidden = await decoded(renderPaintPng([{ ...radial, fillRadialType: 'Top' }], 120, 100, { images }).data)
  assert.deepEqual(pixel(hidden, 35, 65), bg, 'changing only the origin clips the sprite')
})

test('Pixi sprite uses shared texture, tint, fill and parent transform without destroying shared source', t => {
  const renderer = Object.create(PixiPlayRenderer.prototype)
  const texture = new Texture({ source: new CanvasSource({ resource: createCanvas(10, 8) }) })
  renderer.imageTextures = new Map([[imageAssetKey(101001), { texture }]])
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

test('controller screenshots share newly allowlisted static images without substituting them for other Lua sources', async t => {
  const { store, requests } = await setup(t)
  const controller = new SimulatorController('', { imageAssets: store, clockMode: 'manual' })
  t.after(() => controller.dispose())
  controller.patch({ op: 'set', id: 'n9', key: 'imageId', value: 101019 })
  controller.studio.patch({ op: 'addScript', path: 'image-source.lua', controlId: 'n9', controlAsset: 'server-control-template', source: `
function OnStart()
  script.object:SetImage(Enum.ImageSource.Item, 101019)
  assert(script.object.imageType == nil)
  assert(not pcall(function() script.object.imageType = Enum.ImageType.Stretch end))
  script:EnableUpdate(true)
end
function OnUpdate()
  script.object:SetImage(Enum.ImageSource.StaticReference, 101019)
end` })
  const editor = await controller.uiScreenshot()
  assert.deepEqual(editor.assetWarnings, [])
  assert.deepEqual(requests.map(url => new URL(url).pathname).sort(), ['/images/border/101019.json', '/images/sprite/101019.png'])
  const initial = await controller.play('start', { view: true })
  assert.ok(!initial.mountError, initial.mountError)
  const image = initial.scene.nodes.find(node => node.kind === 'image')
  assert.deepEqual([image.imageSource, image.imageId, image.primitive], ['Item', 101019, 'missing'])
  const missing = await controller.playScreenshot()
  assert.equal(requests.length, 2, 'an unsupported source does not fetch the static image even when the ID matches')
  const { scene } = await controller.play('step', { dt: 1 / 30, view: true, sceneRev: initial.scene.revision })
  assert.equal(scene.reset, false)
  assert.deepEqual(scene.changed.map(node => [node.id, node.imageSource, node.imageId, node.primitive]), [[image.id, 'StaticReference', 101019, 'sprite']])
  const play = await controller.playScreenshot()
  assert.deepEqual(play.assetWarnings, [])
  assert.notDeepEqual(play.data, missing.data)
  assert.equal(requests.length, 2)
})

test('IMGGEOM Lua image types round-trip independently of borders, including after SetImage', async t => {
  const ids = [106030, 101019, 100001]
  const archive = createStudio().archiveData()
  const parent = archive.assets.server.root.children[0]
  parent.children = ids.flatMap((id, row) => ['Initial', 'Switched'].map((prefix, col) => {
    const node = createNode('image', { name: `${prefix}${id}`, imageSource: 'StaticReference', imageId: col ? 100002 : id,
      imageType: 'Basic', imageColor: 0xffffffff })
    for (const platform of Object.keys(node.transformByPlatform)) {
      node.transformByPlatform[platform] = createRectTransform({ size: [100, 42], offset: [(col - .5) * 160, (row - 1) * 70] })
    }
    return node
  }))
  archive.assets.scripts = [{ id: 'image-type', path: 'image-type.lua', controlId: parent.id, controlAsset: 'server-control-template', source: `
local ids = {106030, 101019, 100001}
local basic, stretch = Enum.ImageType.Basic, Enum.ImageType.Stretch
local host = script.object
local switched = false
function OnStart()
  for _, id in ipairs(ids) do
    local image = host:GetChild("Initial" .. id)
    assert(image.imageType == basic, "initial " .. id)
    image.imageType = basic
    assert(image.imageType == basic, "Basic round-trip " .. id)
    assert(host:GetChild("Switched" .. id).imageType == basic, "initial circle")
  end
  script:EnableUpdate(true)
end
function OnUpdate()
  for _, id in ipairs(ids) do
    local image = host:GetChild("Switched" .. id)
    if not switched then
      image:SetImage(Enum.ImageSource.StaticReference, id)
      assert(image.imageId == id and image.imageSource == Enum.ImageSource.StaticReference)
      assert(image.imageType == basic, "Basic after SetImage " .. id)
    else
      local initial = host:GetChild("Initial" .. id)
      initial.imageType = stretch
      image.imageType = stretch
      assert(initial.imageType == stretch and image.imageType == stretch, "Stretch round-trip " .. id)
      script:EnableUpdate(false)
    end
  end
  switched = true
end` }]
  const studio = createStudio(archive)
  t.after(() => studio.playStop())
  const start = studio.playStart()
  assert.equal(start.mountError, null)
  const basic = studio.playStep(1 / 60, { view: true })
  const update = studio.playStep(1 / 60, { view: true, sceneRev: basic.scene.revision })
  assert.deepEqual(update.logs.filter(log => log.level === 'lua-error'), [])
  assert.equal(update.scene.reset, false)
  assert.equal(update.scene.changed.length, 6)
  const stretch = studio.playGet({ view: true })
  const basicPaint = flattenScenePaint(basic.scene)
  assert.equal(basicPaint.length, 6)

  // A synthetic two-color sprite with and without an m_Border. The left band
  // occupies 20px when scaled as one image, but stays 2px wide when sliced.
  const sprite = createCanvas(10, 8), ctx = sprite.getContext('2d')
  ctx.fillStyle = '#00ff00'; ctx.fillRect(0, 0, 10, 8)
  ctx.fillStyle = '#ff0000'; ctx.fillRect(0, 0, 2, 8)
  const assets = {
    images: new Map(ids.slice(0, 2).map(id => [imageAssetKey(id), sprite])),
    imageMetadata: new Map([[imageAssetKey(106030), { width: 10, height: 8, border: { left: 2, right: 2, top: 0, bottom: 0 } }],
      [imageAssetKey(101019), { width: 10, height: 8, border: { left: 0, right: 0, top: 0, bottom: 0 } }]]),
  }
  const capture = snapshot => decoded(renderScenePng(snapshot.scene, snapshot.canvasWidth, snapshot.canvasHeight, assets).data)
  const [before, after] = await Promise.all([capture(basic), capture(stretch)])
  for (const item of basicPaint) {
    assert.equal(item.imageType, 'Basic')
    assert.equal(update.scene.changed.find(node => node.id === item.id)?.imageType, 'Stretch')
    const x = item.matrix.tx - 50, y = basic.canvasHeight - item.matrix.ty - 21
    if (item.imageId === 106030) {
      assert.deepEqual(pixel(before, x + 10, y + 20), [255, 0, 0, 255])
      assert.deepEqual(pixel(after, x + 10, y + 20), [0, 255, 0, 255])
    } else {
      const interior = canvas => canvas.getContext('2d').getImageData(x, y, 100, 42).data
      assert.deepEqual(pixel(before, x + 50, y + 20), item.imageId === 100001 ? [255, 255, 255, 255] : [0, 255, 0, 255])
      assert.deepEqual(interior(before), interior(after), `${item.name} accepts Stretch without changing its appearance`)
    }
  }
})

test('the preplaced primitive image capability does not widen the existing template policy', t => {
  const archive = createStudio().archiveData()
  archive.assets.client.root.children = [createNode('image', { guid: 1073742100, imageId: 100001,
    children: [createNode('image', { name: 'Child', imageId: 100001 })] })]
  const studio = createStudio(archive)
  t.after(() => studio.playStop())
  studio.patch({ op: 'addScript', path: 'primitive-template.lua', controlId: archive.assets.server.root.children[0].id,
    controlAsset: 'server-control-template', source: `
function OnStart()
  local root = assert(game.InstantiateClientUIControl(1073742100, script.object))
  for _, image in ipairs({root, assert(root:GetChild("Child"))}) do
    assert(image.imageType == nil)
    assert(not pcall(function() image.imageType = Enum.ImageType.Stretch end))
  end
end` })
  assert.equal(studio.playStart().mountError, null)
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
