import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createStudio } from '../index.js'
import * as giaCodec from '../gia/codec.js'
import { join } from 'node:path'

test('current save still accepts per-asset script mounts when constructing default UI assets', () => {
  const legacy = {
    format: 'qxqy-simulator-save',
    version: 4,
    meta: { name: '旧存档' },
    activeAssetType: 'server-control-template',
    assets: {
      server: {
        version: 3,
        meta: { name: '服务端UI', assetType: 'server-control-template' },
        canvasId: 'pc-16-9',
        selectedId: 'n2',
        script: { controlId: 'n1', path: 'lua/legacy-server.lua', source: 'print("legacy-server")' },
      },
      client: {
        version: 2,
        meta: { name: '客户端模板', assetType: 'client-control-template' },
        canvasId: 'pc-16-9',
        selectedId: 'n1',
        script: { controlId: 'n1', path: 'lua/legacy-client.lua', source: 'print("legacy-client")' },
      },
    },
  }
  const studio = createStudio(structuredClone(legacy))
  const snap = studio.get()
  assert.equal(snap.save.name, '旧存档')
  assert.equal(snap.scripts.length, 2)
  const serverScript = snap.scripts.find((row) => row.path === 'lua/legacy-server.lua')
  const clientScript = snap.scripts.find((row) => row.path === 'lua/legacy-client.lua')
  assert.equal(serverScript.controlAsset, 'server-control-template')
  assert.equal(serverScript.controlName, '容器节点')
  assert.equal(clientScript.controlAsset, 'client-control-template')
  assert.equal(clientScript.controlName, 'Lua实例化面板')

  const roundTrip = JSON.parse(Buffer.from(studio.exportData('save').data, 'base64').toString('utf8'))
  assert.equal(roundTrip.version, 4)
  assert.equal(roundTrip.assets.scripts.length, 2)
  const restored = createStudio(structuredClone(roundTrip))
  assert.equal(restored.get().scripts.length, 2)
})

test('scripts bundle export and lua import round-trip', () => {
  const studio = createStudio()
  studio.patch({ op: 'addScript', controlId: 'n1', controlAsset: 'server-control-template', path: 'lua/main.lua', source: 'print("main")' })
  const bundle = JSON.parse(Buffer.from(studio.exportData('scripts').data, 'base64').toString('utf8'))
  assert.equal(bundle.format, 'qxqy-simulator-scripts')
  assert.equal(bundle.scripts.length, 1)
  assert.equal(bundle.scripts[0].controlAsset, 'server-control-template')
  assert.match(String(bundle.scripts[0].id), /^\d+$/)
  assert.equal(bundle.scripts[0].id, String(bundle.scripts[0].guid))

  const target = createStudio()
  const luaBase64 = Buffer.from('print("imported")').toString('base64')
  const imported = target.importData('lua', luaBase64, 'imported.lua')
  assert.equal(imported.snapshot.scripts.length, 1)
  assert.equal(imported.snapshot.scripts[0].path, 'imported.lua')
  assert.equal(imported.snapshot.scripts[0].mounted, false)
  const single = target.exportData('lua', imported.snapshot.scripts[0].id)
  assert.equal(single.filename, 'imported.lua')
  assert.equal(Buffer.from(single.data, 'base64').toString('utf8'), 'print("imported")')
})

test('script mounted on a client template control runs when the template is instantiated', () => {
  const studio = createStudio()
  studio.patch({ op: 'addScript', controlId: 'n2', controlAsset: 'client-control-template', path: 'tmpl', source: 'function OnStart()\n  print("on-template", script.object.name)\nend' })
  studio.patch({ op: 'addScript', controlId: 'n1', controlAsset: 'server-control-template', path: 'main', source: 'function OnStart()\n  local c = game.InstantiateClientUIControl(1073742100, script.object)\n  print("main-created", c ~= nil)\nend' })
  const snap = studio.playStart()
  const text = snap.logs.map((entry) => entry.text).join('\n')
  assert.match(text, /on-template\t模板标题/)
  assert.match(text, /main-created\ttrue/)
  studio.playStop()
})

test('mounting rejects server containers and unknown controls across both trees', () => {
  const studio = createStudio()
  assert.throws(() => studio.patch({ op: 'addScript', controlId: 'sc1' }), /挂载目标/)
  assert.throws(() => studio.patch({ op: 'addScript', controlId: 'n99' }), /挂载目标/)
  const snap = studio.patch({ op: 'addScript', controlId: 'n2', controlAsset: 'client-control-template', path: 'x', source: '' })
  assert.equal(snap.scripts[0].controlName, '模板标题')
  assert.equal(snap.scripts[0].assetLabel, '客户端控件模板')
})

test('unmounted scripts stay require-able during play', () => {
  const studio = createStudio()
  studio.patch({ op: 'addScript', path: 'lib/util', source: 'return { value = 42 }' })
  studio.patch({ op: 'addScript', controlId: 'n1', controlAsset: 'server-control-template', path: 'main', source: 'function OnStart()\n  local u = require("lib/util")\n  print("required", u.value)\nend' })
  const snap = studio.playStart()
  assert.match(snap.logs.map((entry) => entry.text).join('\n'), /required\t42/)
  studio.playStop()
})

