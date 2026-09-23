import { externalRoot, externalFixture, missingFixture } from '../../test/fixtures.mjs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import {
  applyInspectorToTransform,
  canvasBox,
  classifyAnchor,
  computeRect,
  createRectTransform,
  inspectorFromRect,
  setAnchorPreset,
} from '../ui/layout.js'
import { applySyncPolicy, readCurrentTransform, syncTransformMaps } from '../ui/sync.js'
import { createDefaultProject, createNode, walk } from '../ui/authoring.js'
import { hitTest, layoutTree } from '../ui/inspector.js'
import { createProject, snapshotProject } from '../ui/project.js'
import { assignGuids } from '../gia/codec.js'
import { compileProject } from '../play/compile.js'
import { hitPlayControl, paintList, runtimeLayout, runtimeTransforms } from '../play/session.js'
import { createStudio, inspectGia, validateGiaCompatibility, validateServerGiaCompatibility } from '../index.js'
import { createRuntime } from '../../client/lua-runtime/src/index.js'
import { assertNoUndefined } from '../json.js'
import { CANVAS_PRESETS, PLATFORMS } from '../constants.js'

function loadFlappy(studio) {
  const save = JSON.parse(readFileSync(externalFixture('workspace/flappy-fish/flappy-fish.save.json'), 'utf8'))
  studio.importData('json', Buffer.from(JSON.stringify(save)).toString('base64'), 'flappy-fish.save.json')
}

test('fullscreen stretch @1600×900 shows center 800,450 size 1600×900', () => {
  const parent = canvasBox('pc-16-9')
  const rt = createRectTransform({ layout: 'stretch' })
  const box = computeRect(parent, rt)
  const vis = inspectorFromRect(box)
  assert.equal(vis.posX, 800)
  assert.equal(vis.posY, 450)
  assert.equal(vis.width, 1600)
  assert.equal(vis.height, 900)
  assert.equal(rt.offset.x, 0)
  assert.equal(rt.size.x, 0)
})

test('center 100×40 at default offset sits on canvas center', () => {
  const parent = canvasBox('pc-16-9')
  const rt = createRectTransform({ layout: 'center', size: [100, 40] })
  const vis = inspectorFromRect(computeRect(parent, rt))
  assert.equal(vis.posX, 800)
  assert.equal(vis.posY, 450)
  assert.equal(vis.width, 100)
  assert.equal(vis.height, 40)
})

test('authoring preview and selection inherit parent scale while retaining local RectTransform values', () => {
  const root = createNode('container', { id: 'scale-root', isRootContainer: true })
  const child = createNode('image', { id: 'scale-child' })
  root.children.push(child)
  const rootTransform = root.transformByCanvas['pc-16-9']
  rootTransform.scale = { x: 2, y: 0.5, z: 1 }
  const childTransform = child.transformByCanvas['pc-16-9']
  childTransform.offset = { x: 100, y: 50 }
  childTransform.size = { x: 100, y: 100 }

  const { boxes } = layoutTree(root, 'pc-16-9')
  const childBox = boxes['scale-child']
  assert.equal(childBox.left, 850)
  assert.equal(childBox.bottom, 450)
  assert.equal(childBox.width, 100)
  assert.equal(childBox.height, 100)
  assert.equal(childBox.renderLeft, 900)
  assert.equal(childBox.renderBottom, 450)
  assert.equal(childBox.renderWidth, 200)
  assert.equal(childBox.renderHeight, 50)
  assert.equal(hitTest([childBox], 1090, 475), 'scale-child')
  assert.equal(hitTest([childBox], 1110, 475), null)
})

test('sync preserves fluid stretch axes across device canvases', () => {
  const source = createRectTransform({ layout: 'stretch' })
  const maps = syncTransformMaps({
    transformByPlatform: {},
    transformByCanvas: {},
    source,
    canvasId: 'pc-16-9',
    syncAllDevices: true,
  })
  const mobile = computeRect(canvasBox('mobile-16-9'), maps.transformByCanvas['mobile-16-9'])
  assert.equal(mobile.width, 1280)
  assert.equal(mobile.height, 720)
  assert.equal(maps.transformByCanvas['mobile-16-9'].size.x, 0)
  assert.equal(maps.transformByCanvas['mobile-16-9'].size.y, 0)
})

test('one unchanged top-left RectTransform preserves its pixel inset', () => {
  const p16 = canvasBox('pc-16-9')
  let rt = setAnchorPreset(createRectTransform({ layout: 'center', size: [200, 40] }), 'top-left')
  rt = applyInspectorToTransform(p16, rt, { posX: 120, posY: 860, width: 200, height: 40 })
  const vis16 = inspectorFromRect(computeRect(p16, rt))
  assert.ok(Math.abs(vis16.posX - 120) < 1e-4)
  assert.ok(Math.abs(vis16.posY - 860) < 1e-4)
  const p21 = canvasBox('pc-21-9')
  const vis21 = inspectorFromRect(computeRect(p21, rt))
  assert.ok(Math.abs(vis21.posX - 120) < 1e-4, `x ${vis21.posX}`)
  assert.ok(Math.abs(vis21.posY - 860) < 1e-4, `y ${vis21.posY}`)
})

test('sync projects a top-left anchored visual center by screen ratio', () => {
  const sourceParent = canvasBox('pc-16-9')
  let source = setAnchorPreset(createRectTransform({ layout: 'center', size: [200, 40] }), 'top-left')
  source = applyInspectorToTransform(sourceParent, source, { posX: 120, posY: 860, width: 200, height: 40 })
  const maps = syncTransformMaps({
    transformByPlatform: {},
    transformByCanvas: {},
    source,
    canvasId: 'pc-16-9',
    syncAllDevices: true,
  })
  const wide = inspectorFromRect(computeRect(canvasBox('pc-21-9'), maps.transformByCanvas['pc-21-9']))
  const mobile = inspectorFromRect(computeRect(canvasBox('mobile-16-9'), maps.transformByCanvas['mobile-16-9']))
  assert.equal(classifyAnchor(maps.transformByCanvas['pc-21-9']), 'top-left')
  assert.equal(wide.posX, 157.5)
  assert.equal(wide.posY, 860)
  assert.equal(mobile.posX, 96)
  assert.equal(mobile.posY, 688)
})

test('sync on projects position to canonical platform canvas ratios', () => {
  const source = createRectTransform({ layout: 'center', size: [80, 80], offset: [10, 20] })
  const map = applySyncPolicy({
    transformByPlatform: {},
    source,
    canvasId: 'pc-16-9',
    syncAllDevices: true,
  })
  assert.deepEqual(map.KEYBOARD.offset, { x: 10, y: 20 })
  assert.deepEqual(map.CONTROLLER_CONSOLE.offset, { x: 10, y: 20 })
  assert.deepEqual(map.TOUCHSCREEN.offset, { x: 8, y: 16 })
  assert.deepEqual(map.CONTROLLER_MOBILE.offset, { x: 8, y: 16 })
  for (const p of PLATFORMS) assert.deepEqual(map[p].size, { x: 80, y: 80 })
})

test('sync off writes only the current platform slot', () => {
  const initial = applySyncPolicy({
    transformByPlatform: {},
    source: createRectTransform({ layout: 'center', size: [80, 80], offset: [0, 0] }),
    canvasId: 'pc-16-9',
    syncAllDevices: true,
  })
  const next = applySyncPolicy({
    transformByPlatform: initial,
    source: createRectTransform({ layout: 'center', size: [80, 80], offset: [40, 5] }),
    canvasId: 'pc-16-9',
    syncAllDevices: false,
  })
  assert.deepEqual(next.KEYBOARD.offset, { x: 40, y: 5 })
  assert.deepEqual(next.TOUCHSCREEN.offset, { x: 0, y: 0 })
  assert.deepEqual(next.CONTROLLER_CONSOLE.offset, { x: 0, y: 0 })
})

