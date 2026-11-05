import test from 'node:test'
import assert from 'node:assert/strict'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { Container, DOMAdapter, Matrix } from 'pixi.js'
import { createRuntime } from '../../client/lua-runtime/src/index.js'
import { createStudio } from '../index.js'
import { walk } from '../ui/authoring.js'
import { importGia, exportGia } from '../gia/codec.js'
import { resolveKeyHint, KEY_HINT_KEYS } from '../key-hints.js'
import { keyHintSize, paintKeyHintCanvas } from '../play/key-hint-paint.js'
import { paintList, playSnapshot } from '../play/session.js'
import { renderEditorPng, renderPaintPng, renderScenePng } from '../host-png.js'
import { PixiPlayRenderer } from '../play/pixi-renderer.js'
import { SimulatorController } from '../host/controller.js'

const hint = (name, device = 'keyboard') => ({ keyHint: resolveKeyHint({ [`${device}KeyCode`]: name }, 'KeyboardAndMouse', device) })
const setKey = (studio, key, value) => studio.patch({ op: 'set', id: 'n8', key, value })
const hintBox = studio => studio.get().boxes.find(item => item.id === 'n8')
async function pixels(png, width, height) {
  const canvas = createCanvas(width, height), ctx = canvas.getContext('2d')
  ctx.drawImage(await loadImage(png.data), 0, 0)
  return ctx.getImageData(0, 0, width, height).data
}
function fixture(t, device = 'KeyboardAndMouse') {
  const runtime = createRuntime({ canvasWidth: 240, canvasHeight: 160, device })
  t.after(() => runtime.destroy())
  const key = runtime.addRoot({ name: 'Hint', kind: 'keyhint', active: true, sizeDeltaX: 40, sizeDeltaY: 40,
    keyboardKeyCode: 'MoveForwardKey', controllerKeyCode: 'CraftspersonKey4' })
  return { runtime, key, session: { runtime, compiled: { canvasId: 'pc-16-9', platform: 'KEYBOARD' } } }
}

test('documented physical bindings cover long keys, D-pad directions, chords and input devices', () => {
  assert.equal(KEY_HINT_KEYS.keyboard.length, 59)
  assert.equal(KEY_HINT_KEYS.controller.length, 25)
  for (const [name, label] of [['CraftspersonKey35', '/'], ['CraftspersonKey36', '↑'], ['CraftspersonKey40', '右Ctrl'],
    ['CraftspersonKey41', '右Shift'], ['CraftspersonKey42', 'Backspace'], ['CraftspersonKey43', 'CapsLock'], ['MoveForwardKey', 'W']]) {
    assert.equal(hint(name).keyHint.tokens[0].label, label)
  }
  assert.deepEqual(hint('NormalAttackKey').keyHint.tokens, [{ type: 'mouse', side: 'left' }])
  assert.deepEqual(hint('SprintKey').keyHint.tokens, [{ type: 'mouse', side: 'right' }])
  assert.equal(hint('CraftspersonKey1', 'controller').keyHint.tokens[0].direction, 'left')
  assert.equal(hint('CraftspersonKey2', 'controller').keyHint.tokens[0].direction, 'down')
  assert.deepEqual(hint('CraftspersonKey4', 'controller').keyHint.tokens.map(t => t.label), ['LB', '+', 'Y'])
  assert.equal(hint('CraftspersonKey14', 'controller').keyHint.tokens[2].label, 'LS')
  const control = { keyboardKeyCode: 24, controllerKeyCode: 'JumpKey' }
  assert.equal(resolveKeyHint(control).tokens[0].label, '1')
  for (const device of ['Controller', 'MobileController']) assert.equal(resolveKeyHint(control, device).tokens[0].label, 'A')
  assert.deepEqual(resolveKeyHint(control, 'Mobile').tokens, [])
  assert.equal(resolveKeyHint(control, 'Mobile', 'keyboard').tokens[0].label, '1')
  assert.deepEqual(hint('None').keyHint.tokens, [])
  assert.deepEqual(hint(1).keyHint.tokens, [])
  assert.equal(hint(2).keyHint.tokens[0].type, 'unknown', 'GIA codes are not positions in the enum table')
  assert.equal(hint('MenuConfirmKey', 'controller').keyHint.tokens[0].type, 'unknown')
})

