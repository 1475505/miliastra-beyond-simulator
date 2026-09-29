import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { createRuntime } from '../src/index.js'

function logText(rt) {
  return rt.logs.map((l) => l.text).join('\n')
}

test('sandbox: no io, require missing fails, bitwise and // work', () => {
  const rt = createRuntime()
  const root = rt.addRoot({ active: true,  name: 'R', kind: 'container' })
  rt.mountScript({
    path: 't',
    control: root,
    source: `
function OnStart()
  print("_VERSION", _VERSION)
  print("io", io)
  print("package", package)
  print("div", 5 // 2)
  print("band", 3 & 1)
  local ok, err = pcall(require, "os")
  print("require_os", ok, err)
end
`,
  })
  const t = logText(rt)
  assert.match(t, /_VERSION\tnil/)
  assert.match(t, /io\tnil/)
  assert.match(t, /package\tnil/)
  assert.match(t, /div\t2/)
  assert.match(t, /band\t1/)
  assert.match(t, /failed to load script 'os'/)
})

test('game dot functions reject the implicit argument from colon calls', () => {
  const rt = createRuntime()
  const root = rt.addRoot({ active: true, name: 'Root', kind: 'container' })
  rt.mountScript({ path: 'game-arity', control: root, source: `
function OnStart()
  local okRoots, roots = pcall(game.GetClientUIRoots)
  print('roots-dot', okRoots, #roots)
  local okCanvas, w, h = pcall(game.GetUICanvasSize)
  print('canvas-dot', okCanvas, w, h)
  local okColonRoots, errRoots = pcall(function() return game:GetClientUIRoots() end)
  print('roots-colon', okColonRoots, errRoots)
  local okColonCanvas, errCanvas = pcall(function() return game:GetUICanvasSize() end)
  print('canvas-colon', okColonCanvas, errCanvas)
  local okColonFind, errFind = pcall(function() return game:FindClientUIRoot('Root') end)
  print('find-colon', okColonFind, errFind)
end` })
  const output = logText(rt)
  assert.match(output, /roots-dot\ttrue\t1/)
  assert.match(output, /canvas-dot\ttrue\t1600\t900/)
  assert.match(output, /roots-colon\tfalse\t[^\n]*bad argument count to 'GetClientUIRoots' \(0 expected, got 1\)/)
  assert.match(output, /canvas-colon\tfalse\t[^\n]*bad argument count to 'GetUICanvasSize' \(0 expected, got 1\)/)
  assert.match(output, /find-colon\tfalse\t[^\n]*bad argument count to 'FindClientUIRoot' \(1 expected, got 2\)/)
})

test('sandbox matches the official client capability cuts', () => {
  const rt = createRuntime()
  const root = rt.addRoot({ active: true, name: 'R', kind: 'container' })
  rt.mountScript({
    path: 'sandbox-cuts',
    control: root,
    source: `
function OnStart()
  print("version", _VERSION)
  print("load", load)
  print("pack", string.pack, string.unpack)
  print("gc", collectgarbage)
  print("math_cuts", type(math.modf), type(math.ult))
  print("typeof_table", typeof({}))
  local ok, upper = pcall(function() return ("x"):upper() end)
  print("string_meta", getmetatable("x") == nil, ok, upper)
end
`,
  })
  const t = logText(rt)
  assert.match(t, /version\tnil/)
  assert.match(t, /load\tnil/)
  assert.match(t, /pack\tnil\tnil/)
  assert.match(t, /gc\tnil/)
  assert.match(t, /math_cuts\tfunction\tfunction/)
  assert.match(t, /typeof_table\ttable/)
  assert.match(t, /string_meta\ttrue\ttrue\tX/)
})

test('GetParam keeps types; Color packs; typeof Script', () => {
  const rt = createRuntime()
  const root = rt.addRoot({ active: true,  name: 'R', kind: 'container' })
  rt.mountScript({
    path: 't',
    control: root,
    params: { stringParam: 'hello', intParam: 42, floatParam: 3.5, boolParam: true },
    source: `
function OnStart()
  print("typeof_script", typeof(script))
  print("s", script:GetParam("stringParam"), type(script:GetParam("stringParam")))
  print("i", script:GetParam("intParam"), math.type(script:GetParam("intParam")))
  print("f", script:GetParam("floatParam"), math.type(script:GetParam("floatParam")))
  print("b", script:GetParam("boolParam"), type(script:GetParam("boolParam")))
  print("missing", script:GetParam("nope"))
  local c = Color(10, 20, 30, 40)
  local r,g,b,a = Color.ToRGBA(c)
  print("rgba", r, g, b, a)
  print("eq", Enum.EaseType.Linear == Enum.EaseType.Linear, Enum.EaseType.Linear == Enum.EaseType.InSine)
end
`,
  })
  const t = logText(rt)
  assert.match(t, /typeof_script\tScript/)
  assert.match(t, /s\thello\tstring/)
  assert.match(t, /i\t42\tinteger/)
  assert.match(t, /f\t3\.5\tfloat/)
  assert.match(t, /b\ttrue\tboolean/)
  assert.match(t, /missing\tnil/)
  assert.match(t, /rgba\t10\t20\t30\t40/)
  assert.match(t, /eq\ttrue\tfalse/)
})

test('script.path preserves mapping directories, including the device import prefix', () => {
  // The device report retains default_import_file/ in script.path. The other
  // cases pin the pre-af397ac separator/extension normalization policy.
  for (const [path, expectedPath] of [
    ['levelScript.lua', 'levelScript'],
    ['default_import_file/levelScript', 'default_import_file/levelScript'],
    ['default_import_file/levelScript.lua', 'default_import_file/levelScript'],
    ['workspace\\path\\Example.lua', 'workspace/path/Example'],
  ]) {
    const rt = createRuntime()
    try {
      const root = rt.addRoot({ active: true, name: 'R', kind: 'container' })
      rt.mountScript({
        path,
        control: root,
        params: { expectedPath },
        source: `function OnStart()
          assert(script.path == script:GetParam('expectedPath'), 'unexpected script path: ' .. script.path)
          assert(script.object:GetScriptByPath(script.path) == script)
        end`,
      })
      assert.deepEqual(rt.mountErrors, [], path)
    } finally {
      rt.destroy()
    }
  }
})

test('GetScriptByPath distinguishes mounted scripts with the same basename', () => {
  const rt = createRuntime()
  try {
    const root = rt.addRoot({ active: true, name: 'R', kind: 'container' })
    for (const directory of ['one', 'two']) {
      rt.mountScript({
        path: `${directory}/Example.lua`,
        control: root,
        source: `function OnStart()
          assert(script.object:GetScriptByPath('${directory}/Example') == script)
          assert(script.object:GetScriptByPath('Example') == nil)
        end`,
      })
    }
    assert.deepEqual(rt.mountErrors, [])
    assert.notEqual(root.GetScriptByPath('one/Example'), root.GetScriptByPath('two/Example'))
  } finally {
    rt.destroy()
  }
})