test('inspector pos/size invert then forward within 1e-4', () => {
  const parent = canvasBox('mobile-19.5-9')
  let rt = setAnchorPreset(createRectTransform({ size: [80, 80] }), 'bottom-right')
  const want = { posX: 1400, posY: 80, width: 90, height: 70 }
  rt = applyInspectorToTransform(parent, rt, want)
  const got = inspectorFromRect(computeRect(parent, rt))
  assert.ok(Math.abs(got.posX - want.posX) < 1e-4)
  assert.ok(Math.abs(got.posY - want.posY) < 1e-4)
  assert.ok(Math.abs(got.width - want.width) < 1e-4)
  assert.ok(Math.abs(got.height - want.height) < 1e-4)
})

test('studio.get is lossless JSON: no undefined; container has no text', () => {
  const studio = createStudio()
  const snap = studio.get()
  assertNoUndefined(snap)
  const raw = JSON.stringify(snap)
  assert.equal(raw.includes('undefined'), false)
  const container = snap.root.children[0]
  assert.equal(container.kind, 'container')
  assert.equal(Object.hasOwn(container, 'text'), false)
  assert.equal(typeof container.isolateNavigation, 'boolean')
  const text = container.children.find((c) => c.kind === 'textbox')
  assert.equal(typeof text.text, 'string')
  assert.equal(text.minimumFontSize, 20)
  const button = container.children.find((c) => c.kind === 'button')
  assert.equal(button.clickAudioId, 50888)
})

test('textbox / image / button fields round-trip via patch', () => {
  const studio = createStudio()
  studio.patch({ op: 'select', id: 'n2' })
  studio.patch({ op: 'set', key: 'text', value: 'HELLO' })
  studio.patch({ op: 'set', key: 'fontSize', value: 32 })
  studio.patch({ op: 'set', key: 'adaptiveFontSize', value: true })
  studio.patch({ op: 'set', key: 'fontColor', value: '#FF0000' })
  studio.patch({ op: 'select', id: 'n3' })
  studio.patch({ op: 'set', key: 'imageId', value: 100005 })
  studio.patch({ op: 'set', key: 'enableMask', value: true })
  studio.patch({ op: 'select', id: 'n4' })
  studio.patch({ op: 'set', key: 'interactable', value: false })
  const snap = studio.get()
  const text = snap.root.children[0].children.find((c) => c.id === 'n2')
  assert.equal(text.text, 'HELLO')
  assert.equal(text.fontSize, 32)
  assert.equal(text.adaptiveFontSize, true)
  assert.equal(text.fontColor, 0xffff0000)
  const image = snap.root.children[0].children.find((c) => c.id === 'n3')
  assert.equal(image.imageId, 100005)
  assert.equal(image.enableMask, true)
  const button = snap.root.children[0].children.find((c) => c.id === 'n4')
  assert.equal(button.interactable, false)
})

test('compile GetUICanvasSize matches preset; instantiate stays out of authoring', () => {
  const studio = createStudio()
  studio.patch({ op: 'setCanvas', canvasId: 'mobile-4-3' })
  const compiled = compileProject(studio._project)
  assert.equal(compiled.canvasWidth, 1280)
  assert.equal(compiled.canvasHeight, 960)
  const rt = createRuntime({ canvasWidth: compiled.canvasWidth, canvasHeight: compiled.canvasHeight })
  const root = rt.addRoot(compiled.root)
  rt.registerTemplate(99, { kind: 'textbox', name: 'Dyn', text: 'x' })
  rt.mountScript({
    path: 't',
    control: root,
    source: `
function OnStart()
  local c = game.InstantiateClientUIControl(99, script.object)
  print("dyn", c.name)
end
`,
  })
  assert.match(rt.logs.map((l) => l.text).join('\n'), /dyn\tDyn/)
  assert.equal(studio.get().root.children[0].children.some((c) => c.name === 'Dyn'), false)
  const [w, h] = [rt.canvasWidth, rt.canvasHeight]
  assert.equal(w, 1280)
  assert.equal(h, 960)
})

test('play with pasted lua source logs print', () => {
  const studio = createStudio()
  studio.patch({
    op: 'addScript',
    controlId: 'n1',
    source: `
function OnStart()
  local w, h = game.GetUICanvasSize()
  print("canvas", w, h)
end
`,
    path: 'inline',
  })
  const snap = studio.playStart()
  assert.equal(snap.canvasWidth, 1600)
  assert.equal(snap.canvasHeight, 900)
  assert.match(snap.logs.map((l) => l.text).join('\n'), /canvas\t1600\t900/)
  studio.playStop()
})

test('changing pos on current canvas syncs by parent ratio across five previews', () => {
  const studio = createStudio()
  studio.patch({ op: 'select', id: 'n2' })
  studio.patch({ op: 'set', key: 'posX', value: 200 })
  studio.patch({ op: 'set', key: 'posY', value: 100 })
  const node = studio._project.root.children[0].children.find((c) => c.id === 'n2')
  const kb = readCurrentTransform(node.transformByPlatform, 'pc-16-9', node.transformByCanvas)
  const touch = readCurrentTransform(node.transformByPlatform, 'mobile-16-9', node.transformByCanvas)
  const pcRect = inspectorFromRect(computeRect(canvasBox('pc-16-9'), kb))
  const mobileRect = inspectorFromRect(computeRect(canvasBox('mobile-16-9'), touch))
  assert.equal(pcRect.posX, 200)
  assert.equal(pcRect.posY, 100)
  assert.equal(mobileRect.posX, 160)
  assert.equal(mobileRect.posY, 80)
  assert.equal(mobileRect.width, pcRect.width)
  assert.equal(mobileRect.height, pcRect.height)
})

test('rotation Z follows transform ordering, syncs to every canvas, and compiles into play', () => {
  const studio = createStudio()
  studio.patch({ op: 'select', id: 'n2' })
  studio.patch({ op: 'set', key: 'rotationZ', value: 30 })
  const snap = studio.get()
  const keys = snap.inspector.fields.map((field) => field.key)
  assert.ok(keys.indexOf('width') < keys.indexOf('rotationZ'))
  assert.ok(keys.indexOf('rotationZ') < keys.indexOf('anchorType'))
  assert.equal(snap.boxes.find((box) => box.id === 'n2').rotationZ, 30)
  const node = studio._project.root.children[0].children.find((control) => control.id === 'n2')
  for (const canvasId of Object.keys(CANVAS_PRESETS)) {
    assert.equal(readCurrentTransform(node.transformByPlatform, canvasId, node.transformByCanvas).rotation.z, 30, canvasId)
  }
  const compiled = compileProject(studio._project)
  assert.equal(compiled.root.children.find((control) => control.authoringId === 'n2').localRotationZ, 30)
  const play = studio.playStart({ inspect: true })
  assert.equal(play.tree[0].children.find((control) => control.authoringId === 'n2').localRotationZ, 30)
  studio.playStop()
})

test('add allocates unique ids and every successful patch increments revision', () => {
  const studio = createStudio()
  const v1 = studio.get().version
  const added = studio.patch({ op: 'add', kind: 'textbox', parentId: 'n1', expectedRevision: v1 })
  assert.equal(added.version, v1 + 1)
  const ids = added.tree.map((row) => row.id)
  assert.equal(new Set(ids).size, ids.length)
  assert.equal(added.selectedId, 'n12')
  assert.throws(
    () => studio.patch({ op: 'set', key: 'text', value: 'stale', expectedRevision: v1 }),
    /revision conflict/,
  )
})

