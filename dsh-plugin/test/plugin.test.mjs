import { test } from 'node:test'
import assert from 'node:assert/strict'
import { basename, join } from 'node:path'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { SimulatorController, apply, headerWorkspace, jsonParam, lookupSessionWorkspace, sessionWorkspace } from '../lib/index.js'

const testWorkspace = fileURLToPath(new URL('../', import.meta.url)).replace(/[/\\]+$/, '')

test('controllers isolate authoring state by session', async () => {
  const a = new SimulatorController()
  const b = new SimulatorController()
  try {
    const before = a.get()
    a.patch({ op: 'set', key: 'text', value: 'SESSION-A', expectedRevision: before.version })
    const textA = a.get().root.children[0].children.find((node) => node.kind === 'textbox')
    const textB = b.get().root.children[0].children.find((node) => node.kind === 'textbox')
    assert.equal(textA.text, 'SESSION-A')
    assert.equal(textB.text, '文本')
  } finally {
    await Promise.all([a.dispose(), b.dispose()])
  }
})

test('controller exports and imports Authoring JSON and curated GIA in-process', async () => {
  const source = new SimulatorController()
  const target = new SimulatorController()
  try {
    const gia = source.exportData('gia')
    assert.equal(gia.encoding, 'base64')
    assert.match(gia.filename, /\.gia$/)
    const imported = target.importData('gia', gia.data, 'sample-ui.gia')
    assert.equal(imported.snapshot.meta.name, 'sample-ui')
    assert.equal(imported.snapshot.meta.sourceFile, 'sample-ui.gia')
    assert.deepEqual(
      [...new Set(imported.snapshot.tree.filter((row) => row.kind !== 'server-container').map((row) => row.kind))].sort(),
      ['animation', 'button', 'container', 'cursor', 'fullscreen', 'grid', 'image', 'keyhint', 'reference', 'textbox', 'textwindow'].sort(),
    )
    const json = target.exportData('json')
    assert.doesNotThrow(() => JSON.parse(Buffer.from(json.data, 'base64').toString('utf8')))
  } finally {
    await Promise.all([source.dispose(), target.dispose()])
  }
})

test('controller exports and imports client control template GIA as a distinct asset type', async () => {
  const source = new SimulatorController()
  const target = new SimulatorController()
  try {
    const created = source.patch({ op: 'newAsset', assetType: 'client-control-template' })
    assert.equal(created.asset.type, 'client-control-template')
    assert.equal(created.asset.templateCount, 1)
    const gia = source.exportData('gia')
    assert.equal(gia.filename, '未命名存档 · 客户端控件模板.gia')
    const imported = target.importData('gia', gia.data, gia.filename)
    assert.equal(imported.snapshot.asset.type, 'client-control-template')
    assert.equal(imported.snapshot.asset.templateCount, 1)
    assert.equal(imported.snapshot.tree[0].name, 'Lua实例化面板')
    assert.equal(imported.snapshot.tree[0].depth, 0)
  } finally {
    await Promise.all([source.dispose(), target.dispose()])
  }
})