test('Instantiate nil in OnInit, object in OnStart; FindChild path', () => {
  const rt = createRuntime()
  const root = rt.addRoot({ active: true,
    name: '容器节点',
    kind: 'container',
    children: [
      { name: 'ProbeChild', kind: 'container', children: [{ name: 'ProbeNestedText', kind: 'textbox' }] },
      { name: 'ProbeText', kind: 'textbox', sizeDeltaX: 100, sizeDeltaY: 40 },
    ],
  })
  rt.registerTemplate(1073741894, { kind: 'image', name: '图片', sizeDeltaX: 80, sizeDeltaY: 80 })
  rt.mountScript({
    path: 't',
    control: root,
    params: { templatePrefabId: 1073741894 },
    source: `
local initRet, startRet
function OnInit()
  initRet = game.InstantiateClientUIControl(script:GetParam("templatePrefabId"), script.object)
end
function OnStart()
  startRet = game.InstantiateClientUIControl(script:GetParam("templatePrefabId"), script.object)
  print("init_nil", initRet == nil)
  print("start_type", typeof(startRet), startRet.name, startRet.sizeDeltaX)
  local n = script.object:FindChild("ProbeChild/ProbeNestedText")
  print("nested", n.name)
  print("direct_miss", script.object:GetChild("ProbeNestedText") == nil)
end
`,
  })
  const t = logText(rt)
  assert.match(t, /init_nil\ttrue/)
  assert.match(t, /start_type\tClientUIImageControl\t图片\t80/)
  assert.match(t, /nested\tProbeNestedText/)
  assert.match(t, /direct_miss\ttrue/)
})

test('require path cache independent env no lifecycle', () => {
  const rt = createRuntime()
  const root = rt.addRoot({ active: true,  name: 'R', kind: 'container' })
  rt.registerScriptFile('mods/probe_mod', `
print("mod.chunk", script.path, script.scriptMappingId)
_G.__probe_mod_loads = (_G.__probe_mod_loads or 0) + 1
function OnStart() print("mod.OnStart") end
return { marker = "probe_mod", ping = function() return "pong" end }
`)
  rt.mountScript({
    path: 'probe_round2',
    control: root,
    source: `
function OnStart()
  local a = require("mods/probe_mod.lua")
  local b = require("mods\\\\probe_mod")
  local c = require("mods/probe_mod")
  local d = require("default_import_file/mods/probe_mod")
  print("marker", c.marker, c.ping())
  print("same", a == c)
  print("default-import-marker", d.marker)
  print("g", _G.__probe_mod_loads)
  local ok, err = pcall(require, "mods/does_not_exist")
  print("missing", err)
end
`,
  })
  const t = logText(rt)
  assert.match(t, /mod\.chunk/)
  assert.equal((t.match(/mod\.chunk/g) || []).length, 1)
  assert.doesNotMatch(t, /mod\.OnStart/)
  assert.match(t, /marker\tprobe_mod\tpong/)
  assert.match(t, /default-import-marker\tprobe_mod/)
  assert.match(t, /g\tnil/)
  assert.match(t, /failed to load script 'mods\/does_not_exist'/)
})

test('require caches the same Lua table identity across calls', () => {
  const rt = createRuntime()
  const root = rt.addRoot({ active: true,  name: 'R', kind: 'container' })
  rt.registerScriptFile('mods/identity', `
return { marker = "identity", ping = function() return "pong" end }
`)
  rt.mountScript({
    path: 'identity-main',
    control: root,
    source: `
function OnStart()
  print("script_type", type(script), typeof(script))
  print("device_eq", game.GetDevice() == Enum.Device.KeyboardAndMouse, game.GetDevice() == game.GetDevice())
  local a = require("mods/identity")
  a.round5Mutation = "written-through-first-reference"
  local b = require("mods/identity")
  print("require_same", a == b, b.round5Mutation, a.ping == b.ping, b.ping())
  local x, y, z = script:Invoke("Round5Invoke")
  print("invoke_multi", x, y, z)
end
function Round5Invoke()
  return "invoke-a", 7, true
end
`,
  })
  const t = logText(rt)
  assert.match(t, /script_type\ttable\tScript/)
  assert.match(t, /device_eq\ttrue\ttrue/)
  assert.match(t, /require_same\ttrue\twritten-through-first-reference\ttrue\tpong/)
  assert.match(t, /invoke_multi\tinvoke-a\t7\ttrue/)
})

test('FindChild without slash is direct only; navigation and fill match device', () => {
  const rt = createRuntime()
  const root = rt.addRoot({ active: true,
    name: 'ProbeRoot',
    kind: 'container',
    showCursor: true,
    children: [
      { name: 'ProbeText', kind: 'textbox', horizontalAlignment: 'Left' },
      { name: 'ProbeHit', kind: 'cursor' },
      { name: 'ProbeImage', kind: 'image' },
      { name: 'ProbeChild', kind: 'container', children: [{ name: 'ProbeNestedText', kind: 'textbox' }] },
    ],
  })
  rt.mountScript({
    path: 'probe',
    control: root,
    source: `
function OnStart()
  print("direct", script.object:FindChild("ProbeText") ~= nil)
  print("deep_name", script.object:FindChild("ProbeNestedText") == nil)
  print("deep_path", script.object:FindChild("ProbeChild/ProbeNestedText") ~= nil)
  local text = script.object:GetChild("ProbeText")
  print("align_before", text.horizontalAlignment == Enum.TextHorizontalAlignment.Left)
  text.horizontalAlignment = Enum.TextHorizontalAlignment.Middle
  print("align_after", text.horizontalAlignment == Enum.TextHorizontalAlignment.Middle)
  local hit = script.object:GetChild("ProbeHit")
  hit:SetControllerNavigation(Enum.ControllerNavigationDir.Up, Enum.ControllerNavigationMode.Specified, text)
  local mode, target = hit:GetControllerNavigation(Enum.ControllerNavigationDir.Up)
  print("nav", mode == Enum.ControllerNavigationMode.Specified, target == text)
  local removed = 0
  local fn = function() removed = removed + 1 end
  hit:AddCursorEventListener(Enum.CursorEventType.CursorClick, fn)
  hit:RemoveCursorEventListener(Enum.CursorEventType.CursorClick, fn)
  hit:SimulateCursorClick()
  print("removed", removed)
  local img = script.object:GetChild("ProbeImage")
  img:SetFillHorizontal(Enum.ImageFillHorizontalType.Left, 0.25)
  print("fill", img.fillType == Enum.ImageFillType.Horizontal, img.fillAmount)
  local packed = Color.FromRGB(10, 20, 30)
  local r, g, b, a = Color.ToRGBA(packed)
  print("color", packed, r, g, b, a)
end
`,
  })
  const t = logText(rt)
  assert.match(t, /direct\ttrue/)
  assert.match(t, /deep_name\ttrue/)
  assert.match(t, /deep_path\ttrue/)
  assert.match(t, /align_before\ttrue/)
  assert.match(t, /align_after\ttrue/)
  assert.match(t, /nav\ttrue\ttrue/)
  assert.match(t, /removed\t0/)
  assert.match(t, /fill\ttrue\t0\.25/)
  assert.match(t, /color\t4278850590\t10\t20\t30\t255/)
})