test('invalid numeric fields are rejected instead of becoming null', () => {
  const studio = createStudio()
  const before = studio.get()
  assert.throws(() => studio.patch({ op: 'set', key: 'posX', value: 'abc' }), /finite number/)
  const after = studio.get()
  assert.equal(after.version, before.version)
  assert.equal(after.inspector.fields.find((f) => f.key === 'posX').value, 500)
})

test('play snapshot applies Flappy Fish parent rotation to its whale primitives', { skip: missingFixture('workspace/flappy-fish/flappy-fish.save.json') }, () => {
  const studio = createStudio()
  loadFlappy(studio)
  studio.playStart()
  studio.playPointer('click', 800, 450)
  const after = studio.playStep(0.05, { inspect: true, paint: true, view: true })
  const logs = after.logs.map((entry) => entry.text).join('\n')
  assert.match(logs, /flappy-flap/)
  assert.equal((logs.match(/flappy-flap/g) || []).length, 1)

  function find(control, name) {
    if (control.name === name) return control
    for (const child of control.children || []) {
      const found = find(child, name)
      if (found) return found
    }
    return null
  }

  const whale = find(after.tree[0], 'WhaleGirl')
  assert.ok(whale)
  assert.ok(Math.abs(whale.localRotationZ) > 0.001)
  const primitive = whale.children[0]
  const paint = after.paint.find((item) => item.id === primitive.id)
  assert.ok(paint)
  const whaleCenterX = whale.box.left + whale.box.width / 2
  const whaleCenterY = whale.box.bottom + whale.box.height / 2
  const primitiveCenterX = primitive.box.left + primitive.box.width / 2
  const primitiveCenterY = primitive.box.bottom + primitive.box.height / 2
  const radians = whale.localRotationZ * Math.PI / 180
  const expectedCenterX = whaleCenterX
    + (primitiveCenterX - whaleCenterX) * Math.cos(radians)
    - (primitiveCenterY - whaleCenterY) * Math.sin(radians)
  const expectedCenterY = whaleCenterY
    + (primitiveCenterX - whaleCenterX) * Math.sin(radians)
    + (primitiveCenterY - whaleCenterY) * Math.cos(radians)
  assert.ok(Math.abs((paint.left + paint.width / 2) - expectedCenterX) < 1e-6)
  assert.ok(Math.abs((paint.bottom + paint.height / 2) - expectedCenterY) < 1e-6)
  assert.ok(Math.abs(paint.rotationZ - (whale.localRotationZ + primitive.localRotationZ)) < 1e-6)
  studio.playStop()
})

test('play view scene patches only the rotating whale parent instead of every primitive', { skip: missingFixture('workspace/flappy-fish/flappy-fish.save.json') }, () => {
  const studio = createStudio()
  loadFlappy(studio)
  const first = studio.playStart({ view: true })
  assert.equal(first.scene.format, 'tree-v1')
  assert.equal(first.scene.reset, true)
  assert.ok(first.scene.count > 1000)
  const whaleNode = first.scene.nodes.find((node) => node.name === 'WhaleGirl')
  assert.ok(whaleNode)
  assert.equal(whaleNode.group, true)
  const childCount = first.scene.nodes.filter((node) => node.parent === whaleNode.id).length
  assert.ok(childCount > 1000)

  studio.playPointer('click', 800, 450)
  const after = studio.playStep(0.05, { view: true, sceneRev: first.scene.revision })
  assert.equal(after.scene.reset, false)
  assert.ok(after.scene.changed.length < 40, `expected a small patch, got ${after.scene.changed.length}`)
  assert.ok(after.scene.changed.some((node) => node.name === 'WhaleGirl'))
  assert.equal(after.scene.changed.filter((node) => node.parent === whaleNode.id).length, 0)
  studio.playStop()
})

test('play inherits a parent localScale for child paint and pointer hit testing without mutating child localScale', () => {
  const runtime = createRuntime({ canvasWidth: 1600, canvasHeight: 900 })
  const root = runtime.addRoot({
    active: true,
    kind: 'container',
    name: 'ScaleRoot',
    anchorMinX: 0,
    anchorMinY: 0,
    anchorMaxX: 1,
    anchorMaxY: 1,
    pivotX: 0.5,
    pivotY: 0.5,
    localScaleX: 2,
    localScaleY: 0.5,
    children: [
      {
        kind: 'image',
        name: 'Visual',
        active: true,
        anchorMinX: 0.5,
        anchorMinY: 0.5,
        anchorMaxX: 0.5,
        anchorMaxY: 0.5,
        anchoredPositionX: 100,
        anchoredPositionY: 50,
        sizeDeltaX: 100,
        sizeDeltaY: 100,
        pivotX: 0.5,
        pivotY: 0.5,
        imageId: 100001,
      },
      {
        kind: 'cursor',
        name: 'Hit',
        active: true,
        anchorMinX: 0.5,
        anchorMinY: 0.5,
        anchorMaxX: 0.5,
        anchorMaxY: 0.5,
        anchoredPositionX: 100,
        anchoredPositionY: 50,
        sizeDeltaX: 100,
        sizeDeltaY: 100,
        pivotX: 0.5,
        pivotY: 0.5,
      },
    ],
  })
  const session = { runtime }
  const visual = root.children[0]
  const hit = root.children[1]
  const boxes = runtimeLayout(session)
  const transforms = runtimeTransforms(session, boxes)
  const paint = paintList(session, boxes).find((item) => item.id === visual.Id)

  // RectTransform layout values stay local; inherited scale exists only in
  // the final world transform, matching the device observation.
  assert.equal(visual.localScaleX, 1)
  assert.equal(visual.localScaleY, 1)
  assert.equal(boxes.get(visual.Id).width, 100)
  assert.equal(boxes.get(visual.Id).height, 100)
  assert.equal(transforms.get(visual.Id).a, 2)
  assert.equal(transforms.get(visual.Id).d, 0.5)
  assert.equal(paint.width, 200)
  assert.equal(paint.height, 50)
  assert.equal(paint.left, 900)
  assert.equal(paint.bottom, 450)

  // (1090, 475) is inside only the scaled child rectangle. It would miss the
  // old unscaled box whose right edge is 950.
  assert.equal(hitPlayControl(session, 1090, 475), hit)
  assert.equal(hitPlayControl(session, 1110, 475), null)
})

test('play view paint lists later siblings first so earlier siblings cover them', { skip: missingFixture('workspace/flappy-fish/flappy-fish.save.json') }, () => {
  const studio = createStudio()
  loadFlappy(studio)
  const snap = studio.playStart({ paint: true })
  const names = (snap.paint || []).map((item) => item.name)
  assert.ok(names.includes('Sky'))
  assert.ok(names.indexOf('Sky') < names.indexOf('ScoreText'))
  studio.playStop()
})

test('play pointer ignores decorative images and containers so a back-layer tap area still receives clicks', { skip: missingFixture('workspace/flappy-fish/flappy-fish.save.json') }, () => {
  const studio = createStudio()
  loadFlappy(studio)
  studio.playStart()
  const after = studio.playPointer('click', 800, 450)
  const logs = after.logs.map((entry) => entry.text).join('\n')
  assert.match(logs, /flappy-flap|flappy-play|flappy-ready/)
  studio.playStop()
})