test('play passes the script mapping GUID to scriptMappingId', () => {
  const studio = createStudio()
  const added = studio.patch({
    op: 'addScript',
    controlId: 'n1',
    controlAsset: 'server-control-template',
    path: 'mapping.lua',
    source: 'function OnStart()\n  print("mapping", script.scriptMappingId)\nend',
  })
  const mappingId = added.scripts.find((script) => script.path === 'mapping.lua').guid
  const play = studio.playStart()
  assert.match(
    play.logs.map((entry) => entry.text).join('\n'),
    new RegExp(`mapping\\t${mappingId}`),
  )
  studio.playStop()
})

test('play snapshot reports script mount failures', () => {
  const studio = createStudio()
  studio.patch({
    op: 'addScript',
    controlId: 'n1',
    controlAsset: 'server-control-template',
    path: 'broken.lua',
    source: 'function broken(',
  })
  const play = studio.playStart()
  assert.match(play.mountError, /broken\.lua/)
  assert.ok(play.logs.some((entry) => entry.level === 'lua-error'))
  studio.playStop()
})

test('Tween changes are emitted by the incremental scene view', () => {
  const studio = createStudio()
  studio.patch({
    op: 'addScript',
    controlId: 'n1',
    controlAsset: 'server-control-template',
    path: 'tween-view.lua',
    source: 'function OnStart() game.Tween(script.object, { anchoredPositionX = 100 }, 1):Play() end',
  })
  const first = studio.playStart({ view: true })
  const rootNode = first.scene.nodes.find((node) => node.name === '容器节点')
  assert.ok(rootNode)
  const after = studio.playStep(0.5, { view: true, sceneRev: first.scene.revision })
  assert.ok(after.scene.changed.some((node) => node.id === rootNode.id))
  studio.playStop()
})

test('play pointer emits enter, exit and drag lifecycle with per-event delta', () => {
  const studio = createStudio()
  studio.patch({
    op: 'addScript',
    controlId: 'n1',
    controlAsset: 'server-control-template',
    path: 'pointer-events.lua',
    source: `
local function listen(button, eventType, label)
  button:AddCursorEventListener(eventType, function(data)
    local dx, dy = data:GetUIPosDelta()
    print(label, data.dragging, dx, dy)
  end)
end
function OnStart()
  script.object.showCursor = true
  local button = script.object:FindChild("预设按钮")
  listen(button, Enum.CursorEventType.CursorEnter, "enter")
  listen(button, Enum.CursorEventType.CursorExit, "exit")
  listen(button, Enum.CursorEventType.CursorBeginDrag, "begin")
  listen(button, Enum.CursorEventType.CursorDrag, "drag")
  listen(button, Enum.CursorEventType.CursorEndDrag, "end")
  listen(button, Enum.CursorEventType.CursorClick, "click")
end
`,
  })
  studio.playStart()
  studio.playPointer('move', 800, 450)
  studio.playPointer('down', 800, 450)
  studio.playPointer('move', 810, 460)
  studio.playPointer('up', 810, 460)
  const afterExit = studio.playPointer('move', -1, -1)
  const logs = afterExit.logs.map((entry) => entry.text).join('\n')
  assert.match(logs, /enter\tfalse\t0\t0/)
  assert.match(logs, /begin\tfalse\t10\t10/)
  assert.match(logs, /drag\ttrue\t10\t10/)
  assert.match(logs, /end\ttrue\t0\t0/)
  assert.match(logs, /exit\tfalse/)
  assert.doesNotMatch(logs, /click/)
  studio.playStop()
})

test('asset-package GIA exports the official three-file bundle', () => {
  const studio = createStudio()
  studio.patch({ op: 'renameSave', name: '演示包' })
  const empty = studio.exportData('save-gia')
  assert.equal(empty.format, 'qxqy-gia-package')
  assert.deepEqual(empty.files.map((file) => file.filename), [
    '演示包 · 服务器控件模板.gia',
  ])
  assert.ok(empty.warnings.some((line) => /Lua实例化面板/.test(line)))

  studio.patch({ op: 'addScript', controlId: 'n2', controlAsset: 'server-control-template', path: 'lua/a.lua', source: 'print("a")' })
  const withScript = studio.exportData('save-gia')
  assert.equal(withScript.files.length, 2)
  assert.equal(withScript.files[1].filename, '演示包 · 脚本.gia')
  assert.ok(withScript.warnings.some((line) => /挂载关系不进入 GIA/.test(line)))
  assert.ok(withScript.warnings.some((line) => /Lua实例化面板/.test(line)))

  studio.patch({ op: 'selectAsset', assetType: 'client-control-template' })
  studio.patch({ op: 'set', id: 'n2', key: 'text', value: '改过的客户端模板' })
  const full = studio.exportData('save-gia')
  assert.equal(full.files.length, 3)
  assert.deepEqual(full.files.map((file) => file.filename), [
    '演示包 · 服务器控件模板.gia',
    '演示包 · 客户端控件模板.gia',
    '演示包 · 脚本.gia',
  ])

  const target = createStudio()
  const restoredServer = target.importData('gia', full.files[0].data, full.files[0].filename)
  assert.equal(restoredServer.snapshot.asset.type, 'server-control-template')
  const restoredClient = target.importData('gia', full.files[1].data, full.files[1].filename)
  assert.equal(restoredClient.snapshot.asset.type, 'client-control-template')
  const restoredScripts = target.importData('gia', full.files[2].data, full.files[2].filename)
  assert.equal(restoredScripts.metadata.assetType, 'lua-script')
  assert.equal(restoredScripts.snapshot.scripts[0].path, 'lua/a.lua')
})