test('Tween restart and loops recapture the original start; sequence pause holds children', () => {
  const rt = createRuntime()
  const root = rt.addRoot({ active: true,  name: 'R', kind: 'textbox', anchoredPositionX: 0 })
  rt.mountScript({
    path: 'tween',
    control: root,
    source: `
function OnStart()
  local tw = game.Tween(script.object, { anchoredPositionX = 100 }, 0.5)
  tw:SetEase(Enum.EaseType.Linear)
  tw:Play()
  tw:Complete()
  print("first_end", script.object.anchoredPositionX)
  tw:Restart()
end
`,
  })
  rt.step(0.25)
  assert.ok(Math.abs(root.anchoredPositionX - 50) < 1, `restart half=${root.anchoredPositionX}`)
  rt.step(0.25)
  assert.ok(Math.abs(root.anchoredPositionX - 100) < 1)

  const loopRt = createRuntime()
  const loopRoot = loopRt.addRoot({ active: true,  name: 'R', kind: 'textbox', anchoredPositionX: 0 })
  loopRt.mountScript({
    path: 'loops',
    control: loopRoot,
    source: `
function OnStart()
  local tw = game.Tween(script.object, { anchoredPositionX = 100 }, 0.5)
  tw:SetEase(Enum.EaseType.Linear)
  tw:SetLoops(2)
  tw:Play()
end
`,
  })
  // Device TWSEM v1 L1: the frame reaching the end shows the end value; the
  // next loop restarts on the following frame without the overflow.
  loopRt.step(0.6)
  assert.equal(loopRoot.anchoredPositionX, 100)
  loopRt.step(0.1)
  assert.ok(Math.abs(loopRoot.anchoredPositionX - 20) < 1e-9, `second cycle should restart, got ${loopRoot.anchoredPositionX}`)

  const seqRt = createRuntime()
  const seqRoot = seqRt.addRoot({ active: true,  name: 'R', kind: 'textbox', anchoredPositionX: 0 })
  seqRt.mountScript({
    path: 'seq',
    control: seqRoot,
    source: `
function OnStart()
  local seq = game.TweenSequence()
  seq:Append(game.Tween(script.object, { anchoredPositionX = 100 }, 1.0):SetEase(Enum.EaseType.Linear))
  seq:Play()
end
`,
  })
  seqRt.step(0.25)
  const pausedAt = seqRoot.anchoredPositionX
  for (const seq of seqRt.sequences) seq.Pause()
  seqRt.step(0.5)
  assert.equal(seqRoot.anchoredPositionX, pausedAt)
  for (const seq of seqRt.sequences) seq.Complete()
  assert.equal(seqRoot.anchoredPositionX, 100)
})

test('PauseLevelTime inside OnUpdate still delivers one OnLevelUpdate this frame', () => {
  const rt = createRuntime()
  const root = rt.addRoot({ active: true,  name: 'R', kind: 'container' })
  rt.mountScript({
    path: 'pause',
    control: root,
    source: `
u, l = 0, 0
function OnStart()
  script:EnableUpdate(true)
end
function OnUpdate(dt)
  u = u + 1
  if u == 1 then game.PauseLevelTime(true) end
end
function OnLevelUpdate(dt)
  l = l + 1
end
function OnDestroy()
  print("pause_counts", u, l)
end
`,
  })
  rt.step(0.016)
  rt.step(0.016)
  rt.destroy()
  assert.match(logText(rt), /pause_counts\t2\t1/)
})

test('destroy during OnStart does not poison later Instantiate', () => {
  const rt = createRuntime()
  const root = rt.addRoot({ active: true,  name: 'R', kind: 'container' })
  rt.registerTemplate(1, { kind: 'image', name: 'A' })
  rt.registerTemplate(2, { kind: 'image', name: 'B' })
  rt.mountScript({
    path: 'life',
    control: root,
    source: `
function OnStart()
  local a = game.InstantiateClientUIControl(1, script.object)
  game.DestroyClientUIControl(a)
  local b = game.InstantiateClientUIControl(2, script.object)
  print("after_destroy", b ~= nil, b and b.name)
end
`,
  })
  assert.match(logText(rt), /after_destroy\ttrue\tB/)
})

test('require preserves mixed Lua table array and named entries', () => {
  const rt = createRuntime()
  const root = rt.addRoot({ active: true,  name: 'R', kind: 'container' })
  rt.registerScriptFile('mods/mixed', 'return { 7, 9, marker = "mixed" }')
  rt.mountScript({
    path: 'mixed-main',
    control: root,
    source: `
function OnStart()
  local value = require("mods/mixed")
  print("mixed", value[1], value[2], value.marker)
end
`,
  })
  assert.match(logText(rt), /mixed\t7\t9\tmixed/)
})

test('Tween default absolute; SetRelative true adds', () => {
  const rt = createRuntime()
  const root = rt.addRoot({ active: true,
    name: 'R',
    kind: 'container',
    children: [{ name: 'ProbeText', kind: 'textbox', anchoredPositionX: -4, anchoredPositionY: 234 }],
  })
  rt.mountScript({
    path: 't',
    control: root,
    source: `
function OnStart()
  local t = script.object:GetChild("ProbeText")
  game.Tween(t, { anchoredPositionX = 10 }, 0.05):Play():Complete()
  print("abs", t.anchoredPositionX)
  game.Tween(t, { anchoredPositionX = 10 }, 0.05):SetRelative(true):Play():Complete()
  print("rel", t.anchoredPositionX)
end
`,
  })
  const t = logText(rt)
  assert.match(t, /abs\t10/)
  assert.match(t, /rel\t20/)
})

test('PauseLevelTime stops OnLevelUpdate not OnUpdate', () => {
  const rt = createRuntime()
  const root = rt.addRoot({ active: true,  name: 'R', kind: 'container' })
  rt.mountScript({
    path: 't',
    control: root,
    source: `
u, l = 0, 0
function OnStart()
  script:EnableUpdate(true)
  game.PauseLevelTime(true)
end
function OnUpdate(dt) u = u + 1 end
function OnLevelUpdate(dt) l = l + 1 end
function OnDestroy() print("counts", u, l) end
`,
  })
  rt.step(0.016)
  rt.step(0.016)
  rt.destroy()
  assert.match(logText(rt), /counts\t2\t0/)
})