test('JSON and inspector preserve named choices, raw numbers round-trip, and stale GIA raw never overrides a new key', () => {
  const studio = createStudio()
  setKey(studio, 'keyboardKeyCode', 24)
  setKey(studio, 'controllerKeyCode', 77)
  const roundtrip = () => {
    let key
    walk(importGia(exportGia(studio.archiveData().assets.server).buffer).project.root, node => { if (node.kind === 'keyhint') key = node })
    return key
  }
  assert.equal(roundtrip().keyboardKeyCode, 24)
  assert.equal(roundtrip().controllerKeyCode, 77)
  setKey(studio, 'controllerKeyCode', -1)
  assert.equal(roundtrip().controllerKeyCode, -1, 'unknown signed int32 wire values are preserved')
  setKey(studio, 'keyboardKeyCode', 'CraftspersonKey1')
  assert.equal(roundtrip().keyboardKeyCode, 24)
  setKey(studio, 'keyboardKeyCode', 'CraftspersonKey42')
  assert.throws(roundtrip, /尚无已核实的 GIA 数字映射/)
  setKey(studio, 'controllerKeyCode', 'CraftspersonKey4')
  studio.patch({ op: 'select', id: 'n8' })
  studio.patch({ op: 'setKeyHintDevice', device: 'controller' })
  const reloaded = createStudio(studio.archiveData())
  assert.deepEqual(hintBox(reloaded).keyHint.tokens.map(t => t.label), ['LB', '+', 'Y'])
  const fields = reloaded.get().inspector.fields
  assert.equal(fields.find(f => f.key === 'keyboardKeyCode').type, 'enum')
  assert.equal(fields.find(f => f.key === 'keyboardKeyCode').value, 'CraftspersonKey42')
  const before = studio.archiveData()
  assert.throws(() => setKey(studio, 'keyboardKeyCode', 'MisspelledKey'), /invalid keyboard/)
  assert.throws(() => setKey(studio, 'keyboardKeyCode', 2147483648), /invalid keyboard/)
  assert.deepEqual(studio.archiveData(), before, 'invalid edits leave the archive intact')
  setKey(studio, 'keyboardKeyCode', 'None')
  setKey(studio, 'controllerKeyCode', 'None')
  assert.equal(roundtrip().keyboardKeyCode, 1)
  assert.equal(roundtrip().controllerKeyCode, 1)
})

test('actual Lua enum writes repaint long keys and clear None; reads preserve enum identity', t => {
  const { runtime, key, session } = fixture(t)
  runtime.mountScript({ path: 'hints', control: key, source: `
local n = 0
function OnStart()
  assert(script.object.keyboardKeyCode == Enum.KeyboardKeyCode.MoveForwardKey)
  script.object.controllerKeyCode = Enum.ControllerKeyCode.CraftspersonKey6
  assert(script.object.controllerKeyCode == Enum.ControllerKeyCode.CraftspersonKey6)
  assert(not pcall(function() script.object.keyboardKeyCode = Enum.ControllerKeyCode.JumpKey end))
  assert(not pcall(function() script.object.keyboardKeyCode = 24 end))
  script:EnableUpdate(true)
end
function OnUpdate(dt)
  n = n + 1
  if n == 1 then script.object.keyboardKeyCode = Enum.KeyboardKeyCode.CraftspersonKey42
  else script.object.keyboardKeyCode = Enum.KeyboardKeyCode.None; script:EnableUpdate(false) end
end` })
  assert.deepEqual(runtime.mountErrors, [])
  let scene = playSnapshot(session, { view: true }).scene
  assert.equal(scene.nodes[0].keyHint.tokens[0].label, 'W')
  runtime.step(0.1)
  scene = playSnapshot(session, { view: true, sceneRev: scene.revision }).scene
  assert.equal(scene.reset, false)
  assert.equal(scene.changed[0].keyHint.tokens[0].label, 'Backspace')
  assert.equal(key.keyboardKeyCode.Name, 'CraftspersonKey42')
  assert.equal(paintList(session)[0].keyHint.tokens[0].label, 'Backspace')
  const snapshot = playSnapshot(session, { inspect: true })
  assert.equal(snapshot.tree[0].controllerKeyCode, 'CraftspersonKey6')
  runtime.step(0.1)
  scene = playSnapshot(session, { view: true, sceneRev: scene.revision }).scene
  assert.deepEqual(scene.changed[0].keyHint.tokens, [])
  assert.equal(key.sizeDeltaX, 40, 'visual expansion does not rewrite RectTransform')
})