test('later play roots cover earlier roots for pointer hits', () => {
  const runtime = createRuntime({ canvasWidth: 1600, canvasHeight: 900 })
  const back = runtime.addRoot({
    active: true,
    kind: 'cursor',
    name: 'BackRoot',
    anchorMinX: 0,
    anchorMinY: 0,
    anchorMaxX: 1,
    anchorMaxY: 1,
    sizeDeltaX: 0,
    sizeDeltaY: 0,
    pivotX: 0.5,
    pivotY: 0.5,
  })
  const front = runtime.addRoot({
    active: true,
    kind: 'cursor',
    name: 'FrontRoot',
    anchorMinX: 0,
    anchorMinY: 0,
    anchorMaxX: 1,
    anchorMaxY: 1,
    sizeDeltaX: 0,
    sizeDeltaY: 0,
    pivotX: 0.5,
    pivotY: 0.5,
  })
  const session = { runtime }
  assert.equal(hitPlayControl(session, 800, 450), front)
  assert.notEqual(hitPlayControl(session, 800, 450), back)
})

test('play pointer hits earlier siblings before a later full-screen tap area', () => {
  const studio = createStudio()
  studio.patch({ op: 'set', id: 'n3', key: 'anchorType', value: 'stretch' })
  studio.patch({ op: 'set', id: 'n3', key: 'posX', value: 800 })
  studio.patch({ op: 'set', id: 'n3', key: 'posY', value: 450 })
  studio.patch({ op: 'set', id: 'n3', key: 'width', value: 1600 })
  studio.patch({ op: 'set', id: 'n3', key: 'height', value: 900 })
  const front = studio.patch({ op: 'add', kind: 'cursor', parentId: 'n1', name: 'FrontTap' })
  studio.patch({ op: 'set', id: front.selectedId, key: 'anchorType', value: 'stretch' })
  studio.patch({ op: 'set', id: front.selectedId, key: 'posX', value: 800 })
  studio.patch({ op: 'set', id: front.selectedId, key: 'posY', value: 450 })
  studio.patch({ op: 'set', id: front.selectedId, key: 'width', value: 1600 })
  studio.patch({ op: 'set', id: front.selectedId, key: 'height', value: 900 })
  studio.patch({
    op: 'addScript',
    controlId: 'n1',
    path: 'inline',
    source: `
function OnStart()
  script.object.showCursor = true
  local back = script.object:FindChild("光标检测区域")
  back:AddCursorEventListener(Enum.CursorEventType.CursorClick, function()
    print("tap-back")
  end)
  local front = script.object:FindChild("FrontTap")
  front:AddCursorEventListener(Enum.CursorEventType.CursorClick, function()
    print("tap-front")
  end)
end
`,
  })
  studio.playStart()
  const after = studio.playPointer('click', 80, 80)
  const logs = after.logs.map((entry) => entry.text).join('\n')
  assert.match(logs, /tap-back/)
  assert.doesNotMatch(logs, /tap-front/)
  studio.playStop()
})

test('play pointer does not reach a cursor nested under an image', () => {
  const studio = createStudio()
  const panel = studio.patch({ op: 'add', kind: 'image', parentId: 'n1', name: 'Panel' })
  studio.patch({ op: 'set', id: panel.selectedId, key: 'width', value: 400 })
  studio.patch({ op: 'set', id: panel.selectedId, key: 'height', value: 300 })
  studio.patch({ op: 'add', kind: 'cursor', parentId: panel.selectedId, name: 'NestedHit' })
  studio.patch({
    op: 'addScript',
    controlId: 'n1',
    path: 'inline',
    source: `
function OnStart()
  script.object.showCursor = true
  local hit = script.object:FindChild("NestedHit")
  hit:AddCursorEventListener(Enum.CursorEventType.CursorClick, function()
    print("nested-hit")
  end)
end
`,
  })
  studio.playStart()
  const after = studio.playPointer('click', 800, 450)
  assert.doesNotMatch(after.logs.map((entry) => entry.text).join('\n'), /nested-hit/)
  studio.playStop()
})

test('image and pressed-button fields survive compile and pointer play', () => {
  const studio = createStudio()
  studio.patch({ op: 'select', id: 'n9' })
  studio.patch({ op: 'set', key: 'enableMask', value: true })
  studio.patch({ op: 'set', key: 'enableSoftEdge', value: true })
  studio.patch({ op: 'set', key: 'enableFill', value: true })
  studio.patch({ op: 'set', key: 'reverseMaskArea', value: true })
  studio.patch({ op: 'set', key: 'visible', value: false })
  studio.patch({ op: 'select', id: 'n6' })
  const pressed = studio.patch({ op: 'add', kind: 'image', parentId: 'n6', name: '按下态' })
  studio.patch({ op: 'set', id: 'n6', key: 'pressedChildId', value: pressed.selectedId })
  studio.patch({
    op: 'addScript',
    controlId: 'n1',
    path: 'inline',
    source: `
function OnStart()
  script.object.showCursor = true
  local button = script.object:FindChild("预设按钮")
  button:AddCursorEventListener(Enum.CursorEventType.CursorClick, function()
    print("button-clicked")
  end)
end
`,
  })
  const compiled = compileProject(studio._project)
  const image = compiled.root.children.find((node) => node.authoringId === 'n9')
  const button = compiled.root.children.find((node) => node.authoringId === 'n6')
  assert.equal(image.enableMask, true)
  assert.equal(image.enableSoftEdge, true)
  assert.equal(image.enableFill, true)
  assert.equal(image.reverseMaskArea, true)
  assert.equal(image.fillAmount, 1)
  assert.equal(button.pressedChildId, pressed.selectedId)
  studio.playStart()
  studio.playPointer('down', 800, 450)
  const down = studio.playGet({ inspect: true })
  const downButton = down.tree[0].children.find((node) => node.authoringId === 'n6')
  assert.equal(downButton.pressed, true)
  assert.equal(downButton.children.find((node) => node.authoringId === pressed.selectedId).visible, true)
  studio.playPointer('up', 800, 450)
  const up = studio.playGet({ inspect: true })
  const upButton = up.tree[0].children.find((node) => node.authoringId === 'n6')
  assert.equal(upButton.pressed, false)
  assert.equal(upButton.children.find((node) => node.authoringId === pressed.selectedId).visible, false)
  assert.match(up.logs.map((entry) => entry.text).join('\n'), /button-clicked/)
  studio.playStop()
})

test('preset button resolves unavailable, hover, pressed and selected child states', () => {
  const studio = createStudio()
  const stateIds = {}
  for (const [key, name] of [
    ['unavailableChildId', '不可用态'],
    ['hoverChildId', '悬停态'],
    ['pressedChildId', '按下态'],
    ['selectedChildId', '选中态'],
  ]) {
    const added = studio.patch({ op: 'add', kind: 'image', parentId: 'n6', name })
    stateIds[key] = added.selectedId
    studio.patch({ op: 'set', id: 'n6', key, value: added.selectedId })
  }
  const visibleState = () => {
    const snapshot = studio.playGet({ inspect: true })
    const button = snapshot.tree[0].children.find((node) => node.authoringId === 'n6')
    return button.children.filter((child) => child.visible).map((child) => child.authoringId)
  }
  studio.playStart()
  assert.deepEqual(visibleState(), [])
  studio.playPointer('move', 800, 450)
  assert.deepEqual(visibleState(), [stateIds.hoverChildId])
  studio.playPointer('down', 800, 450)
  assert.deepEqual(visibleState(), [stateIds.pressedChildId])
  studio.playPointer('up', 800, 450)
  assert.deepEqual(visibleState(), [stateIds.hoverChildId])
  studio.playPointer('move', 10, 10)
  assert.deepEqual(visibleState(), [stateIds.selectedChildId])
  studio.playStop()
  studio.patch({ op: 'set', id: 'n6', key: 'interactable', value: false })
  studio.playStart()
  assert.deepEqual(visibleState(), [stateIds.unavailableChildId])
  studio.playStop()
})