test('destroying an instantiated control unmounts its scripts and handlers', () => {
  const rt = createRuntime()
  const root = rt.addRoot({ active: true,  name: 'R', kind: 'container' })
  rt.registerTemplate(30003, {
    name: 'Dynamic',
    kind: 'container',
    scripts: [{
      path: 'dynamic-script',
      source: `
function OnStart()
  script:EnableUpdate(true)
  script:RegisterServerSignalHandler("AfterDestroy", function() print("signal-after-destroy") end)
  print("dynamic-start")
end
function OnUpdate() print("tick-after-destroy") end
function OnDisable() print("dynamic-disable") end
function OnDestroy() print("dynamic-destroy") end
`,
    }],
  })
  rt.mountScript({
    path: 'owner',
    control: root,
    source: `
function OnStart()
  local created = game.InstantiateClientUIControl(30003, script.object)
  game.DestroyClientUIControl(created)
end
`,
  })
  rt.step(0.016)
  rt.sendClientSignal('AfterDestroy', [])
  const text = logText(rt)
  assert.match(text, /dynamic-start/)
  assert.match(text, /dynamic-disable/)
  assert.match(text, /dynamic-destroy/)
  assert.doesNotMatch(text, /tick-after-destroy/)
  assert.doesNotMatch(text, /signal-after-destroy/)
  assert.equal(rt.mountedScripts.length, 1)
})

test('SetActive fires OnDisable/OnEnable without re-running OnStart', () => {
  const rt = createRuntime()
  const root = rt.addRoot({
    active: true,
    name: 'Host',
    kind: 'container',
    children: [{ name: 'Observer', kind: 'container', active: true }],
  })
  const obs = root.GetChild('Observer')
  rt.mountScript({
    path: 'observer',
    control: obs,
    source: `
n = 0
function OnInit() print("obs-init") end
function OnEnable() print("obs-enable") end
function OnStart()
  script:EnableUpdate(true)
  print("obs-start")
end
function OnUpdate() n = n + 1 end
function OnDisable() print("obs-disable", n) end
function OnDestroy() print("obs-destroy") end
`,
  })
  rt.mountScript({
    path: 'host',
    control: root,
    source: `
function OnStart()
  local obs = script.object:GetChild("Observer")
  print("set-false")
  obs:SetActive(false)
  print("set-true")
  obs:SetActive(true)
end
`,
  })
  const t = logText(rt)
  assert.match(t, /obs-init/)
  assert.match(t, /obs-enable/)
  assert.match(t, /obs-start/)
  assert.match(t, /set-false/)
  assert.match(t, /obs-disable/)
  assert.match(t, /set-true/)
  assert.equal((t.match(/obs-start/g) || []).length, 1)
  assert.equal((t.match(/obs-enable/g) || []).length, 2)
  assert.equal((t.match(/obs-disable/g) || []).length, 1)
})

test('inactive hierarchy stops mounted script updates and registered callbacks', () => {
  const rt = createRuntime()
  const root = rt.addRoot({ active: true,
    name: 'Root',
    kind: 'container',
    children: [{ name: 'Child', kind: 'container', active: true }],
  })
  const child = root.GetChild('Child')
  rt.mountScript({
    path: 'inactive-child',
    control: child,
    source: `
function OnStart()
  script:EnableUpdate(true)
  script:RegisterServerSignalHandler("InactiveSignal", function() print("inactive-signal") end)
  script:RegisterCustomVariableChangedHandler(Enum.CustomVariableEntityType.PlayerSelf, "Gold", function() print("inactive-var") end)
end
function OnUpdate() print("inactive-update") end
`,
  })
  root.SetActive(false)
  rt.step(0.016)
  rt.sendClientSignal('InactiveSignal', [])
  rt.setVar('PlayerSelf', 'Gold', 1)
  assert.doesNotMatch(logText(rt), /inactive-(?:update|signal|var)/)
  root.SetActive(true)
  rt.step(0.016)
  rt.sendClientSignal('InactiveSignal', [])
  rt.setVar('PlayerSelf', 'Gold', 2)
  assert.match(logText(rt), /inactive-update/)
  assert.match(logText(rt), /inactive-signal/)
  assert.match(logText(rt), /inactive-var/)
})

test('failed script chunks roll back mounted script records', () => {
  const rt = createRuntime()
  const root = rt.addRoot({ active: true,  name: 'R', kind: 'container' })
  assert.throws(() => rt.mountScript({ path: 'broken', control: root, source: 'function broken(' }))
  assert.equal(rt.mountedScripts.length, 0)
  assert.equal(root.scripts.length, 0)
})

test('key listener return true stops later listeners', () => {
  const rt = createRuntime()
  const root = rt.addRoot({ active: true,  name: 'R', kind: 'container' })
  rt.mountScript({
    path: 't',
    control: root,
    source: `
function OnStart()
  script.object:AddKeyEventListener(Enum.KeyEventType.KeyboardCraftspersonKey1Down, function()
    print("first")
    return true
  end)
  script.object:AddKeyEventListener(Enum.KeyEventType.KeyboardCraftspersonKey1Down, function()
    print("second")
    return false
  end)
end
`,
  })
  rt.injectKey('KeyboardCraftspersonKey1Down')
  const t = logText(rt)
  assert.match(t, /first/)
  assert.doesNotMatch(t, /second/)
})

test('key listeners on the same level follow the current front-to-back sibling order', () => {
  const rt = createRuntime()
  const root = rt.addRoot({ active: true, name: 'Root', kind: 'container', children: [
    { active: true, name: 'Front', kind: 'container' },
    { active: true, name: 'Middle', kind: 'container' },
    { active: true, name: 'Back', kind: 'container' },
  ] })
  rt.mountScript({ path: 'key-order', control: root, source: `
function OnStart()
  for _, name in ipairs({ 'Back', 'Middle', 'Front' }) do
    local label = name
    script.object:GetChild(label):AddKeyEventListener(
      Enum.KeyEventType.KeyboardCraftspersonKey1Down,
      function() print(label); return false end)
  end
end` })
  const key = 'KeyboardCraftspersonKey1Down'
  rt.injectKey(key)
  assert.deepEqual(rt.logs.map(entry => entry.text), ['Front', 'Middle', 'Back'])
  assert.equal(root.GetChild('Back').SetAsLastSibling(), true)
  rt.logs.length = 0
  rt.injectKey(key)
  assert.deepEqual(rt.logs.map(entry => entry.text), ['Back', 'Front', 'Middle'])
})

test('a handled key event at the upper sibling stops lower controls in the container', () => {
  const rt = createRuntime()
  const root = rt.addRoot({ active: true, name: 'Root', kind: 'container', children: [
    { active: true, name: 'Front', kind: 'container' },
    { active: true, name: 'Back', kind: 'container' },
  ] })
  rt.mountScript({ path: 'key-consume', control: root, source: `
function OnStart()
  script.object:GetChild('Back'):AddKeyEventListener(
    Enum.KeyEventType.KeyboardCraftspersonKey1Down,
    function() print('Back'); return false end)
  script.object:GetChild('Front'):AddKeyEventListener(
    Enum.KeyEventType.KeyboardCraftspersonKey1Down,
    function() print('Front'); return true end)
end` })
  rt.injectKey('KeyboardCraftspersonKey1Down')
  assert.deepEqual(rt.logs.map(entry => entry.text), ['Front'])
})

