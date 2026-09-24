import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createStudio, importGia, exportGia } from '../index.js'
import { createDefaultProject, createNode, walk } from '../ui/authoring.js'
import { createProject } from '../ui/project.js'
import { createRectTransform } from '../ui/layout.js'
import { layoutTree } from '../ui/inspector.js'
import { compileControl } from '../play/compile.js'
import { getPlatformTransform } from '../ui/transforms.js'
import { CANVAS_PRESETS, PLATFORMS } from '../constants.js'

const rect = (width, height, x = 0, y = 0) => createRectTransform({ size: [width, height], offset: [x, y] })
const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64')
const child = (studio) => studio.get().root.children[0].children.find(n => n.id === 'n2')
const set = (studio, key, value) => studio.patch({ op: 'set', id: 'n2', key, value })
const geometry = (box) => [box.left, box.bottom, box.width, box.height]

test('four distinct platform layouts survive JSON and both GIA exports without canvas state', () => {
  const s = createStudio()
  const archive = s.archiveData()
  const expected = Object.fromEntries(PLATFORMS.map((p, i) => [p, rect(1280 - i * 100, 720 - i * 50, i * 10, 0 - i * 20)]))
  for (const asset of ['server', 'client']) {
    archive.assets[asset].root.children[0].transformByPlatform = structuredClone(expected)
  }
  const studio = createStudio(archive)
  assert.equal(studio.archiveData().version, 4)
  assert.doesNotMatch(JSON.stringify(studio.archiveData()), /transformByCanvas/)
  const restored = createStudio(JSON.parse(Buffer.from(studio.exportData('save').data, 'base64')))
  assert.deepEqual(restored.archiveData(), studio.archiveData())
  for (const assetType of ['server-control-template', 'client-control-template']) {
    studio.patch({ op: 'selectAsset', assetType })
    for (const format of ['gia', 'combined']) {
      const decoded = importGia(Buffer.from(studio.exportData(format).data, 'base64'))
      const p = assetType === 'client-control-template' && format === 'combined' ? decoded.clientProject : decoded.project
      assert.equal(p.layoutSchemaVersion, 2)
      assert.deepEqual(p.root.children[0].transformByPlatform, expected)
      assert.doesNotMatch(JSON.stringify(p), /transformByCanvas/)
    }
  }
})

test('wide viewport editing keeps the entered position and updates the shared platform only', () => {
  const studio = createStudio()
  set(studio, 'syncAllDevices', false)
  const before = child(studio).transformByPlatform
  studio.patch({ op: 'setCanvas', canvasId: 'pc-21-9' })
  set(studio, 'posX', 1200)
  const map = child(studio).transformByPlatform
  assert.equal(map.KEYBOARD.offset.x, 150)
  for (const platform of PLATFORMS.filter(p => p !== 'KEYBOARD')) assert.deepEqual(map[platform], before[platform])
  const wide = studio.get().boxes.find(b => b.id === 'n2')
  assert.equal(wide.centerX, 1200)
  studio.patch({ op: 'setCanvas', canvasId: 'pc-16-9' })
  assert.equal(studio.get().boxes.find(b => b.id === 'n2').centerX, 950)
  assert.deepEqual(child(studio).transformByPlatform, map)
})

test('all five viewports share supported geometry with GIA round trips, with sync on and off', () => {
  for (const sync of [false, true]) {
    for (const canvasId of Object.keys(CANVAS_PRESETS)) {
      const studio = createStudio()
      studio.patch({ op: 'setCanvas', canvasId })
      set(studio, 'syncAllDevices', sync)
      set(studio, 'anchorType', 'top-left')
      set(studio, 'width', 240)
      set(studio, 'height', 60)
      set(studio, 'posX', 123)
      set(studio, 'posY', 345)
      const node = child(studio)
      const box = studio.get().boxes.find(b => b.id === node.id)
      assert.equal(box.centerX, 123)
      assert.equal(box.centerY, 345)
      assert.equal(box.width, 240)
      assert.equal(box.height, 60)
      const compiled = compileControl(node, canvasId)
      const source = node.transformByPlatform[CANVAS_PRESETS[canvasId].platform]
      assert.equal(compiled.anchoredPositionX, source.offset.x)
      assert.equal(compiled.sizeDeltaX, 240)
      for (const format of ['gia', 'combined']) {
        const project = importGia(Buffer.from(studio.exportData(format).data, 'base64')).project
        const imported = project.root.children[0].children.find(n => n.guid === node.guid)
        for (const viewport of Object.keys(CANVAS_PRESETS)) {
          const before = layoutTree(studio._project.root, viewport).boxes[node.id]
          const after = layoutTree(project.root, viewport).boxes[imported.id]
          geometry(before).forEach((v, i) => assert.ok(Math.abs(v - geometry(after)[i]) < 1e-4, `${sync}/${canvasId}/${viewport}/${format}`))
        }
      }
    }
  }
})