test('save keeps server UI, client templates and Lua together while supporting separate exports', async () => {
  const source = new SimulatorController()
  const target = new SimulatorController()
  try {
    let snapshot = source.get()
    source.patch({ op: 'set', id: 'n2', key: 'text', value: '存档服务端文本', expectedRevision: snapshot.version })
    snapshot = source.patch({ op: 'addScript', controlId: 'n1', path: 'lua/server-main.lua', source: 'print("save-server-script")' })
    snapshot = source.patch({ op: 'selectAsset', assetType: 'client-control-template', expectedRevision: snapshot.version })
    source.patch({ op: 'set', id: 'n2', key: 'text', value: '存档客户端模板', expectedRevision: snapshot.version })
    source.patch({ op: 'addScript', path: 'lua/template.lua', source: 'print("save-template-script")' })
    source.patch({ op: 'updateScript', id: snapshot.scripts[0].id, controlId: 'n1' })
    source.patch({
      op: 'setServerLogic',
      logic: {
        rules: [{
          signalName: 'EarnGold',
          actions: [{ kind: 'setCustomVariable', entityType: 'PlayerSelf', name: 'Gold', value: { fromSignalParam: 0 } }],
        }],
      },
    })

    const saveFile = source.exportData('save')
    const save = JSON.parse(Buffer.from(saveFile.data, 'base64').toString('utf8'))
    assert.equal(save.format, 'qxqy-simulator-save')
    assert.equal(save.version, 4)
    assert.equal(save.serverLogic.rules[0].signalName, 'EarnGold')
    assert.equal(save.assets.server.root.children[0].children.find((node) => node.id === 'n2').text, '存档服务端文本')
    assert.equal(save.assets.client.root.children[0].children.find((node) => node.id === 'n2').text, '存档客户端模板')
    assert.equal(save.assets.scripts.length, 2)
    assert.ok(save.assets.scripts.some((script) => script.path === 'lua/server-main.lua'))
    assert.ok(save.assets.scripts.some((script) => script.path === 'lua/template.lua'))

    const restored = target.importData('json', saveFile.data, saveFile.filename).snapshot
    assert.equal(restored.save.format, 'qxqy-simulator-save')
    assert.equal(restored.asset.type, 'client-control-template')
    assert.equal(restored.scripts.length, 2)
    assert.equal(restored.scripts[0].mounted, true)
    assert.equal(restored.serverLogic.rules[0].actions[0].name, 'Gold')
    const server = target.patch({ op: 'selectAsset', assetType: 'server-control-template' })
    assert.equal(server.root.children[0].children.find((node) => node.id === 'n2').text, '存档服务端文本')
    assert.equal(server.scripts.some((script) => script.path === 'lua/server-main.lua' && script.mounted), true)

    assert.match(source.exportData('gia', 'server-control-template').filename, /服务器控件模板\.gia$/)
    assert.match(source.exportData('gia', 'client-control-template').filename, /客户端控件模板\.gia$/)
    const bundle = JSON.parse(Buffer.from(source.exportData('scripts').data, 'base64').toString('utf8'))
    assert.equal(bundle.format, 'qxqy-simulator-scripts')
    assert.equal(bundle.scripts.length, 2)
    const scriptGia = source.exportData('scripts-gia')
    assert.equal(scriptGia.filename, '未命名存档 · 脚本.gia')
    assert.ok(scriptGia.warnings.some((line) => /挂载关系不进入 GIA/.test(line)))
    const giaTarget = new SimulatorController()
    try {
      const viaGia = giaTarget.importData('gia', scriptGia.data, scriptGia.filename)
      assert.equal(viaGia.metadata.assetType, 'lua-script')
      assert.equal(viaGia.snapshot.scripts.length, 2)
      assert.equal(viaGia.snapshot.scripts.every((script) => script.mounted === false), true)
    } finally {
      await giaTarget.dispose()
    }
    const firstScript = source.get().scripts[0]
    assert.equal(Buffer.from(source.exportData('lua', firstScript.id).data, 'base64').toString('utf8'), 'print("save-server-script")')

    source.patch({
      op: 'addScript',
      controlId: 'n1',
      path: 'inline',
      source: 'function OnStart()\n  local c = game.InstantiateClientUIControl(1073742100, script.object)\n  print("save-template-registered", c ~= nil)\nend',
    })
    const played = await source.play('start')
    assert.match(played.logs.map((entry) => entry.text).join('\n'), /save-template-registered\ttrue/)
    await source.play('stop')
  } finally {
    await Promise.all([source.dispose(), target.dispose()])
  }
})