test('cursor callbacks require showCursor on an ancestor container', () => {
  const rt = createRuntime()
  const root = rt.addRoot({ active: true,
    name: 'Root',
    kind: 'container',
    children: [{ name: 'Hit', kind: 'cursor' }],
  })
  rt.mountScript({
    path: 'cursor-gate',
    control: root,
    source: `
function OnStart()
  script.object:GetChild("Hit"):AddCursorEventListener(Enum.CursorEventType.CursorClick, function()
    print("cursor-fired")
  end)
end
`,
  })
  const hit = root.GetChild('Hit')
  hit.SimulateCursorClick()
  assert.doesNotMatch(logText(rt), /cursor-fired/)
  root.showCursor = true
  hit.SimulateCursorClick()
  assert.match(logText(rt), /cursor-fired/)
})

test('spec.scripts mount on addRoot and on instantiate, restoring the script global', () => {
  const rt = createRuntime()
  rt.registerTemplate(30001, {
    kind: 'container',
    name: '模板面板',
    scripts: [{ path: 'tmpl-child', source: 'function OnStart()\n  print("tmpl-script", script.object.name)\nend' }],
    children: [
      { kind: 'textbox', name: '模板标题', children: [] },
    ],
  })
  const root = rt.addRoot({ active: true,
    name: 'SceneRoot',
    kind: 'container',
    scripts: [{ path: 'scene-script', source: 'function OnStart()\n  print("scene-script", script.object.name)\n  local panel = game.InstantiateClientUIControl(30001, script.object)\n  print("after-instantiate", script.object.name)\nend' }],
    children: [],
  })
  const text = logText(rt)
  assert.match(text, /scene-script\tSceneRoot/)
  assert.match(text, /tmpl-script\t模板面板/)
  assert.match(text, /after-instantiate\tSceneRoot/)
  assert.equal(root.children.length, 1)
  assert.equal(root.children[0].scripts.length, 1)
  assert.equal(root.children[0].scripts[0].object, root.children[0])
})

test('mounted scripts keep independent Lua environments and update callbacks', () => {
  const rt = createRuntime()
  const root = rt.addRoot({ active: true,  name: 'Root', kind: 'container', children: [{ name: 'Child', kind: 'container', active: true }] })
  const child = root.GetChild('Child')
  rt.mountScript({
    path: 'a',
    control: root,
    source: `
function OnStart() script:EnableUpdate(true) end
function OnUpdate() print("update-a", script.object.name) end
`,
  })
  rt.mountScript({
    path: 'b',
    control: child,
    source: `
function OnStart() script:EnableUpdate(true) end
function OnUpdate() print("update-b", script.object.name) end
`,
  })
  rt.step(0.016)
  const text = logText(rt)
  assert.match(text, /update-a\tRoot/)
  assert.match(text, /update-b\tChild/)
  assert.equal((text.match(/update-a/g) || []).length, 1)
  assert.equal((text.match(/update-b/g) || []).length, 1)
})

test('instantiated descendants are indexed by Id', () => {
  const rt = createRuntime()
  const root = rt.addRoot({ active: true,  name: 'Root', kind: 'container' })
  rt.registerTemplate(30002, {
    kind: 'container',
    name: 'Panel',
    children: [{ kind: 'textbox', name: 'Nested' }],
  })
  rt.mountScript({
    path: 'lookup',
    control: root,
    source: `
function OnStart()
  local panel = game.InstantiateClientUIControl(30002, script.object)
  local nested = panel:GetChild("Nested")
  local found = game.GetClientUIControl(nested.Id)
  print("nested-index", found and found.name)
end
`,
  })
  assert.match(logText(rt), /nested-index\tNested/)
})

test('control parenting rejects cycles and step rejects malformed dt', () => {
  const rt = createRuntime()
  const root = rt.addRoot({ active: true,  name: 'Root', kind: 'container', children: [{ name: 'Child', kind: 'container' }] })
  const child = root.GetChild('Child')
  assert.throws(() => root.addChild(root), /cannot parent a control to itself or its descendant/)
  assert.throws(() => { root.parent = child }, /cannot parent a control to itself or its descendant/)
  assert.equal(root.parent, null)
  assert.equal(child.parent, root)
  child.parent = null
  assert.ok(rt.roots.includes(child))
  root.addChild(child)
  assert.equal(rt.roots.includes(child), false)

  for (const badDt of [Number.NaN, Number.POSITIVE_INFINITY, -0.1, '0.1']) {
    assert.throws(() => rt.step(badDt), /dt must be a finite non-negative number/)
  }
  assert.equal(rt.clock.frame, 0)
  assert.equal(rt.clock.time, 0)
})

test('TweenSequence Join shares the latest Append start and Insert extends the timeline', () => {
  const rt = createRuntime()
  const root = rt.addRoot({ active: true,  name: 'Root', kind: 'container' })
  rt.mountScript({
    path: 'sequence',
    control: root,
    source: `
function OnStart()
  script.object:SetSizeDelta(80, 40)
  local timeline = game.TweenSequence()
  timeline:Append(game.Tween(script.object, { anchoredPositionX = 100 }, 1.0))
  timeline:Join(game.Tween(script.object, { anchoredPositionY = 100 }, 0.5))
  timeline:Insert(0.5, game.Tween(script.object, { sizeDeltaX = 160 }, 0.25))
  timeline:AppendInterval(0.25)
  timeline:Append(game.Tween(script.object, { sizeDeltaY = 100 }, 0.5))
  timeline:Play()
end
`,
  })

  rt.step(0) // starts all zero-offset sequence entries
  rt.step(0.25)
  assert.equal(root.anchoredPositionX, 25)
  assert.equal(root.anchoredPositionY, 50)

  rt.step(0.25)
  rt.step(0.125)
  assert.equal(root.sizeDeltaX, 120)

  rt.step(0.625)
  rt.step(0.5)
  assert.equal(root.anchoredPositionX, 100)
  assert.equal(root.anchoredPositionY, 100)
  assert.equal(root.sizeDeltaX, 160)
  assert.equal(root.sizeDeltaY, 100)
})

test('Tween interpolates packed transparent colors by channel', () => {
  const rt = createRuntime()
  const root = rt.addRoot({ active: true,  name: 'Root', kind: 'image', imageColor: 0x000000ff })
  rt.mountScript({
    path: 'color-tween',
    control: root,
    source: 'function OnStart() game.Tween(script.object, { imageColor = 0x00ff0000 }, 1):Play() end',
  })
  rt.step(0.5)
  assert.equal(root.imageColor, 0x007f007f)
})

test('server bridge records SendSignal and delivers setVar to Lua handlers', () => {
  const inbound = []
  const rt = createRuntime()
  rt.serverBridge = {
    getVar(_entityType, name) {
      return name === 'Gold' ? 9 : undefined
    },
    setVar(entityType, name) {
      rt.notifyVarHandlers(entityType, name)
    },
    receiveFromClient(name, params) {
      inbound.push({ name, params })
    },
  }
  const root = rt.addRoot({ active: true,  name: 'R', kind: 'container' })
  rt.mountScript({
    path: 'bridge',
    control: root,
    source: `
function OnStart()
  script:RegisterCustomVariableChangedHandler(Enum.CustomVariableEntityType.PlayerSelf, "Gold", function(entityType, varName)
    print("changed", varName, game.GetGlobalCustomVariableValue(entityType, varName))
  end)
  local sig = game.ServerSignal("Battle_ReportKill")
  sig:AddInt(3)
  sig:AddString("slime")
  sig:SendSignal()
  print("gold", game.GetGlobalCustomVariableValue(Enum.CustomVariableEntityType.PlayerSelf, "Gold"))
end
`,
  })
  assert.equal(inbound.length, 1)
  assert.equal(inbound[0].name, 'Battle_ReportKill')
  assert.equal(inbound[0].params[0].type, 'Int')
  assert.equal(inbound[0].params[0].value, 3)
  rt.setVar('PlayerSelf', 'Gold', 9)
  const text = logText(rt)
  assert.match(text, /gold\t9/)
  assert.match(text, /changed\tGold\t9/)
})