test('40px keycaps, mouse buttons, long labels and chords produce visible pixels in editor, paint and scene PNG', async t => {
  assert.deepEqual(keyHintSize(hint('MoveForwardKey'), 40, 40), { width: 40, height: 40 })
  assert.ok(keyHintSize(hint('CraftspersonKey42'), 40, 40).width > 100)
  assert.ok(keyHintSize(hint('CraftspersonKey4', 'controller'), 40, 40).width > 100)
  const canvas = createCanvas(1, 1)
  paintKeyHintCanvas(canvas, hint('CraftspersonKey1', 'controller'), 40, 40)
  const sample = (x, y) => [...canvas.getContext('2d').getImageData(x, y, 1, 1).data]
  assert.deepEqual(sample(6, 20), [255, 255, 255, 255], 'left is highlighted')
  assert.deepEqual(sample(20, 6), [48, 51, 51, 255], 'up remains dark')
  assert.equal(sample(0, 0)[3], 0, 'transparent around the D-pad')
  for (const name of ['MoveForwardKey', 'CraftspersonKey42', 'NormalAttackKey', 'SprintKey']) {
    const { key, session } = fixture(t)
    key.keyboardKeyCode = name
    const scene = playSnapshot(session, { view: true }).scene
    const png = renderScenePng(scene, 240, 160, { background: 'transparent' })
    assert.deepEqual(png.data, renderPaintPng(paintList(session), 240, 160, { background: 'transparent' }).data)
    const data = await pixels(png, 240, 160)
    let white = 0, dark = 0, left = 240, right = 0
    for (let y = 0; y < 160; y++) for (let x = 0; x < 240; x++) {
      const i = (y * 240 + x) * 4
      if (!data[i + 3]) continue
      left = Math.min(left, x); right = Math.max(right, x)
      if (data[i] > 245 && data[i + 1] > 245 && data[i + 2] > 245) white++
      if (data[i] < 90 && data[i + 1] < 90 && data[i + 2] < 90 && data[i + 3] > 240) dark++
    }
    assert.ok(white > 500 && dark > 25, `${name}: light body and dark glyph/button required`)
    assert.ok(Math.abs((left + right) / 2 - 119.5) < 1, 'expansion stays centered')
    assert.ok(name === 'CraftspersonKey42' ? right - left > 100 : right - left <= 40)
    if (name === 'NormalAttackKey' || name === 'SprintKey') {
      const rgb = x => [...data.slice((70 * 240 + x) * 4, (70 * 240 + x) * 4 + 3)]
      const selected = name === 'NormalAttackKey' ? 114 : 126
      const other = name === 'NormalAttackKey' ? 126 : 114
      assert.ok(rgb(selected).every(channel => channel < 90), `${name}: indicated mouse button is dark`)
      assert.ok(rgb(other).every(channel => channel > 240), `${name}: opposite mouse button stays light`)
    }
    const studio = createStudio()
    setKey(studio, 'keyboardKeyCode', name)
    const box = hintBox(studio)
    const editor = renderEditorPng({ canvas: { width: 240, height: 160 }, boxes: [{ ...box,
      renderMatrix: { a: 1, b: 0, c: 0, d: 1, tx: 120 - box.centerX, ty: 80 - box.centerY } }] })
    const editorData = await pixels(editor, 240, 160)
    for (let i = 0; i < data.length; i += 4) if (data[i + 3] === 255) {
      assert.deepEqual(editorData.slice(i, i + 4), data.slice(i, i + 4), 'same opaque keycap pixels in editor and play')
    }
  }
  paintKeyHintCanvas(canvas, hint('None'), 40, 40)
  assert.equal(sample(0, 0)[3], 0, 'None clears prior pixels')
  paintKeyHintCanvas(canvas, hint('MoveForwardKey'), 10_000, 50, 2)
  assert.equal(canvas.width, 4096)
})