test('lua scripts are an archive-level asset with mount validation and unmount fallback', async () => {
  const controller = new SimulatorController()
  try {
    const added = controller.patch({ op: 'addScript', path: 'lua/a.lua', source: 'print("a")' })
    assert.equal(added.scripts.length, 1)
    const scriptId = added.scripts[0].id
    assert.equal(added.scripts[0].mounted, false)
    const mounted = controller.patch({ op: 'updateScript', id: scriptId, controlId: 'n2', controlAsset: 'server-control-template' })
    assert.equal(mounted.scripts[0].mounted, true)
    assert.equal(mounted.scripts[0].controlName, '文本框')
    assert.throws(() => controller.patch({ op: 'updateScript', id: scriptId, controlId: 'sc1' }), /挂载目标/)
    const unmounted = controller.patch({ op: 'updateScript', id: scriptId, controlId: '' })
    assert.equal(unmounted.scripts[0].mounted, false)
    const remounted = controller.patch({ op: 'updateScript', id: scriptId, controlId: 'n2', controlAsset: 'server-control-template' })
    assert.equal(remounted.scripts[0].mounted, true)
    controller.patch({ op: 'select', id: 'n2' })
    const removed = controller.patch({ op: 'remove' })
    assert.equal(removed.scripts[0].mounted, false)
    const afterRemove = controller.patch({ op: 'removeScript', id: scriptId })
    assert.equal(afterRemove.scripts.length, 0)
    assert.throws(() => controller.exportData('lua', scriptId), /没有可导出的 Lua 脚本/)
  } finally {
    await controller.dispose()
  }
})

test('controller edits business fields and preserves their GIA values across import-export', async () => {
  const source = new SimulatorController()
  const target = new SimulatorController()
  try {
    source.patch({ op: 'set', id: 'n10', key: 'animationId', value: 'controller-effect-index' })
    source.patch({ op: 'set', id: 'n4', key: 'referencedPrefabId', value: 'controller-template-index' })
    source.patch({ op: 'set', id: 'n9', key: 'fillType', value: 'Radial90' })
    const exported = source.exportData('gia')
    const imported = target.importData('gia', exported.data, exported.filename).snapshot
    const findKind = (node, kind) => {
      if (node.kind === kind) return node
      for (const child of node.children || []) {
        const found = findKind(child, kind)
        if (found) return found
      }
      return null
    }
    assert.equal(findKind(imported.root, 'animation').animationId, 'controller-effect-index')
    assert.equal(findKind(imported.root, 'reference').referencedPrefabId, 'controller-template-index')
    assert.equal(findKind(imported.root, 'image').giaRaw.imageFillType, 3)
  } finally {
    await Promise.all([source.dispose(), target.dispose()])
  }
})

test('persistent play worker accepts pointer input and returns runtime snapshot', async () => {
  const controller = new SimulatorController()
  try {
    let snap = controller.get()
    snap = controller.patch({
      op: 'addScript',
      controlId: 'n1',
      expectedRevision: snap.version,
      path: 'inline',
      source: `
function OnStart()
  script.object.showCursor = true
  local button = script.object:FindChild("预设按钮")
  button:AddCursorEventListener(Enum.CursorEventType.CursorClick, function()
    print("worker-click")
  end)
end
`,
    })
    const started = await controller.play('start')
    assert.equal(started.running, true)
    const paused = await controller.play('pause')
    assert.equal(paused.paused, true)
    const resumed = await controller.play('resume')
    assert.equal(resumed.paused, false)
    await controller.play('pointer', { type: 'down', x: 800, y: 450 })
    const down = await controller.play('get', { inspect: true })
    assert.equal(down.tree[0].children.find((node) => node.kind === 'button').pressed, true)
    const up = await controller.play('pointer', { type: 'up', x: 800, y: 450 })
    assert.match(up.logs.map((entry) => entry.text).join('\n'), /worker-click/)
    const stopped = await controller.play('stop')
    assert.equal(stopped.running, false)
  } finally {
    await controller.dispose()
  }
})