test('control userdata is type-closed: unknown fields error on write and are nil on read', () => {
  const rt = createRuntime()
  const root = rt.addRoot({ active: true,  name: 'R', kind: 'container' })
  rt.registerTemplate(1, { kind: 'image', name: 'Img' })
  rt.registerTemplate(2, { kind: 'cursor', name: 'Hit' })
  rt.mountScript({
    path: 'fields',
    control: root,
    scriptMappingId: 1073742999,
    source: `
function OnStart()
  local img = game.InstantiateClientUIControl(1, script.object)
  local hit = game.InstantiateClientUIControl(2, script.object)
  print("img_raycast", img.raycastTarget)
  print("hit_raycast", hit.raycastTarget)
  print("img_type", img.imageType)
  print("img_listen", img.AddCursorEventListener)
  print("hit_listen", hit.AddCursorEventListener ~= nil)
  local ok, err = pcall(function()
    img.raycastTarget = false
  end)
  print("img_set", ok, err)
  local okType, errType = pcall(function()
    img.imageType = Enum.ImageType.Stretch
  end)
  print("img_type_set", okType, errType)
  hit.raycastTarget = true
  print("hit_set", hit.raycastTarget)
  print("smap_type", math.type(script.scriptMappingId))
  print("smap", script.scriptMappingId)
  print("script_id", script.id)
  print("script_prefab", script.prefabId)
  print("img_rid", math.type(img.Id))
  print("img_pid", img.prefabIndex)
  print("img_id", img.id)
  print("img_prefab", img.prefabId)
  print("et_old", script.EnableTick)
  print("et_new", script.EnableUpdate ~= nil)
  print("script_tick", script.tickEnabled)
  print("enum_kind", Enum.ImageType.Stretch.__kind)
  local okScript, errScript = pcall(function()
    script.tickEnabled = true
  end)
  print("script_set", okScript, errScript)
end
`,
  })
  const t = logText(rt)
  assert.match(t, /img_raycast\tnil/)
  assert.match(t, /hit_raycast\ttrue/)
  assert.match(t, /img_type\tnil/)
  assert.match(t, /img_listen\tnil/)
  assert.match(t, /hit_listen\ttrue/)
  assert.match(t, /img_set\tfalse\t.*cannot set raycastTarget, no such field/)
  assert.match(t, /img_type_set\tfalse\t.*cannot set imageType, no such field/)
  assert.match(t, /hit_set\ttrue/)
  assert.match(t, /smap_type\tinteger/)
  assert.match(t, /smap\t1073742999/)
  assert.match(t, /script_id\tnil/)
  assert.match(t, /script_prefab\tnil/)
  assert.match(t, /img_rid\tinteger/)
  assert.match(t, /img_pid\t1/)
  assert.match(t, /img_id\tnil/)
  assert.match(t, /img_prefab\tnil/)
  assert.match(t, /et_old\tnil/)
  assert.match(t, /et_new\ttrue/)
  assert.match(t, /script_tick\tnil/)
  assert.match(t, /enum_kind\tnil/)
  assert.match(t, /script_set\tfalse\t.*cannot set tickEnabled, no such field/)
})

test('runtime active defaults to false; Instantiate inherits the template value', () => {
  const rt = createRuntime()
  const omitted = rt.addRoot({ name: 'Omitted', kind: 'container' })
  assert.equal(omitted.active, false)
  const on = rt.addRoot({ name: 'On', kind: 'container', active: true })
  assert.equal(on.active, true)
  rt.registerTemplate(11, { kind: 'image', name: 'OffImg', active: false })
  rt.registerTemplate(12, { kind: 'image', name: 'OnImg', active: true })
  rt.mountScript({
    path: 'active-inherit',
    control: on,
    source: `
function OnStart()
  local offImg = game.InstantiateClientUIControl(11, script.object)
  local onImg = game.InstantiateClientUIControl(12, script.object)
  print("off", offImg.active, offImg.visible)
  print("on", onImg.active, onImg.visible)
end
`,
  })
  assert.match(logText(rt), /off\tfalse\ttrue/)
  assert.match(logText(rt), /on\ttrue\ttrue/)
  rt.destroy()
  assert.equal(rt.luaStates.size, 0)
})

test('GetCursorUIPos follows injectCursor coordinates', () => {
  const rt = createRuntime()
  const root = rt.addRoot({ active: true, name: 'R', kind: 'container', showCursor: true })
  rt.mountScript({
    path: 'cursor-pos',
    control: root,
    source: `
function OnStart()
  local x, y = game.GetCursorUIPos()
  print("boot", x, y)
end
`,
  })
  assert.match(logText(rt), /boot\t0\t0/)
  rt.injectCursor(root, 'CursorMove', rt.makeCursorEventData({ x: 120, y: 340 }))
  rt.mountScript({
    path: 'cursor-pos-2',
    control: root,
    source: `
function OnStart()
  local x, y = game.GetCursorUIPos()
  print("after", x, y)
end
`,
  })
  assert.match(logText(rt), /after\t120\t340/)
  rt.destroy()
})

test('removing one subscription keeps other listeners of the same Lua function alive', () => {
  const rt = createRuntime()
  const root = rt.addRoot({ active: true, name: 'Root', kind: 'container', children: [
    { active: true, name: 'A', kind: 'container' },
    { active: true, name: 'B', kind: 'container' },
    { active: true, name: 'C', kind: 'container' },
  ] })
  rt.mountScript({ path: 'shared-callback', control: root, source: `
local K = Enum.KeyEventType
local function F() print("F") end
function OnStart()
  local root = script.object
  root:AddKeyEventListener(K.KeyboardCraftspersonKey1Down, F)
  root:AddKeyEventListener(K.KeyboardCraftspersonKey2Down, F)
  root:RemoveKeyEventListener(K.KeyboardCraftspersonKey1Down, F)
  root:AddKeyEventListener(K.KeyboardCraftspersonKey3Down, function() print("G") end)
  root:GetChild("A"):AddKeyEventListener(K.KeyboardCraftspersonKey4Down, F)
  root:GetChild("B"):AddKeyEventListener(K.KeyboardCraftspersonKey4Down, F)
  root:GetChild("C"):AddKeyEventListener(K.KeyboardCraftspersonKey5Down, function()
    root:RemoveAllKeyEventListeners()
    root:GetChild("B"):RemoveAllKeyEventListeners()
  end)
  root:GetChild("C"):AddKeyEventListener(K.KeyboardCraftspersonKey6Down, function()
    root:AddKeyEventListener(K.KeyboardCraftspersonKey1Down, F)
  end)
end` })
  const press = (n) => {
    rt.logs.length = 0
    rt.injectKey(`KeyboardCraftspersonKey${n}Down`)
    return rt.logs.map(entry => entry.text)
  }
  assert.deepEqual(press(1), [])
  assert.deepEqual(press(2), ['F'])
  assert.deepEqual(press(3), ['G'])
  rt.destroyControl(root.GetChild('A'))
  assert.deepEqual(press(4), ['F'])
  assert.deepEqual(press(5), [])
  assert.equal(rt.luaFunctions.size, 2, 'only the two listeners on C stay referenced')
  assert.deepEqual([2, 3, 4].flatMap(press), [])
  assert.deepEqual(press(6), [])
  assert.deepEqual(press(1), ['F'])
})