test('sync uses each platform parent including distinct controller geometry', () => {
  const project = createDefaultProject()
  const root = project.root.children[0]
  root.transformByPlatform = {
    KEYBOARD: rect(1000, 800), TOUCHSCREEN: rect(500, 400),
    CONTROLLER_CONSOLE: rect(2000, 1000), CONTROLLER_MOBILE: rect(400, 200),
  }
  const studio = createStudio(project)
  set(studio, 'posX', 1050) // 75% across a 1000-wide parent centered on x=800.
  const map = child(studio).transformByPlatform
  assert.equal(map.KEYBOARD.offset.x, 250)
  assert.equal(map.TOUCHSCREEN.offset.x, 125)
  assert.equal(map.CONTROLLER_CONSOLE.offset.x, 500)
  assert.equal(map.CONTROLLER_MOBILE.offset.x, 100)
  const before = studio.archiveData()
  // Reads, compile, exports and viewport switches must never project again.
  for (let i = 0; i < 3; i++) {
    for (const canvasId of Object.keys(CANVAS_PRESETS)) {
      studio.patch({ op: 'setCanvas', canvasId })
      compileControl(child(studio), canvasId)
      studio.exportData('combined')
      studio.get()
    }
  }
  assert.deepEqual(studio.archiveData().assets.server.root, before.assets.server.root)
})

test('failed cross-platform projection leaves the edit atomic', () => {
  const project = createDefaultProject()
  project.root.children[0].transformByPlatform.CONTROLLER_CONSOLE = rect(0, 0)
  const studio = createStudio(project)
  const before = studio.archiveData()
  assert.throws(() => set(studio, 'posX', 400), /positive size/)
  assert.deepEqual(studio.archiveData(), before)
  set(studio, 'syncAllDevices', false)
  set(studio, 'posX', 400) // Other platforms are irrelevant when sync is off.
  assert.equal(studio.get().boxes.find(b => b.id === 'n2').centerX, 400)
})

test('only the new layout shape is accepted; failed archive imports leave both assets unchanged', () => {
  const studio = createStudio()
  const before = studio.archiveData()
  const invalid = structuredClone(before)
  for (const version of [1, 3, 5]) {
    const otherVersion = { ...before, version }
    assert.throws(() => createStudio(otherVersion), /version=4/)
    assert.throws(() => studio.importData('json', encode(otherVersion)), /version=4/)
    assert.deepEqual(studio.archiveData(), before)
  }
  invalid.assets.server.meta.name = 'must not replace existing server'
  invalid.assets.client.root.children[0].transformByCanvas = { 'pc-16-9': rect(1280, 720) }
  assert.throws(() => studio.importData('json', encode(invalid), 'legacy.json'), /不再支持 transformByCanvas/)
  assert.deepEqual(studio.archiveData(), before)
  assert.throws(() => createStudio(invalid), /不再支持 transformByCanvas/)
  const project = createDefaultProject()
  delete project.layoutSchemaVersion
  assert.throws(() => createProject(project), /layoutSchemaVersion=2/)
  project.layoutSchemaVersion = 999
  assert.throws(() => createProject(project), /layoutSchemaVersion=2/)
  project.layoutSchemaVersion = 2
  delete project.root.children[0].transformByPlatform.TOUCHSCREEN
  assert.throws(() => createProject(project), /TOUCHSCREEN/)
  assert.throws(() => exportGia(project), /TOUCHSCREEN/)
  assert.throws(() => createNode('container', { transformByPlatform: {} }), /KEYBOARD/)
  assert.throws(() => createNode('container', { transformByCanvas: {} }), /不再支持 transformByCanvas/)
})

test('platform reads are copies and every new node carries exactly four finite transforms', () => {
  const project = createDefaultProject()
  walk(project.root, node => {
    assert.deepEqual(Object.keys(node.transformByPlatform), PLATFORMS)
    assert.equal(Object.hasOwn(node, 'transformByCanvas'), false)
  })
  const map = project.root.children[0].transformByPlatform
  getPlatformTransform(map, 'KEYBOARD').size.x = 999
  assert.equal(map.KEYBOARD.size.x, 0)
  map.TOUCHSCREEN.offset.x = NaN
  assert.throws(() => createProject(project), /finite number/)
})

test('GIA decoding retains zero pivot and scale components on all four platforms', () => {
  const project = createDefaultProject()
  const node = project.root.children[0].children[0]
  for (const platform of PLATFORMS) {
    node.transformByPlatform[platform].pivot = { x: 0, y: 0 }
    node.transformByPlatform[platform].scale = { x: 0, y: 1, z: 0 }
  }
  const imported = importGia(exportGia(project).buffer).project.root.children[0].children.find(n => n.guid === node.guid)
  for (const platform of PLATFORMS) {
    assert.deepEqual(imported.transformByPlatform[platform].pivot, { x: 0, y: 0 })
    assert.deepEqual(imported.transformByPlatform[platform].scale, { x: 0, y: 1, z: 0 })
  }
})