test('current-view GIA is the on-screen tree, not the factory client template', () => {
  const studio = createStudio()
  studio.patch({ op: 'renameSave', name: 'Flappy Fish' })
  studio.patch({ op: 'set', id: 'n1', key: 'name', value: 'GameRoot' })
  const current = studio.exportData('gia')
  assert.equal(current.filename, 'Flappy Fish · 服务器控件模板.gia')
  const names = []
  const walk = (node) => {
    names.push(node.name)
    for (const child of node.children || []) walk(child)
  }
  walk(studio.get().root)
  assert.ok(names.includes('GameRoot'))
  assert.equal(names.includes('Lua实例化面板'), false)

  const packed = studio.exportData('save-gia')
  assert.deepEqual(packed.files.map((file) => file.filename), [
    'Flappy Fish · 服务器控件模板.gia',
  ])
  assert.equal(packed.files.some((file) => /客户端/.test(file.filename)), false)
})

test('combined GIA keeps client templates as UIControlTemplate graphs', () => {
  const { inspectGia, validateServerGiaCompatibility } = giaCodec
  const studio = createStudio()
  studio.patch({ op: 'renameSave', name: '整合演示' })
  studio.patch({ op: 'set', id: 'n1', key: 'name', value: '服务端根' })
  studio.patch({ op: 'set', id: 'n2', key: 'text', value: '服务端标题' })
  studio.patch({ op: 'selectAsset', assetType: 'client-control-template' })
  studio.patch({ op: 'set', id: 'n2', key: 'text', value: '客户端标题' })
  studio.patch({ op: 'addScript', controlId: 'n1', controlAsset: 'server-control-template', path: 'lua/demo.lua', source: 'print("combined")' })

  const separate = studio.exportData('save-gia')
  assert.equal(separate.format, 'qxqy-gia-package')
  assert.deepEqual(separate.files.map((file) => file.filename), [
    '整合演示 · 服务器控件模板.gia',
    '整合演示 · 客户端控件模板.gia',
    '整合演示 · 脚本.gia',
  ])
  assert.match(studio.exportData('gia', 'server-control-template').filename, /服务器控件模板\.gia$/)
  assert.match(studio.exportData('gia', 'client-control-template').filename, /客户端控件模板\.gia$/)

  const combined = studio.exportData('gia-combined')
  assert.equal(combined.filename, '整合演示 · 整合包.gia')
  assert.ok(combined.warnings.some((line) => /模板边界/.test(line)))
  assert.equal(combined.warnings.some((line) => /挂载关系不进入 GIA/.test(line)), false)
  const bytes = Buffer.from(combined.data, 'base64')
  const compatibility = validateServerGiaCompatibility(bytes)
  assert.equal(compatibility.valid, true, compatibility.errors.join('\n'))
  assert.equal(compatibility.scriptCount, 1)
  const names = compatibility.controls.map((control) => control.name)
  assert.ok(names.includes('服务端根'))
  assert.ok(names.includes('文本框'))
  assert.equal(names.includes('Lua实例化面板'), false)
  const info = inspectGia(bytes)
  assert.equal(info.assetType, 'server-control-template')
  assert.equal(info.templateCount, 1)
  assert.ok(info.accessories > 11)

  const target = createStudio()
  const imported = target.importData('gia', combined.data, combined.filename)
  assert.equal(imported.snapshot.asset.type, 'server-control-template')
  const serverNames = imported.snapshot.tree.map((row) => row.name)
  assert.ok(serverNames.includes('服务端根'))
  assert.equal(serverNames.includes('Lua实例化面板'), false)
  const client = target.patch({ op: 'selectAsset', assetType: 'client-control-template' })
  const clientNames = client.tree.map((row) => row.name)
  assert.ok(clientNames.includes('Lua实例化面板'))
  assert.ok(clientNames.includes('模板标题'))
  const title = client.tree.find((row) => row.name === '模板标题')
  assert.ok(title)
  const restored = imported.snapshot.scripts.find((script) => script.path === 'lua/demo.lua')
  assert.ok(restored)
  assert.match(restored.source, /combined/)
  assert.match(String(restored.id), /^\d+$/)
  assert.equal(restored.id, String(restored.guid))
  assert.equal(restored.mounted, true)
  assert.equal(restored.controlName, '服务端根')
})