// Device evidence: probes/tween-invoke-20260928 (TWINV v1, PC, 2026-09-29).
test('TweenSequence loops replay from the start, children reset at their own slot', () => {
  const rt = createRuntime()
  const lanes = {}
  for (const id of ['L2', 'L3', 'L4', 'L5', 'L6']) {
    lanes[id] = rt.addRoot({ active: true, name: id, kind: 'image', anchoredPositionX: 0, anchoredPositionY: 0 })
  }
  const host = rt.addRoot({ active: true, name: 'Host', kind: 'container' })
  rt.mountScript({
    path: 'seq-loops',
    control: host,
    source: `
ev = {}
local function on(tag) return function() ev[tag] = (ev[tag] or 0) + 1 end end
local function x(c, v, d) return game.Tween(c, { anchoredPositionX = v }, d):SetEase(Enum.EaseType.Linear) end
function OnStart()
  local R = script.object
  local function lane(n) return game.FindClientUIRoot(n) end
  game.TweenSequence():Append(x(lane("L2"), 200, 1)):SetLoops(2):SetOnComplete(on("L2c")):Play()
  game.TweenSequence():Append(x(lane("L3"), 200, 0.5))
    :Append(game.Tween(lane("L3"), { anchoredPositionY = 30 }, 0.5):SetEase(Enum.EaseType.Linear))
    :AppendCallback(on("L3cb")):SetLoops(3)
    :SetOnStepComplete(on("L3s")):SetOnComplete(on("L3c")):Play()
  L4 = game.TweenSequence():Append(x(lane("L4"), 200, 1)):SetOnComplete(on("L4c")):Play()
  L5 = game.TweenSequence():Append(x(lane("L5"), 200, 1)):SetLoops(-1):SetOnComplete(on("L5c")):Play()
  game.TweenSequence():Append(x(lane("L6"), 100, 1):SetRelative(true)):SetLoops(2):Play()
end
function Restart4() L4:Restart() end
function Kill5() L5:Kill(false) end
function Count(tag) return ev[tag] or 0 end
`,
  })
  const script = rt.mountedScripts[0]
  const call = (name, ...args) => script.invoke(name, args)
  let t = 0
  const until = (end) => { while (t < end - 1e-9) { rt.step(0.05); t += 0.05 } }
  const near = (value, expected, label) => assert.ok(Math.abs(value - expected) < 1e-6, `${label}=${value}`)
  until(1.3)
  // Second loop moves again (device L2 t=1.309 -> 59.8).
  assert.ok(lanes.L2.anchoredPositionX > 20 && lanes.L2.anchoredPositionX < 100, `L2 loop2 x=${lanes.L2.anchoredPositionX}`)
  // X child replays while Y keeps its end value until its slot (device L3 t=1.209 -> 79.6/30).
  assert.ok(lanes.L3.anchoredPositionX < 200, `L3 x=${lanes.L3.anchoredPositionX}`)
  near(lanes.L3.anchoredPositionY, 30, 'L3 y')
  // Relative child does not accumulate (device L6 t=1.309 -> 29.9).
  assert.ok(lanes.L6.anchoredPositionX < 60, `L6 x=${lanes.L6.anchoredPositionX}`)
  near(lanes.L4.anchoredPositionX, 200, 'L4 x')
  call('Restart4')
  until(1.7)
  // Y slot started: reset to 0 then moving (device L3 t=1.606 -> 5.8).
  assert.ok(lanes.L3.anchoredPositionY < 20, `L3 y=${lanes.L3.anchoredPositionY}`)
  // Restart after completion replays from the start, 0.4 s in (device: 0.1 s after Restart -> 19.8).
  assert.ok(lanes.L4.anchoredPositionX > 40 && lanes.L4.anchoredPositionX < 100, `L4 x=${lanes.L4.anchoredPositionX}`)
  until(2.3)
  assert.ok(lanes.L5.anchoredPositionX < 100, `L5 loop3 x=${lanes.L5.anchoredPositionX}`)
  call('Kill5')
  const killedAt = lanes.L5.anchoredPositionX
  until(3.5)
  assert.equal(lanes.L5.anchoredPositionX, killedAt)
  near(lanes.L2.anchoredPositionX, 200, 'L2 x')
  near(lanes.L6.anchoredPositionX, 100, 'L6 x')
  near(lanes.L3.anchoredPositionX, 200, 'L3 x')
  near(lanes.L3.anchoredPositionY, 30, 'L3 y')
  assert.deepEqual(['L2c', 'L3cb', 'L3s', 'L3c', 'L4c', 'L5c'].map(tag => call('Count', tag)), [1, 3, 3, 1, 2, 0])
})

test('script:Invoke passes host objects and tables through unchanged', () => {
  const rt = createRuntime()
  const root = rt.addRoot({ active: true, name: 'R', kind: 'image' })
  rt.mountScript({
    path: 'invoke-identity',
    control: root,
    source: `
function Echo(...) return ... end
function OnStart()
  local items = {
    script.object,
    game.Tween(script.object, { anchoredPositionX = 1 }, 1),
    game.TweenSequence(),
    game.ServerSignal("NEVER_SENT"),
  }
  for _, v in ipairs(items) do
    local back = script:Invoke("Echo", v)
    local t = { v }
    local wrapped = script:Invoke("Echo", t)
    print("id", typeof(v), rawequal(back, v), rawequal(wrapped, t), rawequal(wrapped[1], v))
  end
  local a, b, c = script:Invoke("Echo", 1, "x", { 2, 3 })
  print("multi", a, b, type(c), #c)
  print("missing", select("#", script:Invoke("NoSuchFunction")))
  print("error", pcall(function() return script:Invoke("error", "boom") end))
end
`,
  })
  const t = logText(rt)
  for (const kind of ['ClientUIImageControl', 'Tween', 'TweenSequence', 'ServerSignal']) {
    assert.match(t, new RegExp(`id\t${kind}\ttrue\ttrue\ttrue`))
  }
  assert.match(t, /multi\t1\tx\ttable\t2/)
  assert.match(t, /missing\t0/)
  assert.match(t, /error\tfalse\tboom/)
})