test('long keycaps inherit parent rotation and mask clipping; hidden and inactive keys disappear', async t => {
  const runtime = createRuntime({ canvasWidth: 240, canvasHeight: 160 })
  t.after(() => runtime.destroy())
  const parent = runtime.addRoot({ kind: 'image', active: true, imageColor: 0, imageId: 100001, enableMask: true,
    sizeDeltaX: 60, sizeDeltaY: 60, localRotationZ: 90, localScaleX: 1.5,
    children: [{ kind: 'keyhint', active: true, sizeDeltaX: 40, sizeDeltaY: 40, keyboardKeyCode: 'CraftspersonKey42' }] })
  const key = parent.children[0], session = { runtime, compiled: { canvasId: 'pc-16-9', platform: 'KEYBOARD' } }
  const png = renderScenePng(playSnapshot(session, { view: true }).scene, 240, 160, { background: 'transparent' })
  const data = await pixels(png, 240, 160)
  let ink = 0
  for (let y = 0; y < 160; y++) for (let x = 0; x < 240; x++) {
    if (!data[(y * 240 + x) * 4 + 3]) continue
    ink++
    assert.ok(x >= 90 && x < 150 && y >= 35 && y < 125, 'pixels stay inside the transformed 60×60 mask')
  }
  assert.ok(ink > 1000)
  for (const field of ['visible', 'active']) {
    key[field] = false; key.markPlayDirty(true)
    assert.equal(playSnapshot(session, { view: true }).scene.nodes.some(n => n.kind === 'keyhint'), false)
    key[field] = true; key.markPlayDirty(true)
  }
})

test('Pixi reuses same-size hint textures, releases resized/None/hidden textures and leaves no cross-scene resources', async t => {
  const previous = DOMAdapter.get()
  DOMAdapter.set({ ...previous, createCanvas })
  const renderer = Object.create(PixiPlayRenderer.prototype)
  Object.assign(renderer, { ready: Promise.resolve(), nodes: new Map(), scratch: new Matrix(), canvasWidth: 240, canvasHeight: 160,
    app: { stage: new Container(), render() {}, renderer: { resize() {}, resolution: 1 } } })
  t.after(() => { renderer.clearNodes(); DOMAdapter.set(previous) })
  const { key, session } = fixture(t)
  let scene
  const update = async value => {
    if (value) { key.keyboardKeyCode = value; key.markPlayDirty() }
    scene = playSnapshot(session, { view: true, ...(scene ? { sceneRev: scene.revision } : {}) }).scene
    await renderer.applyScene(scene, 240, 160)
    return renderer.nodes.get(key.Id)?.__visual?.__keyHint?.texture
  }
  const texture = await update(), source = texture.source, first = source.resource.toBuffer('image/png')
  assert.equal(await update('MoveBackwardKey'), texture)
  assert.notDeepEqual(source.resource.toBuffer('image/png'), first)
  assert.equal(await update('NormalAttackKey'), texture)
  const mouseLeft = source.resource.toBuffer('image/png')
  assert.equal(await update('SprintKey'), texture)
  assert.notDeepEqual(source.resource.toBuffer('image/png'), mouseLeft, 'mouse-side changes repaint the reused texture')
  const long = await update('CraftspersonKey42')
  assert.equal(texture.destroyed, true); assert.equal(source.destroyed, true)
  assert.ok(long.source.resource.width > 100)
  const longSource = long.source
  assert.equal(await update('None'), undefined)
  assert.equal(long.destroyed, true); assert.equal(longSource.destroyed, true)
  const shown = await update('JumpKey'), shownSource = shown.source
  key.SetVisible(false)
  assert.equal(await update(), undefined)
  assert.equal(shownSource.destroyed, true)
  key.SetVisible(true)
  const last = await update(), lastSource = last.source
  renderer.clearNodes()
  assert.equal(last.destroyed, true); assert.equal(lastSource.destroyed, true)
})

test('Worker starts with saved key preview mode, supports explicit override, and keeps the Lua device tied to canvas', async t => {
  const controller = new SimulatorController('', { clockMode: 'manual' })
  t.after(() => controller.dispose())
  setKey(controller.studio, 'keyboardKeyCode', 24)
  setKey(controller.studio, 'controllerKeyCode', 'CraftspersonKey4')
  controller.studio.patch({ op: 'setKeyHintDevice', device: 'controller' })
  let snap = await controller.play('start', { view: true })
  assert.equal(snap.keyHintDevice, 'controller')
  assert.equal(snap.device, 'KeyboardAndMouse')
  assert.equal(snap.scene.nodes.find(n => n.kind === 'keyhint').keyHint.tokens[2].label, 'Y')
  snap = await controller.play('device', { canvasId: 'mobile-16-9', keyHintDevice: 'keyboard', view: true })
  assert.equal(snap.device, 'Mobile')
  assert.equal(snap.scene.nodes.find(n => n.kind === 'keyhint').keyHint.tokens[0].label, '1')
  snap = await controller.play('start', { canvasId: 'mobile-16-9', keyHintDevice: 'auto', view: true })
  assert.deepEqual(snap.scene.nodes.find(n => n.kind === 'keyhint').keyHint.tokens, [])
})
