import test from 'node:test'
import assert from 'node:assert/strict'
import { createRuntime } from '../../client/lua-runtime/src/index.js'
import { uiVfxSnapshot } from '../play/session.js'
import { createStudio } from '../index.js'
import { SimulatorController } from '../host/controller.js'
import { UI_VFX_CATALOG, uiVfxAsset, uiVfxTime, uiVfxMedia, uiVfxUrl } from '../assets/ui-vfx-catalog.js'

test('effect catalog is scope-safe and references a closed media inventory; loop uses second half', () => {
  for (const item of UI_VFX_CATALOG) {
    for (const path of [item.video, item.icon, ...item.audio]) {
      assert.ok(uiVfxMedia(path)?.bytes > 0)
      assert.match(uiVfxMedia(path).sha256, /^[a-f0-9]{64}$/)
      assert.ok(uiVfxUrl(path).startsWith('/qxqy-vfx/ct-v1/'))
    }
  }
  assert.equal(uiVfxAsset(10002001), null)
  assert.equal(uiVfxAsset(10001001, 'fullscreen'), null)
  const loop = uiVfxAsset(10001001)
  assert.equal(uiVfxTime(loop, 10), 5)
  assert.equal(uiVfxTime(loop, 16.25), 6.25)
  const once = UI_VFX_CATALOG.find(item => !item.loop)
  assert.equal(uiVfxTime(once, once.duration), null)
})

test('Lua controls restart/stop independently and snapshots never consume effects or advance time', () => {
  const runtime = createRuntime({ canvasWidth: 1280, canvasHeight: 720 })
  try {
    const root = runtime.addRoot({ kind: 'container', active: true, showCursor: true, sizeDeltaX: 1000, sizeDeltaY: 600, children: [
      { kind: 'animation', name: 'A', active: true, animationId: 10001017 },
      { kind: 'animation', name: 'B', active: true, animationId: 10001017 },
    ] })
    const session = { runtime }
    runtime.mountScript({ control: root, path: 'effects', source: `
function OnStart()
  local a = script.object:GetChild("A")
  script.object:AddKeyEventListener(Enum.KeyEventType.KeyboardCraftspersonKey1Down, function() a:StopAnimation() end)
  script.object:AddKeyEventListener(Enum.KeyEventType.KeyboardCraftspersonKey2Down, function() a:PlayAnimation() end)
  script.object:AddKeyEventListener(Enum.KeyEventType.KeyboardCraftspersonKey3Down, function()
    a.animationId = 10001001; a.layer = Enum.UIAnimationLayer.BelowAllControls; a.playSoundEffect = false
  end)
end` })
    const initial = uiVfxSnapshot(session)
    assert.equal(initial.length, 2)
    assert.deepEqual(uiVfxSnapshot(session), initial)
    assert.equal(runtime.clock.time, 0)
    runtime.step(0.5)
    runtime.injectKey('KeyboardCraftspersonKey1Down')
    assert.equal(uiVfxSnapshot(session).length, 1)
    runtime.injectKey('KeyboardCraftspersonKey2Down')
    const replay = uiVfxSnapshot(session).find(item => item.id === root.children[0].Id)
    assert.equal(replay.startedAt, 0.5)
    assert.equal(replay.generation, initial.find(item => item.id === replay.id).generation + 1)
    assert.equal(uiVfxSnapshot(session).find(item => item.id !== replay.id).startedAt, 0)
    runtime.injectKey('KeyboardCraftspersonKey3Down')
    assert.equal(root.children[0].animationId, 10001001)
    assert.equal(uiVfxSnapshot(session).find(item => item.id === replay.id).layer, 'BelowAllControls')
    assert.equal(uiVfxSnapshot(session).find(item => item.id === replay.id).playSoundEffect, false)
    root.SetVisible(false)
    assert.deepEqual(uiVfxSnapshot(session), [])
    root.SetVisible(true)
    assert.equal(uiVfxSnapshot(session).length, 2)
    runtime.destroyControl(root.children[0])
    assert.equal(runtime.uiAnimations.size, 1)
    assert.equal(runtime.logs.filter(item => item.level === 'lua-error').length, 0)
  } finally { runtime.destroy() }
  assert.equal(runtime.uiAnimations.size, 0)
})

test('effect authoring preserves IDs/settings in JSON and projects numeric IDs to Lua and editor boxes', () => {
  const studio = createStudio()
  const added = studio.patch({ op: 'add', parentId: 'n1', kind: 'animation', name: 'Spark' })
  const id = added.selectedId
  studio.patch({ op: 'set', id, key: 'animationId', value: '10001001' })
  studio.patch({ op: 'set', id, key: 'playSoundEffect', value: false })
  studio.patch({ op: 'set', id, key: 'layer', value: 'BelowAllControls' })
  const box = studio.get().boxes.find(item => item.id === id)
  assert.equal(box.playSoundEffect, false)
  assert.equal(box.layer, 'BelowAllControls')
  const loaded = createStudio(studio.archiveData())
  try {
    const snapshot = loaded.playStart()
    assert.equal(snapshot.effects[0].animationId, 10001001)
    assert.equal(snapshot.effects[0].layer, 'BelowAllControls')
    assert.deepEqual(loaded.playGet().effects, snapshot.effects)
  } finally { loaded.playStop() }
})

test('headless PNG reports omitted video without fetching effects or advancing the manual runtime', async t => {
  const controller = new SimulatorController('', { clockMode: 'manual', imageAssets: { prepare: async () => ({ warnings: [] }) } })
  t.after(() => controller.dispose())
  assert.deepEqual((await controller.uiScreenshot()).assetWarnings, [], 'empty effect controls have no missing-media warning')
  const added = controller.studio.patch({ op: 'add', parentId: 'n1', kind: 'animation', name: 'Effect' })
  controller.studio.patch({ op: 'set', id: added.selectedId, key: 'animationId', value: '10001001' })
  const ui = await controller.uiScreenshot()
  assert.equal(ui.assetWarnings.length, 1)
  assert.match(ui.assetWarnings[0].error, /browser playback only/)
  await controller.play('start')
  const first = await controller.playScreenshot(), second = await controller.playScreenshot()
  assert.equal(first.time, 0)
  assert.equal(second.time, first.time)
  assert.equal(first.assetWarnings.length, 1)
  assert.equal(first.assetWarnings[0].animationId, 10001001)
  assert.deepEqual(second.data, first.data)
})