test('classify stretch vs center', () => {
  assert.equal(classifyAnchor(createRectTransform({ layout: 'stretch' })), 'stretch')
  assert.equal(classifyAnchor(createRectTransform({ layout: 'center' })), 'center')
})

test('replace + snapshot selected inspector exists', () => {
  const p = createProject(createDefaultProject())
  const snap = snapshotProject(p)
  assert.equal(snap.inspector.kind, 'textbox')
  assert.ok(snap.inspector.fields.some((f) => f.key === 'text'))
})

test('inspector exposes labeled enum options and native-color field metadata', () => {
  const studio = createStudio()
  const snap = studio.get()
  const fields = Object.fromEntries(snap.inspector.fields.map((field) => [field.key, field]))
  assert.equal(fields.anchorType.type, 'enum')
  assert.deepEqual(fields.anchorType.options.find((option) => option.value === 'center'), {
    value: 'center',
    label: '居中',
  })
  assert.equal(fields.horizontalAlignment.options.find((option) => option.value === 'Left').label, '左对齐')
  assert.equal(fields.fontColor.type, 'color')
  assert.equal(fields.bgColor.type, 'color')
  assert.equal(fields.outlineColor.type, 'color')
  assertNoUndefined(snap)
})

test('pick hits the centered preset button when the covering first sibling stays in place', () => {
  const studio = createStudio()
  studio.patch({ op: 'set', id: 'n11', key: 'visible', value: false })
  const after = studio.patch({ op: 'pick', x: 800, y: 450 })
  assert.equal(after.selectedId, 'n6')
})

test('earlier siblings paint over later siblings so a full-screen last child sits under the stage', () => {
  const studio = createStudio()
  const snap = studio.get()
  const names = snap.boxes.filter((box) => box.kind !== 'container' && box.kind !== 'server-container').map((box) => box.name)
  assert.equal(names[0], '全屏动效')
  assert.equal(names.at(-1), '文本框')
  const painted = studio.patch({ op: 'pick', x: 500, y: 700 })
  assert.notEqual(painted.selectedId, 'n11')
})

test('all eleven client control types are authorable without exposing protocol fields', () => {
  const studio = createStudio()
  const snap = studio.get()
  const kinds = snap.tree.filter((row) => row.kind !== 'server-container').map((row) => row.kind)
  assert.deepEqual(kinds, ['container', 'textbox', 'cursor', 'reference', 'grid', 'button', 'textwindow', 'keyhint', 'image', 'animation', 'fullscreen'])
  studio.patch({ op: 'select', id: 'n5' })
  const grid = studio.get().inspector.fields
  assert.equal(grid.find((field) => field.key === 'cellSizeX').evidence, 'W')
  assert.equal(grid.find((field) => field.key === 'previewCount').label, '预览数量')
  assert.equal(grid.some((field) => field.key.startsWith('giaRaw.')), false)
  assert.equal(grid.some((field) => field.raw || field.wire || field.key === 'protocolNote'), false)
  studio.patch({ op: 'select', id: 'n1' })
  assert.equal(studio.get().inspector.fields.find((field) => field.key === 'isolateNavigation').label, '隔离手柄导航')
})

test('business fields edit GIA slots while unknown values remain hidden and lossless', () => {
  const source = createStudio()
  source.patch({ op: 'set', id: 'n10', key: 'animationId', value: 'effect-index-1007' })
  source.patch({ op: 'set', id: 'n4', key: 'referencedPrefabId', value: 'template-index-2008' })
  source.patch({ op: 'set', id: 'n5', key: 'previewCount', value: 12 })
  source.patch({ op: 'set', id: 'n10', key: 'giaRaw.genericField501', value: 37 })
  source.patch({ op: 'set', id: 'n10', key: 'giaRaw.footerField505', value: 91 })
  source.patch({ op: 'set', id: 'n5', key: 'giaRaw.gridField507', value: 17 })
  source.patch({ op: 'set', id: 'n8', key: 'giaRaw.keyHintField502', value: 23 })
  source.patch({ op: 'set', id: 'n9', key: 'fillType', value: 'Radial90' })
  source.patch({ op: 'set', id: 'n2', key: 'giaRaw.textAlign', value: 9 })

  source.patch({ op: 'select', id: 'n10' })
  const effectInspector = source.get().inspector.fields
  const effectField = effectInspector.find((field) => field.key === 'animationId')
  assert.equal(effectField.label, '动效索引')
  assert.equal(effectField.value, 'effect-index-1007')
  assert.equal(effectField.type, 'string')
  assert.equal(effectInspector.some((field) => field.key.startsWith('giaRaw.') || field.raw || field.wire), false)

  const exported = source.exportData('gia')
  const target = createStudio()
  target.importData('gia', exported.data, exported.filename)
  const nodes = new Map()
  walk(target._project.root, (node) => nodes.set(node.kind, node))
  assert.equal(nodes.get('animation').animationId, 'effect-index-1007')
  assert.equal(nodes.get('animation').giaRaw.effectSlot, 'effect-index-1007')
  assert.equal(nodes.get('reference').referencedPrefabId, 'template-index-2008')
  assert.equal(nodes.get('grid').previewCount, 12)
  assert.equal(nodes.get('animation').giaRaw.genericField501, 37)
  assert.equal(nodes.get('animation').giaRaw.footerField505, 91)
  assert.equal(nodes.get('grid').giaRaw.gridField507, 17)
  assert.equal(nodes.get('keyhint').giaRaw.keyHintField502, 23)
  assert.equal(nodes.get('image').giaRaw.imageFillType, 3)
  assert.equal(nodes.get('textbox').giaRaw.textAlign, 9)

  const exportedAgain = target.exportData('gia')
  const verify = createStudio()
  verify.importData('gia', exportedAgain.data, exportedAgain.filename)
  const verifiedNodes = new Map()
  walk(verify._project.root, (node) => verifiedNodes.set(node.kind, node))
  assert.equal(verifiedNodes.get('animation').animationId, 'effect-index-1007')
  assert.equal(verifiedNodes.get('reference').referencedPrefabId, 'template-index-2008')
  assert.equal(verifiedNodes.get('grid').previewCount, 12)
  assert.equal(verifiedNodes.get('grid').giaRaw.gridField507, 17)
  assert.equal(verifiedNodes.get('image').giaRaw.imageFillType, 3)
  assert.equal(verifiedNodes.get('textbox').giaRaw.textAlign, 9)
})

test('JSON and GIA export-import round-trip supported control kinds in-process', () => {
  const studio = createStudio()
  const gia = studio.exportData('gia')
  const bytes = Buffer.from(gia.data, 'base64')
  assert.deepEqual(inspectGia(bytes), {
    gameVersion: '7.0.50', graphName: '客户端控件容器', accessories: 11,
    assetType: 'server-control-template', templateCount: 0,
  })
  const imported = studio.importData('gia', gia.data, 'round-trip.gia')
  assert.equal(imported.snapshot.meta.name, 'round-trip')
  assert.equal(imported.snapshot.tree.some((row) => row.kind === 'grid'), true)
  assert.equal(imported.snapshot.tree.some((row) => row.kind === 'fullscreen'), true)
  assertNoUndefined(imported.snapshot)
  const json = studio.exportData('json')
  const fromJson = studio.importData('json', json.data, 'authoring.json')
  assert.equal(fromJson.snapshot.meta.name, 'authoring')
})