test('worker keeps OnUpdate running while Lua level time is paused', async () => {
  const controller = new SimulatorController()
  try {
    const snap = controller.get()
    controller.patch({
      op: 'addScript',
      controlId: 'n1',
      expectedRevision: snap.version,
      path: 'level-pause',
      source: `
function OnStart()
  script:EnableUpdate(true)
  game.PauseLevelTime(true)
end
function OnUpdate() print("level-pause-update") end
function OnLevelUpdate() print("level-pause-level-update") end
`,
    })
    const started = await controller.play('start')
    assert.equal(started.paused, false)
    assert.equal(started.levelTimePaused, true)
    await new Promise((resolve) => setTimeout(resolve, 180))
    const after = await controller.play('get')
    assert.ok(after.frame > started.frame)
    const logs = after.logs.map((entry) => entry.text).join('\n')
    assert.match(logs, /level-pause-update/)
    assert.doesNotMatch(logs, /level-pause-level-update/)
  } finally {
    await controller.dispose()
  }
})

test('play worker records history and can set a server variable', async () => {
  const controller = new SimulatorController()
  try {
    let snap = controller.get()
    controller.patch({
      op: 'addScript',
      controlId: 'n1',
      expectedRevision: snap.version,
      path: 'inline',
      source: `
function OnStart()
  script:RegisterCustomVariableChangedHandler(Enum.CustomVariableEntityType.Level, "Wave", function(entityType, varName)
    print("wave", game.GetGlobalCustomVariableValue(entityType, varName))
  end)
end
`,
    })
    await controller.play('start')
    const afterSet = await controller.play('serverSet', { entityType: 'Level', name: 'Wave', value: 2 })
    assert.equal(afterSet.server.vars.Level.Wave.value, 2)
    assert.match(afterSet.logs.map((entry) => entry.text).join('\n'), /wave\t2/)
    const history = await controller.play('history')
    assert.ok(history.events.some((row) => row.kind === 'serverSet' && row.payload.name === 'Wave'))
    const report = await controller.play('runCase', {
      case: {
        name: 'wave-set',
        events: [{ t: 0, kind: 'serverSet', payload: { entityType: 'Level', name: 'Wave', value: 2 } }],
        asserts: [{ kind: 'var', entityType: 'Level', name: 'Wave', equals: 2 }],
      },
    })
    assert.equal(report.passed, true)
  } finally {
    await controller.dispose()
  }
})

test('controller renders play screenshots from Runtime paint without a browser page', async () => {
  const controller = new SimulatorController()
  try {
    await controller.play('start', { canvasId: 'mobile-16-9' })
    const captured = await controller.requestScreenshot()
    assert.equal(captured.canvasId, 'mobile-16-9')
    assert.equal(captured.width, 1280)
    assert.equal(captured.height, 720)
    assert.equal(captured.pixelWidth, 1280)
    assert.equal(captured.pixelHeight, 720)
    assert.equal(captured.data.subarray(1, 4).toString('ascii'), 'PNG')
    assert.ok(captured.data.length > 200)
  } finally {
    await controller.dispose()
  }
})

test('controller renders editor screenshots from boxes without the simulator tab', async () => {
  const controller = new SimulatorController()
  try {
    const captured = controller.requestUiScreenshot()
    assert.equal(captured.page, 'UI 编辑')
    assert.equal(captured.width, 1600)
    assert.equal(captured.height, 900)
    assert.equal(captured.data.subarray(1, 4).toString('ascii'), 'PNG')
    assert.ok(captured.data.length > 200)
  } finally {
    await controller.dispose()
  }
})