// Device evidence: probes/tween-semantics-20260929 (TWSEM v1, PC, 2026-09-29).
test('rotation reads back as normalised Euler floats and tweens start from the readback', () => {
  const rt = createRuntime()
  const root = rt.addRoot({ active: true, name: 'R', kind: 'image' })
  rt.mountScript({ path: 'rot', control: root, source: `
local function read(field, v)
  script.object[field] = v
  local r = script.object[field]
  script.object[field] = 0
  return math.type(r) .. ":" .. string.format("%.3f", r)
end
function OnStart()
  local out = {}
  for _, v in ipairs({ -116, 370, -180, 90.5 }) do
    out[#out + 1] = read("localRotationX", v) .. "/" .. read("localRotationZ", v)
  end
  print("rot", table.concat(out, " "))
  script.object.localRotationZ = -116
  game.Tween(script.object, { localRotationZ = -136 }, 1):SetEase(Enum.EaseType.Linear):Play()
end
` })
  assert.match(logText(rt), /rot\tfloat:296\.000\/float:244\.000 float:10\.000\/float:10\.000 float:0\.000\/float:180\.000 float:89\.500\/float:90\.500/)
  rt.step(0.5)
  // 244 -> -136 over 1 s (device R1: the long 380-degree path).
  assert.ok(Math.abs(root.luaFieldValue('localRotationZ') - 54) < 1e-6, String(root.luaFieldValue('localRotationZ')))
})

test('sequence events: capture timing, same-time order, end callbacks and Complete', () => {
  const rt = createRuntime()
  const names = ['C1', 'C2', 'O1', 'O2', 'E1', 'K1', 'K3']
  const c = Object.fromEntries(names.map(n => [n, rt.addRoot({ active: true, name: n, kind: 'image', anchoredPositionX: 0 })]))
  const host = rt.addRoot({ active: true, name: 'Host', kind: 'container' })
  rt.mountScript({ path: 'seq-events', control: host, source: `
log = {}
local function C(n) return game.FindClientUIRoot(n) end
local function X(n, v, d) return game.Tween(C(n), { anchoredPositionX = v }, d):SetEase(Enum.EaseType.Linear) end
local function ev(tag, n) return function() log[#log + 1] = tag .. "=" .. string.format("%.1f", C(n).anchoredPositionX) end end
function OnStart()
  local c1 = X("C1", 100, 1); C("C1").anchoredPositionX = 50; c1:Play()
  local c2 = X("C2", 100, 1); C("C2").anchoredPositionX = 20
  game.TweenSequence():Insert(0.5, c2):Play()
  C2SET = function() C("C2").anchoredPositionX = 50 end
  game.TweenSequence():InsertCallback(0.5, function() C("O1").anchoredPositionX = 30 end):Insert(0.5, X("O1", 100, 1)):Play()
  game.TweenSequence():Insert(0.5, X("O2", 100, 1)):InsertCallback(0.5, function() C("O2").anchoredPositionX = 30 end):Play()
  local fired = false
  game.TweenSequence():InsertCallback(0, function() fired = true end):Play()
  log[#log + 1] = "O3=" .. tostring(fired)
  game.TweenSequence():Insert(0, X("E1", 100, 0.5)):InsertCallback(0.5, ev("E1cb", "E1"))
    :SetOnComplete(ev("E1done", "E1")):Play()
  K1 = game.TweenSequence():Insert(0, X("K1", 100, 1)):InsertCallback(0.2, ev("K1cb2", "K1"))
    :InsertCallback(0.8, ev("K1cb8", "K1")):SetOnStepComplete(ev("K1step", "K1")):SetOnComplete(ev("K1done", "K1")):Play()
  game.TweenSequence():Insert(0, X("K3", 100, 1)):InsertCallback(0.3, ev("K3cb", "K3")):SetOnComplete(ev("K3done", "K3")):Complete()
end
function CompleteK1() K1:Complete() end
function Log() return table.concat(log, " ") end
` })
  const script = rt.mountedScripts[0]
  for (let i = 0; i < 3; i++) rt.step(0.1)
  script.invoke('C2SET', [])
  rt.step(0.1)
  script.invoke('CompleteK1', [])
  for (let i = 0; i < 2; i++) rt.step(0.1)
  const near = (value, expected) => assert.ok(Math.abs(value - expected) < 1e-6, `${value} != ${expected}`)
  near(c.C1.anchoredPositionX, 80) // captured 50 at Play, 0.6 s in
  near(c.C2.anchoredPositionX, 55) // captured 50 when its 0.5 s slot started
  near(c.O1.anchoredPositionX, 37) // both orders: same-time callback runs first
  near(c.O2.anchoredPositionX, 37)
  assert.equal(script.invoke('Log', []), [
    // K1cb2 fires on the update reaching 0.2 and sees the previous frame's value.
    'O3=false', 'K3cb=0.0', 'K3done=100.0', 'K1cb2=10.0',
    'K1cb8=40.0', 'K1step=100.0', 'K1done=100.0', 'E1cb=100.0', 'E1done=100.0',
  ].join(' '))
})

test('fontSize tweens truncate, color channels truncate and ToRGBA returns integers', () => {
  const rt = createRuntime()
  const text = rt.addRoot({ active: true, name: 'T', kind: 'textbox', fontSize: 20 })
  const image = rt.addRoot({ active: true, name: 'I', kind: 'image' })
  rt.mountScript({ path: 'trunc', control: text, source: `
function OnStart()
  game.Tween(script.object, { fontSize = 30 }, 1):SetEase(Enum.EaseType.Linear):Play()
  local img = game.FindClientUIRoot("I")
  img.imageColor = Color.FromRGBA(0, 3, 0, 255)
  game.Tween(img, { imageColor = Color.FromRGBA(3, 0, 3, 252) }, 1):SetEase(Enum.EaseType.Linear):Play()
end
function Read()
  local r, g, b, a = Color.ToRGBA(game.FindClientUIRoot("I").imageColor)
  return math.type(script.object.fontSize) .. ":" .. script.object.fontSize .. " "
    .. table.concat({ math.type(r), r, g, b, a }, ",")
end
` })
  rt.step(0.099)
  assert.equal(rt.mountedScripts[0].invoke('Read', []), 'integer:20 integer,0,2,0,254')
  rt.step(0.25)
  assert.equal(rt.mountedScripts[0].invoke('Read', []), 'integer:23 integer,1,1,1,253')
})

test('tweens and sequences update together in Play order', () => {
  const rt = createRuntime()
  const root = rt.addRoot({ active: true, name: 'R', kind: 'image' })
  rt.mountScript({ path: 'order', control: root, source: `
order = {}
function OnStart()
  game.TweenSequence():InsertCallback(0.05, function() order[#order + 1] = "seq" end):Play()
  game.Tween(script.object, { anchoredPositionX = 1 }, 0.05):SetOnComplete(function() order[#order + 1] = "tween" end):Play()
end
function Order() return table.concat(order, ",") end
` })
  rt.step(0.1)
  assert.equal(rt.mountedScripts[0].invoke('Order', []), 'seq,tween')
})