test('server client-control container validates the three-level graph and emits no external relations', { skip: missingFixture('knowledge/ui/template/服务端控件模板-客户端控件容器.gia') }, () => {
  const fixture = readFileSync(externalFixture('knowledge/ui/template/服务端控件模板-客户端控件容器.gia'))
  const fixtureCompatibility = validateServerGiaCompatibility(fixture)
  assert.equal(fixtureCompatibility.valid, true, fixtureCompatibility.errors.join('\n'))
  assert.equal(fixtureCompatibility.accessoryCount, 12)
  assert.equal(fixtureCompatibility.controls[0].kind, 'container')

  const studio = createStudio()
  Object.assign(studio._project.meta, {
    gameVersion: '7.0.50', giaOwnerUid: 114514, giaTimestamp: 1787410000,
    giaFileId: 1073741860, giaFileName: 'qxqy-server-client-control-container.gia',
  })
  const exported = studio.exportData('gia')
  const compatibility = validateServerGiaCompatibility(Buffer.from(exported.data, 'base64'))
  assert.equal(compatibility.valid, true, compatibility.errors.join('\n'))
  assert.equal(compatibility.accessoryCount, 11)
  assert.deepEqual(compatibility.graph.relatedGuids, [])
  assert.equal(compatibility.controls.every((control) => control.id === compatibility.graph.rootGuid || control.parent > 0), true)
  assert.deepEqual(compatibility.explicitEmpty, { field17: 22, rectField508: 48 })
})

test('updated GIA fixture imports textbox, image and all preset-button state fields', { skip: missingFixture('knowledge/ui/template/gia_test.gia') }, () => {
  const studio = createStudio()
  const bytes = readFileSync(externalFixture('knowledge/ui/template/gia_test.gia'))
  const imported = studio.importData('gia', bytes.toString('base64'), 'gia_test.gia')
  const nodes = []
  const collect = (node) => {
    nodes.push(node)
    for (const child of node.children || []) collect(child)
  }
  collect(studio._project.root)

  assert.deepEqual(inspectGia(bytes), {
    gameVersion: '7.0.51', graphName: '文本框', accessories: 1,
    assetType: 'client-control-template', templateCount: 3,
  })
  assert.equal(imported.snapshot.tree.filter((row) => row.kind === 'textbox').length, 1)
  assert.equal(imported.snapshot.tree.filter((row) => row.kind === 'button').length, 1)
  assert.equal(imported.snapshot.tree.filter((row) => row.kind === 'image').length, 2)

  const textbox = nodes.find((node) => node.kind === 'textbox')
  assert.equal(textbox.adaptiveFontSize, false)
  assert.equal(textbox.minimumFontSize, 10)
  assert.equal(textbox.enableOutline, true)
  assert.equal(textbox.horizontalAlignment, 'Right')

  const button = nodes.find((node) => node.kind === 'button')
  assert.equal(button.interactable, false)
  assert.equal(button.raycastTarget, true)
  assert.equal(button.clickAudioId, 50888)
  assert.ok(button.pressedChildId)
  assert.equal(button.unavailableChildId, button.pressedChildId)
  assert.equal(button.hoverChildId, button.pressedChildId)
  assert.equal(button.selectedChildId, button.pressedChildId)

  const mainImage = nodes.find((node) => node.kind === 'image' && node.name === '图片')
  assert.equal(mainImage.imageId, 100006)
  assert.equal(mainImage.enableMask, true)
  assert.equal(mainImage.enableSoftEdge, true)
  assert.equal(mainImage.softEdgeMode, 'Percentage')
  assert.equal(mainImage.enableFill, true)
  assert.equal(mainImage.fillType, 'Radial180')
  assert.equal(mainImage.reverseMaskArea, false)

  const stateImage = nodes.find((node) => node.id === button.pressedChildId)
  assert.equal(stateImage.imageId, 107075)
  assert.equal(stateImage.softEdgeMode, 'Pixel')
  assert.equal(stateImage.fillType, 'Horizontal')
  assert.equal(stateImage.reverseMaskArea, true)
  assertNoUndefined(imported.snapshot)
})

test('updated textbox, image and four-state button settings survive GIA export-import', () => {
  const source = createStudio()
  source.patch({ op: 'set', id: 'n2', key: 'adaptiveFontSize', value: true })
  source.patch({ op: 'set', id: 'n2', key: 'enableOutline', value: false })
  source.patch({ op: 'set', id: 'n2', key: 'horizontalAlignment', value: 'Middle' })
  source.patch({ op: 'set', id: 'n9', key: 'enableMask', value: true })
  source.patch({ op: 'set', id: 'n9', key: 'enableSoftEdge', value: true })
  source.patch({ op: 'set', id: 'n9', key: 'softEdgeMode', value: 'Pixel' })
  source.patch({ op: 'set', id: 'n9', key: 'enableFill', value: true })
  source.patch({ op: 'set', id: 'n9', key: 'fillType', value: 'Radial180' })
  source.patch({ op: 'set', id: 'n9', key: 'reverseMaskArea', value: true })
  source.patch({ op: 'set', id: 'n6', key: 'interactable', value: false })
  source.patch({ op: 'set', id: 'n6', key: 'raycastTarget', value: false })
  for (const [key, name] of [
    ['unavailableChildId', '导出不可用态'],
    ['hoverChildId', '导出悬停态'],
    ['pressedChildId', '导出按下态'],
    ['selectedChildId', '导出选中态'],
  ]) {
    const added = source.patch({ op: 'add', kind: 'image', parentId: 'n6', name })
    source.patch({ op: 'set', id: 'n6', key, value: added.selectedId })
  }

  const gia = source.exportData('gia')
  const target = createStudio()
  target.importData('gia', gia.data, 'updated-fields.gia')
  const nodes = []
  walk(target._project.root, (node) => nodes.push(node))
  const textbox = nodes.find((node) => node.kind === 'textbox')
  assert.equal(textbox.adaptiveFontSize, true)
  assert.equal(textbox.enableOutline, false)
  assert.equal(textbox.horizontalAlignment, 'Middle')
  const image = nodes.find((node) => node.kind === 'image' && node.name === '图片')
  assert.equal(image.enableMask, true)
  assert.equal(image.enableSoftEdge, true)
  assert.equal(image.softEdgeMode, 'Pixel')
  assert.equal(image.enableFill, true)
  assert.equal(image.fillType, 'Radial180')
  assert.equal(image.reverseMaskArea, true)
  const button = nodes.find((node) => node.kind === 'button')
  assert.equal(button.interactable, false)
  assert.equal(button.raycastTarget, false)
  for (const key of ['unavailableChildId', 'hoverChildId', 'pressedChildId', 'selectedChildId']) {
    assert.ok(button[key], key)
    assert.equal(button.children.some((child) => child.id === button[key]), true)
  }
  assertNoUndefined(target.get())
})

test('server GIA writes image fill color and reverses sibling order to match official samples', () => {
  const studio = createStudio()
  studio.patch({ op: 'set', id: 'n9', key: 'imageColor', value: 0xff5cb0d6 })
  const before = studio.get().root.children[0].children.map((node) => node.name)
  assert.deepEqual(before[0], '文本框')
  assert.deepEqual(before.at(-1), '全屏动效')

  const exported = studio.exportData('gia')
  const compatibility = validateServerGiaCompatibility(Buffer.from(exported.data, 'base64'))
  assert.equal(compatibility.valid, true, compatibility.errors.join('\n'))
  assert.deepEqual(compatibility.controls[0].children.map((guid) => {
    return compatibility.controls.find((control) => control.id === guid)?.kind
  }), ['fullscreen', 'animation', 'image', 'keyhint', 'textwindow', 'button', 'grid', 'reference', 'cursor', 'textbox'])

  const target = createStudio()
  target.importData('gia', exported.data, 'color-order.gia')
  const after = []
  walk(target._project.root, (node, parent) => {
    if (parent?.kind === 'container' && parent.name === '容器节点') after.push(node.name)
  })
  assert.deepEqual(after, before)
  const image = []
  walk(target._project.root, (node) => { if (node.kind === 'image') image.push(node) })
  assert.equal(image[0].imageColor >>> 0, 0xff5cb0d6)
})