test('plugin registers screenshot capture, API and standalone Pixi play routes, and cleanup effect', () => {
  const tools = []
  const routes = []
  const effects = []
  const ctx = {
    tools: { register(tool) { tools.push(tool) } },
    webServer: { register(route) { routes.push(route) } },
    effect(factory) { effects.push(factory) },
  }
  apply(ctx)
  assert.deepEqual(tools.map((tool) => tool.name), [
    'qxqy_studio_get',
    'qxqy_studio_play_screenshot',
    'qxqy_studio_ui_screenshot',
    'qxqy_studio_patch',
    'qxqy_studio_play',
    'qxqy_studio_load',
  ])
  assert.equal(routes[0].path, '/qxqy-simulator/api')
  assert.equal(routes[1].path, '/qxqy-simulator/play')
  assert.equal(routes[2].path, '/qxqy-simulator/play-renderer.js')
  const headers = {}
  let body = ''
  const response = {
    statusCode: 0,
    setHeader(name, value) { headers[name] = value },
    end(value) { body = value || '' },
  }
  routes[1].handler({ method: 'GET', url: '/qxqy-simulator/play' }, response)
  assert.equal(response.statusCode, 200)
  assert.match(headers['content-type'], /text\/html/)
  assert.match(body, /千星沙箱 · 独立试玩/)
  assert.match(body, /height:100%/)
  assert.match(body, /body\[data-theme=light\]/)
  assert.match(body, /data-view="play"/)
  assert.match(body, /data-view="log"/)
  assert.match(body, /客户端脚本日志/)
  assert.match(body, /服务端日志/)
  assert.match(body, /id="serverLog"/)
  assert.match(body, /服务端变量/)
  assert.match(body, /id="serverVars"/)
  assert.match(body, /id="playerCountSel"/)
  assert.match(body, /id="playerViewSel"/)
  assert.match(body, /保存用例/)
  assert.match(body, /回放用例/)
  assert.match(body, /createPlaySession/)
  assert.match(body, /play\.act\('step'/)
  assert.match(body, /id="cv" class="stage-canvas"/)
  assert.match(body, /type="module"/)
  assert.match(body, /PixiPlayRenderer/)
  assert.doesNotMatch(body, /play-capture/)
  assert.doesNotMatch(body, /captureRequest/)
  assert.doesNotMatch(body, /getContext\('2d'\)/)
  const loop = readFileSync(new URL('../../studio/play/browser-session.js', import.meta.url), 'utf8')
  assert.match(loop, /light: true/)
  assert.match(loop, /view: true/)
  assert.match(loop, /PLAY_POLL_INTERVAL_MS = 33/)
  assert.match(loop, /renderer\.render\(next\.paint/)
  assert.doesNotMatch(body, /\.innerHTML\s*=/)
  assert.doesNotMatch(body, /试玩流程|flow-step|<span>编辑<\/span>/)
  const scriptStart = body.indexOf('<script type="module">') + '<script type="module">'.length
  const scriptEnd = body.lastIndexOf('</script>')
  assert.ok(scriptStart >= '<script>'.length && scriptEnd > scriptStart)
  assert.doesNotThrow(() => new Function(body.slice(scriptStart, scriptEnd).replace(/^\s*import[^\n]+\n/, '')))
  const rendererHeaders = {}
  let rendererBody = ''
  routes[2].handler({ method: 'GET', url: '/qxqy-simulator/play-renderer.js' }, {
    statusCode: 0,
    setHeader(name, value) { rendererHeaders[name] = value },
    end(value) { rendererBody = value || '' },
  })
  assert.match(rendererHeaders['content-type'], /text\/javascript/)
  assert.match(rendererBody, /WebGL/)
  assert.equal(effects.length, 1)
})

test('client bundle parses and includes editor-grade controls and workflow', () => {
  const source = readFileSync(new URL('../../editor-ui/index.js', import.meta.url), 'utf8')
  assert.doesNotThrow(() => new Function(readFileSync(new URL('../dist/client.js', import.meta.url), 'utf8')))
  let clientModule
  new Function('window', readFileSync(new URL('../dist/client.js', import.meta.url), 'utf8'))({ __ModuleLoader__: { load: value => { clientModule = value } } })
  const exports = clientModule.factory(name => { assert.equal(name, 'react'); return { createElement() {} } })
  assert.deepEqual(exports.inject, ['slots'])
  assert.equal(typeof exports.apply, 'function')
  assert.match(source, /field\.type === 'color'/)
  assert.match(source, /field\.type === 'enum'/)
  assert.match(source, /e\('input', \{ type: 'color'/)
  assert.match(source, /aria-label': '画布缩放'/)
  assert.match(source, /hiddenCanvasIds/)
  assert.match(source, /toggleCanvasVisible/)
  assert.match(source, /qxsim-eye/)
  assert.match(source, /画布可见性/)
  assert.doesNotMatch(source, /qxsim-canvas-vis/)
  // 多设备编辑：设备分段按钮 + 屏幕比例下拉 + 适应缩放。
  assert.match(source, /qxsim-device-switch/)
  assert.match(source, /'aria-label': '目标设备'/)
  assert.match(source, /'aria-label': '屏幕比例'/)
  assert.match(source, /\['fit', '适应'\]/)
  // 工具栏防重叠：中栏控件与 IO 下拉都有硬宽度上限，窄容器再收缩。
  assert.match(source, /\.qxsim-control\.ratio\{width:150px/)
  assert.match(source, /\.qxsim-io \.qxsim-control\{width:118px/)
  assert.match(source, /\.qxsim-toolbar-center\{min-width:0\}/)
  assert.match(source, /ResizeObserver/)
  assert.match(source, /function presetRatio/)
  assert.match(source, /qxsim-platform-tag/)
  assert.match(source, /function switchDevice/)
  assert.match(source, /snap\.canvas\.platform === groupKey/)
  assert.doesNotMatch(source, /'aria-label': '画布设备'/)
  assert.match(source, /\.qxsim\[data-theme=dark\]/)
  assert.match(source, /\.qxsim\[data-theme=light\]/)
  assert.match(source, /height:100%;min-width:0;min-height:0;max-height:none/)
  assert.doesNotMatch(source, /100dvh/)
  assert.match(source, /window\.open\('about:blank', '_blank'\)/)
  assert.match(source, /playUrl\(sessionId\)/)
  assert.match(readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8'), /\/qxqy-simulator\/play#/)
  assert.doesNotMatch(source, /function captureEditorScreenshot/)
  assert.doesNotMatch(source, /useUiScreenshotCapture/)
  assert.doesNotMatch(source, /ui-capture-poll/)
  assert.doesNotMatch(source, /ui-capture-submit/)
  assert.doesNotMatch(source, /<foreignObject/)
  assert.match(source, /工作区未绑定/)
  assert.match(source, /工作区：\$\{snap\.workspace\?\.bound \? snap\.workspace\.name : '未绑定'\}/)
  assert.match(source, /导入存档、单项 UI 资产或 Lua/)
  assert.match(source, /从工作区拉取存档/)
  assert.match(source, /load-archive/)
  assert.match(source, /archives/)
    assert.match(source, /资产包 JSON（三类合一）/)
  assert.match(source, /资产包 GIA（已改动项）/)
    assert.match(source, /资产包 GIA 整合包（控件\+脚本）/)
  assert.match(source, /当前界面 GIA/)
    assert.match(source, /脚本包 JSON（全部脚本）/)
    assert.match(source, /脚本包 GIA（全部脚本）/)
  assert.match(source, /UI控件-服务端/)
  assert.match(source, /UI控件-客户端/)
  assert.match(source, /UI 编辑/)
  assert.match(source, /Lua 脚本/)
  assert.match(source, /服务端逻辑/)
  assert.match(source, /setServerLogic/)
  assert.match(source, /设置自定义变量/)
  assert.match(source, /发送客户端脚本信号/)
  assert.match(source, /PLAYER_LOGIC_TARGETS/)
  assert.match(source, /AllPlayers 全部玩家/)
  assert.match(source, /Player1 玩家1/)
  assert.match(source, /function ServerLogicPage/)
  assert.match(source, /leavePage\('logic'\)/)
  assert.match(source, /客户端控件模板/)
  assert.match(source, /addTemplate/)
  assert.match(source, /Lua 模板预览/)
  assert.match(source, /prefabId/)
  assert.match(source, /addScript/)
  assert.match(source, /updateScript/)
  assert.match(source, /removeScript/)
  assert.match(source, /新建脚本并挂载到此控件/)
  assert.match(source, /挂载已有脚本/)
  assert.match(source, /mountScriptTo/)
  const qualifiedMountValues = source.split('value: `${row.assetType}|${row.id}`').length - 1
  assert.ok(qualifiedMountValues >= 2, '挂载下拉 option 值必须带 assetType|id 前缀')
  assert.match(source, /'脚本'/)
  assert.doesNotMatch(source, /服务端 UI 客户端脚本|服务端lua|服务端 Lua/)
  assert.doesNotMatch(source, /op: 'setScript'/)
  assert.match(source, /unavailableChildId/)
  assert.match(source, /field\?\.type === 'node'/)
  assert.match(source, /全屏动效/)
  assert.match(source, /未识别选项.*保留原值/)
  assert.match(source, /animation: \['animationId'\]/)
  assert.match(source, /reference: \['referencedPrefabId'\]/)
  assert.doesNotMatch(source, /原始 GIA 字段|RAW|field\.raw|field\.wire|protocolNote/)
  assert.match(source, /field\.value \|\| field\.label/)
  assert.doesNotMatch(source, /field\.type === 'note'[^\n]+暂不支持/)
  assert.doesNotMatch(source, /推断字段|未知字段，只读|GIA 已验证|协议边界|兼容性提示/)
  const size = source.indexOf("f.width ? e(Pair")
  const rotation = source.indexOf("f.rotationZ ? e(DraftField")
  const anchors = source.indexOf("f.anchorType ? e(DraftField")
  assert.ok(size >= 0 && size < rotation && rotation < anchors)
  assert.doesNotMatch(source, /\.qxsim-stage-wrap[^}]*background:#101521/)
})

test('host tool runtime is supplied by Harness instead of bundled twice', () => {
  const manifest = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
  assert.equal(manifest.dependencies?.['@deepseek-ai/dsh-tools'], undefined)
  assert.match(manifest.peerDependencies?.['@deepseek-ai/dsh-tools'] || '', /0\.1\.0-rc\.6/)
  assert.equal(manifest.devDependencies?.['@deepseek-ai/dsh-tools'], '0.1.0-rc.6')
})

test('sessionWorkspace reads the DSH session header cwd and tolerates missing context', () => {
  const exec = { agent: { id: 'agent-1', session: { header: { cwd: testWorkspace } } } }
  assert.equal(sessionWorkspace(exec), testWorkspace)
  assert.equal(headerWorkspace({ cwd: testWorkspace }), testWorkspace)
  assert.equal(sessionWorkspace({ agent: { id: 'agent-1' } }), '')
  assert.equal(sessionWorkspace({ agent: { id: 'agent-1', session: { header: {} } } }), '')
  assert.equal(sessionWorkspace({}), '')
  assert.equal(sessionWorkspace(), '')
})

test('lookupSessionWorkspace prefers the live session then persistence inspect', async () => {
  assert.equal(await lookupSessionWorkspace('s1', {
    sessions: { get: () => ({ header: { cwd: testWorkspace } }) },
  }), testWorkspace)
  assert.equal(await lookupSessionWorkspace('s1', {
    sessions: { get: () => undefined },
    sessionPersistence: { inspect: async () => ({ meta: { cwd: 'E:\\from-disk' } }) },
  }), 'E:\\from-disk')
  assert.equal(await lookupSessionWorkspace('s1', {
    sessionPersistence: { inspect: async () => { throw new Error('missing') } },
  }), '')
  assert.equal(await lookupSessionWorkspace('s1', {}), '')
})

test('editor HTTP get binds the live session cwd instead of the host startup directory', async () => {
  const routes = []
  const ctx = {
    tools: { register() {} },
    webServer: { register(route) { routes.push(route) } },
    effect() {},
    get(name) {
      if (name === 'sessions') {
        return { get: () => ({ header: { cwd: testWorkspace } }) }
      }
      return undefined
    },
  }
  apply(ctx)
  const api = routes.find((route) => route.path === '/qxqy-simulator/api')
  const chunks = [Buffer.from(JSON.stringify({ sessionId: 'sess-http' }))]
  const request = {
    method: 'POST',
    url: '/qxqy-simulator/api/get',
    on(event, listener) {
      if (event === 'data') queueMicrotask(() => listener(chunks[0]))
      if (event === 'end') queueMicrotask(() => listener())
      return request
    },
    once() { return request },
    destroy() {},
  }
  const headers = {}
  let body = ''
  await new Promise((resolve) => {
    api.handler(request, {
      statusCode: 0,
      setHeader(name, value) { headers[name] = value },
      end(value) { body = value || ''; resolve() },
    })
  })
  const payload = JSON.parse(body)
  assert.equal(payload.ok, true)
  assert.equal(payload.value.workspace.bound, true)
  assert.equal(payload.value.workspace.name, basename(testWorkspace))
  assert.equal(payload.value.workspace.path, testWorkspace)
  assert.equal(payload.value.save.name, '未命名存档')
})

test('controller adopts the session workspace without renaming the save', async () => {
  const unbound = new SimulatorController()
  const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
  const controller = new SimulatorController(repoRoot)
  try {
    assert.equal(unbound.get().workspace.bound, false)
    assert.equal(unbound.get().workspace.name, '未绑定')
    assert.equal(unbound.get().save.name, '未命名存档')

    const snap = controller.get()
    assert.equal(snap.workspace.bound, true)
    assert.equal(snap.workspace.path.replace(/[/\\]+$/, ''), repoRoot.replace(/[/\\]+$/, ''))
    assert.equal(snap.save.name, '未命名存档')
    controller.studio.setWorkspace(join(testWorkspace, 'definitely-not-a-repo'))
    const moved = controller.get()
    assert.equal(moved.workspace.name, 'definitely-not-a-repo')
    assert.equal(moved.save.name, '未命名存档')
  } finally {
    await Promise.all([unbound.dispose(), controller.dispose()])
  }
})

test('jsonParam accepts objects and JSON strings and rejects garbage', () => {
  assert.deepEqual(jsonParam({ a: 1 }), { a: 1 })
  assert.deepEqual(jsonParam('{"a":1}'), { a: 1 })
  assert.equal(jsonParam('not-json'), undefined)
  assert.equal(jsonParam(undefined), undefined)
  assert.equal(jsonParam(null), undefined)
})

test('play device action switches device canvas mid-session and rejects unknown presets', async () => {
  const controller = new SimulatorController()
  try {
    const started = await controller.play('start', { canvasId: 'mobile-16-9' })
    assert.equal(started.canvasId, 'mobile-16-9')
    assert.equal(started.platform, 'TOUCHSCREEN')
    assert.equal(started.device, 'Mobile')
    assert.equal(started.canvasWidth, 1280)
    assert.equal(started.canvasHeight, 720)

    // 暂停后手动步进，得到确定的旧时钟；随后切设备必须重置生命周期。
    await controller.play('pause')
    for (let i = 0; i < 5; i++) await controller.play('step', { dt: 1 / 30, light: true })
    const switched = await controller.play('device', { canvasId: 'pc-21-9' })
    assert.equal(switched.canvasId, 'pc-21-9')
    assert.equal(switched.platform, 'KEYBOARD')
    assert.equal(switched.canvasWidth, 2100)
    assert.equal(switched.canvasHeight, 900)
    assert.ok(switched.time < 0.08, `device switch must reset engine time, got ${switched.time}`)

    await assert.rejects(() => controller.play('device', { canvasId: 'ipad-13' }), /unknown canvas preset/)
    await assert.rejects(() => controller.play('device', {}), /unknown canvas preset/)

    // 试玩设备只影响试玩运行时，编辑器正在编辑的画布保持不变。
    assert.equal(controller.get().canvasId, 'pc-16-9')

    // start 同样接受 canvasId（页面「重新开始」保留当前设备）。
    const restarted = await controller.play('start', { canvasId: 'mobile-19.5-9' })
    assert.equal(restarted.canvasId, 'mobile-19.5-9')
    assert.equal(restarted.canvasWidth, 1560)
    await controller.play('stop', {})
  } finally {
    await controller.dispose()
  }
})