test('official default server container imports editor-facing sibling order', { skip: missingFixture('knowledge/ui/template/服务端控件模板-客户端控件容器.gia') }, () => {
  const fixture = readFileSync(externalFixture('knowledge/ui/template/服务端控件模板-客户端控件容器.gia'))
  const studio = createStudio()
  studio.importData('gia', fixture.toString('base64'), '官方默认容器.gia')
  const names = studio.get().root.children[0].children.map((node) => node.name)
  assert.deepEqual(names, ['容器节点', '文本框', '光标检测区域', '模板引用控件', '网格视窗', '预设按钮', '文本视窗', '按键提示', '图片', '界面动效', '全屏动效'])
})

test('five canvas presets report GetUICanvasSize-matching sizes', () => {
  const studio = createStudio()
  const expect = {
    'pc-16-9': [1600, 900],
    'pc-21-9': [2100, 900],
    'mobile-16-9': [1280, 720],
    'mobile-19.5-9': [1560, 720],
    'mobile-4-3': [1280, 960],
  }
  for (const [id, wh] of Object.entries(expect)) {
    studio.patch({ op: 'setCanvas', canvasId: id })
    const compiled = compileProject(studio._project)
    assert.equal(compiled.canvasWidth, wh[0], id)
    assert.equal(compiled.canvasHeight, wh[1], id)
    assert.equal(studio.get().canvas.width, wh[0])
    assert.equal(studio.get().canvas.height, wh[1])
  }
})

test('client control template list imports as top-level templates and exports UIControlTemplate graphs', { skip: missingFixture('knowledge/ui/template/客户端控件模板列表.gia') }, () => {
  const studio = createStudio()
  const fixture = readFileSync(externalFixture('knowledge/ui/template/客户端控件模板列表.gia'))
  const fixtureCompatibility = validateGiaCompatibility(fixture)
  assert.equal(fixtureCompatibility.valid, true, fixtureCompatibility.errors.join('\n'))
  const imported = studio.importData('gia', fixture.toString('base64'), '客户端控件模板列表.gia')
  assert.equal(imported.snapshot.asset.type, 'client-control-template')
  assert.equal(imported.snapshot.asset.templateCount, 11)
  assert.equal(imported.snapshot.tree.length, 11)
  assert.equal(imported.snapshot.tree.every((row) => row.depth === 0), true)
  assert.equal(imported.snapshot.root.children.length, 11)

  const exported = studio.exportData('gia')
  assert.equal(exported.filename, '未命名存档 · 客户端控件模板.gia')
  const exportedCompatibility = validateGiaCompatibility(Buffer.from(exported.data, 'base64'))
  assert.equal(exportedCompatibility.valid, true, exportedCompatibility.errors.join('\n'))
  assert.deepEqual(exportedCompatibility.templates.map((item) => item.relatedGuids[0]), [
    1073741845, 1073741846, 1073741847, 1073741848, 1073741849, 1073741850,
    1073741851, 1073741852, 1073741853, 1073741854, 1073741855,
  ])
  const details = inspectGia(Buffer.from(exported.data, 'base64'))
  assert.deepEqual(details, {
    gameVersion: '7.0.50', graphName: '容器节点', accessories: 0,
    assetType: 'client-control-template', templateCount: 11,
  })
  const target = createStudio()
  const roundTrip = target.importData('gia', exported.data, exported.filename)
  assert.equal(roundTrip.snapshot.asset.templateCount, 11)
  assert.equal(roundTrip.snapshot.root.children.length, 11)
  assertNoUndefined(roundTrip.snapshot)
})

test('new asset exports all eleven client controls as independently validated templates', () => {
  const kinds = ['container', 'textbox', 'cursor', 'reference', 'grid', 'button', 'textwindow', 'keyhint', 'image', 'animation', 'fullscreen']
  const labels = ['容器节点', '文本框', '光标检测区域', '模板引用控件', '网格视窗', '预设按钮', '文本视窗', '按键提示', '图片', '界面动效', '全屏动效']
  const server = createNode('server-container', { id: 'sc-all', name: '客户端控件模板' })
  server.children = kinds.map((kind, index) => createNode(kind, {
    id: `all-${index + 1}`,
    guid: 1073742200 + index,
    name: labels[index],
    ...(kind === 'image' ? { imageId: 0 } : {}),
  }))
  const studio = createStudio({
    version: 1,
    meta: {
      name: '全部客户端控件', assetType: 'client-control-template', sourceFormat: 'authoring',
      gameVersion: '7.0.50', giaOwnerUid: 114514, giaTimestamp: 1787410000,
      giaFileId: 1073741840, giaFileName: 'qxqy-client-controls-all.gia',
    },
    canvasId: 'pc-16-9', selectedId: 'all-1',
    script: { controlId: 'all-1', path: '', source: '' }, root: server,
  })
  const exported = studio.exportData('gia')
  const bytes = Buffer.from(exported.data, 'base64')
  const compatibility = validateGiaCompatibility(bytes)
  assert.equal(compatibility.valid, true, compatibility.errors.join('\n'))
  assert.equal(compatibility.templateCount, 11)
  assert.equal(compatibility.accessoryCount, 0)
  assert.deepEqual(compatibility.templates.map((item) => item.kind), kinds)
  assert.equal(compatibility.templates.every((item) => item.relatedPresent && item.relatedGuids.length === 0), true)
  assert.equal(compatibility.units.every((unit) => unit.template && unit.parent === 0 && unit.children.length === 0), true)
  assert.deepEqual(compatibility.explicitEmpty, { field17: 22, rectField508: 44 })
  const imported = createStudio().importData('gia', exported.data, exported.filename)
  assert.equal(imported.snapshot.asset.templateCount, 11)
  assert.deepEqual(imported.snapshot.tree.map((row) => row.kind), kinds)
})

test('new client template project exports one instantiable template with child controls', () => {
  const studio = createStudio()
  const snap = studio.patch({ op: 'newAsset', assetType: 'client-control-template' })
  assert.equal(snap.asset.type, 'client-control-template')
  assert.equal(snap.asset.templateCount, 1)
  assert.equal(snap.tree[0].name, 'Lua实例化面板')
  assert.equal(snap.tree[0].depth, 0)
  assert.equal(snap.boxes.some((box) => box.name === '确认按钮'), true)
  const added = studio.patch({ op: 'addTemplate', kind: 'image', name: '图标模板' })
  assert.equal(added.asset.templateCount, 2)
  assert.equal(added.tree.find((row) => row.name === '图标模板').depth, 0)
  assert.equal(added.boxes.length, 1)
  assert.equal(added.inspector.guid, 1073742105)
  const exported = studio.exportData('gia')
  const compatibility = validateGiaCompatibility(Buffer.from(exported.data, 'base64'))
  assert.equal(compatibility.valid, true, compatibility.errors.join('\n'))
  assert.match(compatibility.filePath, /^114514-\d+-1073741829-\\客户端控件模板列表\.gia$/u)
  assert.deepEqual(compatibility.templates.map((item) => [item.kind, item.actualIndex]), [
    ['container', 2], ['image', 10],
  ])
  assert.deepEqual(compatibility.templates.map((item) => item.relatedPresent), [true, true])
  assert.deepEqual(compatibility.templates.map((item) => item.relatedGuids), [[], []])
  assert.deepEqual(compatibility.explicitEmpty, { field17: 12, rectField508: 24 })
  assert.deepEqual(inspectGia(Buffer.from(exported.data, 'base64')), {
    gameVersion: '7.0.50', graphName: 'Lua实例化面板', accessories: 4,
    assetType: 'client-control-template', templateCount: 2,
  })
  const target = createStudio()
  const imported = target.importData('gia', exported.data, exported.filename)
  assert.equal(imported.snapshot.asset.type, 'client-control-template')
  assert.equal(imported.snapshot.root.children.length, 2)
  assert.equal(imported.snapshot.tree.some((row) => row.name === '模板标题'), true)
  assert.equal(compileProject(target._project).root.name, 'Lua实例化面板')
})

test('client template project registers top-level prefabIds for Lua InstantiateClientUIControl', () => {
  const studio = createStudio()
  studio.patch({
    op: 'addScript',
    controlId: 'n1',
    path: 'inline',
    source: `
function OnStart()
  local created = game.InstantiateClientUIControl(1073742100, script.object)
  print("client-template-created", created ~= nil, created and created.prefabIndex)
end
`,
  })
  const play = studio.playStart({ inspect: true })
  assert.match(play.logs.map((entry) => entry.text).join('\n'), /client-template-created\ttrue\t1073742100/)
  assert.equal(play.tree[0].children.some((child) => child.instantiated && child.prefabId === 1073742100), true)
  assert.equal(play.tree[0].children.some((child) => child.name === 'Lua实例化面板'), true)
  studio.playStop()
})

test('client template hierarchy can reparent controls, preserve nesting, and export multiple template roots', () => {
  const studio = createStudio()
  studio.patch({ op: 'newAsset', assetType: 'client-control-template' })
  studio.patch({ op: 'reparent', id: 'n2', parentId: 'n4' })
  studio.patch({ op: 'reparent', id: 'n3', parentId: 'sc1' })
  const moved = studio.patch({ op: 'moveSibling', id: 'n2', direction: 'up' })
  assert.equal(moved.asset.templateCount, 2)
  assert.equal(moved.tree.find((row) => row.id === 'n3').depth, 0)
  assert.equal(moved.tree.find((row) => row.id === 'n2').parentId, 'n4')
  assert.equal(moved.tree.find((row) => row.id === 'n2').depth, 2)
  assert.deepEqual(moved.tree.find((row) => row.id === 'n2').ancestorIds, ['n1', 'n4'])

  const exported = studio.exportData('gia')
  const bytes = Buffer.from(exported.data, 'base64')
  const compatibility = validateGiaCompatibility(bytes)
  assert.equal(compatibility.valid, true, compatibility.errors.join('\n'))
  assert.equal(compatibility.templateCount, 2)
  assert.deepEqual(compatibility.templates.map((item) => [item.kind, item.actualIndex, item.relatedPresent, item.relatedGuids]), [
    ['container', 2, true, []],
    ['image', 10, true, []],
  ])
  assert.equal(compatibility.accessoryCount, 3)

  const target = createStudio()
  const imported = target.importData('gia', exported.data, exported.filename)
  assert.equal(imported.snapshot.asset.templateCount, 2)
  assert.equal(imported.snapshot.tree.find((row) => row.name === '模板标题').depth, 2)
  assert.equal(imported.snapshot.tree.find((row) => row.name === '模板图标').depth, 0)
})

test('workspace option keeps the session cwd and uses neutral default names', () => {
  const nested = fileURLToPath(new URL('../', import.meta.url)).replace(/[/\\]+$/, '')
  const studio = createStudio(undefined, { workspacePath: nested })
  const snap = studio.get()
  assert.equal(snap.workspace.bound, true)
  assert.equal(snap.workspace.name, 'studio')
  assert.equal(snap.workspace.path, nested)
  assert.equal(snap.save.name, '未命名存档')
  assert.equal(snap.meta.name, '未命名界面')
})

test('unbound studio never falls back to the process startup directory', () => {
  const studio = createStudio()
  const snap = studio.get()
  assert.equal(snap.workspace.bound, false)
  assert.equal(snap.workspace.name, '未绑定')
  assert.equal(snap.workspace.path, '')
  assert.equal(snap.save.name, '未命名存档')
  assert.equal(snap.meta.name, '未命名界面')
})

test('setWorkspace retargets display only and never auto names', () => {
  const repoRoot = fileURLToPath(new URL('../../../', import.meta.url)).replace(/[/\\]+$/, '')
  const outsideRepo = tmpdir()
  const studio = createStudio(undefined, { workspacePath: outsideRepo })
  assert.equal(studio.get().workspace.name, basename(outsideRepo))
  assert.equal(studio.get().save.name, '未命名存档')
  assert.equal(studio.get().meta.name, '未命名界面')

  studio.setWorkspace(repoRoot)
  assert.equal(studio.get().workspace.name, basename(repoRoot))
  assert.equal(studio.get().workspace.path, repoRoot)
  assert.equal(studio.get().save.name, '未命名存档')
  assert.equal(studio.get().meta.name, '未命名界面')

  studio.patch({ op: 'renameSave', name: '我的存档' })
  studio.setWorkspace(outsideRepo)
  assert.equal(studio.get().save.name, '我的存档')
  assert.equal(studio.get().workspace.name, basename(outsideRepo))
})

test('missing GUIDs start from 1073741850 without rewriting stored ids', () => {
  const server = createNode('server-container', { id: 'sc1', guid: 0, name: '客户端控件容器' })
  const root = createNode('container', { id: 'n1', guid: 0, name: '容器节点', isRootContainer: true })
  server.children.push(root)
  const project = createProject({
    version: 1,
    meta: { name: 'guid-base', assetType: 'server-control-template' },
    canvasId: 'pc-16-9',
    selectedId: 'n1',
    root: server,
  })
  const map = assignGuids(project)
  assert.equal(map.get('sc1'), 1073741850)
  assert.equal(map.get('n1'), 1073741851)
})

test('assignGuids keeps later stored ids instead of filling from 1073742000', () => {
  const server = createNode('server-container', { id: 'sc1', guid: 0, name: '客户端控件容器' })
  const root = createNode('container', { id: 'n1', guid: 0, name: '容器节点', isRootContainer: true })
  const image = createNode('image', { id: 'n2', guid: 1073741889, name: '网格视窗模板' })
  const text = createNode('textbox', { id: 'n3', guid: 0, name: '文本框' })
  root.children.push(image, text)
  server.children.push(root)
  const project = createProject({
    version: 1,
    meta: { name: 'guid-preserve', assetType: 'server-control-template' },
    canvasId: 'pc-16-9',
    selectedId: 'n2',
    root: server,
  })
  const map = assignGuids(project)
  assert.equal(map.get('n2'), 1073741889)
  assert.equal(project.root.children[0].children[0].guid, 1073741889)
  assert.equal(map.get('sc1') !== 1073741889, true)
  assert.equal(map.get('n1') !== 1073741889, true)
  assert.equal(map.get('n3') !== 1073741889, true)
  assert.deepEqual([...new Set(map.values())].length, map.size)
})

test('imported save archives keep their explicit name over workspace auto naming', () => {
  const source = createStudio()
  const exported = source.exportData('save')
  const target = createStudio(undefined, { workspacePath: tmpdir() })
  const imported = target.importData('json', exported.data, exported.filename)
  const payload = JSON.parse(Buffer.from(exported.data, 'base64').toString('utf8'))
  assert.equal(imported.snapshot.save.name, payload.meta.name)
})
