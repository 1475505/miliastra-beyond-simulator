import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createStudio } from '../index.js'
import { normalizeCase } from '../autotest/format.js'
import { evaluateAssert } from '../autotest/assert.js'

test('play records pointer history and saves a reusable autotest case', () => {
  const studio = createStudio()
  studio.patch({
    op: 'addScript',
    controlId: 'n1',
    controlAsset: 'server-control-template',
    path: 'main',
    source: `
function OnStart()
  script.object.showCursor = true
  local button = script.object:FindChild("预设按钮")
  button:AddCursorEventListener(Enum.CursorEventType.CursorClick, function()
    print("autotest-click")
  end)
end
`,
  })
  studio.playStart()
  studio.playPointer('click', 800, 450)
  const history = studio.playHistory()
  assert.ok(history.events.some((row) => row.kind === 'pointer' && row.payload.type === 'click'))
  const spec = studio.playSaveCase({
    name: 'click-button',
    asserts: [{ kind: 'log', contains: 'autotest-click' }],
  })
  assert.equal(spec.format, 'qxqy-autotest')
  assert.equal(spec.version, 1)
  assert.ok(spec.events.length >= 1)
  studio.playStop()
})

test('server setVar reaches Lua handlers and SendSignal is recorded inbound', () => {
  const studio = createStudio()
  studio.patch({
    op: 'addScript',
    controlId: 'n1',
    controlAsset: 'server-control-template',
    path: 'main',
    source: `
function OnStart()
  script:RegisterCustomVariableChangedHandler(Enum.CustomVariableEntityType.PlayerSelf, "Gold", function(entityType, varName)
    print("gold", game.GetGlobalCustomVariableValue(entityType, varName))
  end)
  script:RegisterServerSignalHandler("Battle_OnReward", function(signalName, params)
    print("reward", params[1])
  end)
  local sig = game.ServerSignal("Battle_ReportKill")
  sig:AddInt(3)
  sig:SendSignal()
end
`,
  })
  const started = studio.playStart()
  assert.ok(started.server.inbound.some((row) => row.name === 'Battle_ReportKill' && row.values[0] === 3))
  studio.playServerSet('PlayerSelf', 'Gold', 42)
  const afterSet = studio.playGet()
  assert.equal(afterSet.server.vars.PlayerSelf.Gold.value, 42)
  assert.ok(afterSet.serverVars.some((row) => row.entityType === 'PlayerSelf' && row.name === 'Gold' && row.value === 42))
  assert.deepEqual(studio.playServerGet().vars.map((row) => row.name).sort(), ['Gold'])
  assert.match(afterSet.logs.map((row) => row.text).join('\n'), /gold\t42/)
  assert.equal(afterSet.logs.every((row) => row.source === 'client'), true)
  studio.playServerGet('Level', 'Missing')
  const afterMissing = studio.playGet()
  assert.match(afterMissing.serverLogs.map((row) => row.text).join('\n'), /returning nil \(simulator policy\)/)
  assert.doesNotMatch(afterMissing.logs.map((row) => row.text).join('\n'), /returning nil/)
  studio.playServerSend('Battle_OnReward', [7])
  const afterSend = studio.playGet()
  assert.match(afterSend.logs.map((row) => row.text).join('\n'), /reward\t7/)
  studio.playStop()
})

test('client signals emitted during OnUpdate use the current runtime frame time', () => {
  const studio = createStudio()
  studio.patch({
    op: 'addScript',
    controlId: 'n1',
    controlAsset: 'server-control-template',
    path: 'signal-clock',
    source: `
function OnStart() script:EnableUpdate(true) end
function OnUpdate()
  game.ServerSignal("FrameSignal"):SendSignal()
  script:EnableUpdate(false)
end
`,
  })
  studio.playStart()
  const after = studio.playStep(0.25)
  const signal = after.server.inbound.find((entry) => entry.name === 'FrameSignal')
  assert.equal(signal.time, 0.25)
  studio.playStop()
})

test('saved server logic reacts to a client signal with PlayerSelf/Level writes and a PlayerSelf response', () => {
  const studio = createStudio()
  const configured = studio.patch({
    op: 'setServerLogic',
    logic: {
      rules: [{
        id: 'earn-gold',
        signalName: 'EarnGold',
        actions: [
          { kind: 'setCustomVariable', entityType: 'PlayerSelf', name: 'Gold', value: { fromSignalParam: 0 } },
          { kind: 'setCustomVariable', entityType: 'Level', name: 'LastReward', value: 'gold' },
          {
            kind: 'sendClientScriptSignal', target: 'PlayerSelf', signalName: 'GoldChanged',
            params: [{ fromSignalParam: 0 }, 'ok'],
          },
        ],
      }],
    },
  })
  assert.equal(configured.serverLogic.rules[0].actions[2].target, 'PlayerSelf')
  studio.patch({
    op: 'addScript', controlId: 'n1', controlAsset: 'server-control-template', path: 'server-logic.lua', source: `
function OnStart()
  script:RegisterCustomVariableChangedHandler(Enum.CustomVariableEntityType.PlayerSelf, "Gold", function(entityType, name)
    print("gold", game.GetGlobalCustomVariableValue(entityType, name))
  end)
  script:RegisterServerSignalHandler("GoldChanged", function(name, params)
    print("ack", name, params[1], params[2])
  end)
  local signal = game.ServerSignal("EarnGold")
  signal:AddInt(7)
  signal:SendSignal()
end
`,
  })

  const snap = studio.playStart()
  assert.equal(snap.server.vars.PlayerSelf.Gold.value, 7)
  assert.equal(snap.server.vars.Level.LastReward.value, 'gold')
  assert.equal(snap.server.outbound[0].target, 'PlayerSelf')
  assert.match(snap.logs.map((row) => row.text).join('\n'), /gold\t7/)
  assert.match(snap.logs.map((row) => row.text).join('\n'), /ack\tGoldChanged\t7\tok/)

  const archive = JSON.parse(Buffer.from(studio.exportData('save').data, 'base64').toString('utf8'))
  assert.equal(archive.version, 4)
  const restored = createStudio(archive)
  assert.deepEqual(restored.get().serverLogic, configured.serverLogic)
  studio.playStop()
})

test('saved entity creation rules initialize all players before client OnStart and rerun only on a fresh play', () => {
  const studio = createStudio()
  const logic = { rules: [
    { id: 'level', event: 'entityCreated', entityType: 'Level', actions: [
      { kind: 'setCustomVariable', entityType: 'Level', name: 'Phase', value: 'ready' },
    ] },
    { id: 'players', event: 'entityCreated', entityType: 'PlayerSelf', actions: [
      { kind: 'setCustomVariable', entityType: 'PlayerSelf', name: 'Gold', value: 10 },
    ] },
    { id: 'player2', event: 'entityCreated', entityType: 'Player2', actions: [
      { kind: 'setCustomVariable', entityType: 'PlayerSelf', name: 'Gold', value: 20 },
    ] },
  ] }
  studio.patch({ op: 'setServerLogic', logic })
  studio.patch({ op: 'addScript', controlId: 'n1', controlAsset: 'server-control-template', path: 'initialized.lua', source: `
function OnStart()
  print("initial", game.GetGlobalCustomVariableValue(Enum.CustomVariableEntityType.Level, "Phase"),
    game.GetGlobalCustomVariableValue(Enum.CustomVariableEntityType.PlayerSelf, "Gold"))
end
` })
  const archive = JSON.parse(Buffer.from(studio.exportData('save').data, 'base64').toString('utf8'))
  const restored = createStudio(archive)
  assert.deepEqual(restored.get().serverLogic, studio.get().serverLogic)
  try {
    const started = restored.playStart({ playerCount: 2, viewPlayerIndex: 2 })
    assert.equal(started.server.vars.Level.Phase.value, 'ready')
    assert.equal(started.server.vars.Player1.Gold.value, 10)
    assert.equal(started.server.vars.Player2.Gold.value, 20)
    assert.match(started.logs.map(row => row.text).join('\n'), /initial\tready\t20/)
    assert.deepEqual(started.server.inbound, [])
    assert.doesNotMatch(started.serverLogs.map(row => row.text).join('\n'), /missing/)
    const asOne = restored.playSetView(1)
    assert.match(asOne.logs.map(row => row.text).join('\n'), /initial\tready\t10/)
    restored.playServerSet('PlayerSelf', 'Gold', 99)
    restored.playStep(0.1)
    restored.playPause()
    restored.playResume()
    restored.playSetView(2)
    restored.playSetView(1)
    assert.equal(restored.playGet().server.vars.Player1.Gold.value, 99)
    const switched = restored.playSetCanvas('mobile-16-9')
    assert.equal(switched.server.vars.Player1.Gold.value, 10)
    assert.equal(switched.server.vars.Player2.Gold.value, 20)
    assert.match(switched.logs.map(row => row.text).join('\n'), /initial\tready\t10/)
    restored.playStop()
    const restarted = restored.playStart({ playerCount: 1 })
    assert.equal(restarted.server.vars.Player1.Gold.value, 10)
    assert.equal(restarted.server.vars.Player2, undefined)
    assert.match(restarted.logs.map(row => row.text).join('\n'), /initial\tready\t10/)
  } finally { restored.playStop() }
})

test('logic enable settings survive archive round trips and are applied on the next play, not to an existing session', () => {
  const studio = createStudio()
  const rules = [
    { id: 'init', enabled: false, event: 'entityCreated', entityType: 'PlayerSelf', actions: [
      { kind: 'setCustomVariable', entityType: 'PlayerSelf', name: 'Gold', value: 10 },
    ] },
    { id: 'earn', signalName: 'Earn', actions: [
      { kind: 'setCustomVariable', entityType: 'PlayerSelf', name: 'Gold', value: 99 },
    ] },
  ]
  studio.patch({ op: 'setServerLogic', logic: { enabled: false, rules } })
  studio.patch({ op: 'addScript', controlId: 'n1', controlAsset: 'server-control-template', path: 'earn.lua', source: `
function OnStart()
  game.ServerSignal("Earn"):SendSignal()
end
` })
  const restored = createStudio(studio.archiveData())
  assert.deepEqual(restored.get().serverLogic, { version: 1, enabled: false, rules })
  try {
    const disabled = restored.playStart()
    assert.deepEqual(disabled.server.vars.Player1, {})
    assert.equal(disabled.server.inbound[0].name, 'Earn')
    restored.patch({ op: 'setServerLogic', logic: { enabled: true, rules } })
    assert.equal(restored.playGet().server.logic.enabled, false)
    const enabled = restored.playStart()
    assert.equal(enabled.server.vars.Player1.Gold.value, 99)
    assert.equal(enabled.serverLogs.some(row => row.text.includes('logic init:')), false)
    const allDisabled = rules.map(rule => ({ ...rule, enabled: false }))
    restored.patch({ op: 'setServerLogic', logic: { rules: allDisabled } })
    assert.deepEqual(restored.playStart().server.vars.Player1, {})
    restored.patch({ op: 'setServerLogic', logic: { rules: [{ ...rules[0], enabled: true }, { ...rules[1], enabled: false }] } })
    assert.equal(restored.playStart().server.vars.Player1.Gold.value, 10)
  } finally { restored.playStop() }
})

test('multiplayer play isolates PlayerSelf per seat and view switches client snapshot', () => {
  const studio = createStudio()
  studio.patch({
    op: 'setServerLogic',
    logic: {
      rules: [{
        id: 'earn',
        signalName: 'Earn',
        actions: [
          { kind: 'setCustomVariable', entityType: 'PlayerSelf', name: 'Gold', value: { fromSignalParam: 0 } },
          { kind: 'sendClientScriptSignal', target: 'PlayerSelf', signalName: 'Ack', params: [{ fromSignalParam: 0 }] },
        ],
      }],
    },
  })
  studio.patch({
    op: 'addScript',
    controlId: 'n1',
    controlAsset: 'server-control-template',
    path: 'seat.lua',
    source: `
function OnStart()
  script:RegisterCustomVariableChangedHandler(Enum.CustomVariableEntityType.PlayerSelf, "Gold", function(entityType, name)
    print("gold", game.GetGlobalCustomVariableValue(entityType, name))
  end)
  script:RegisterServerSignalHandler("Ack", function(name, params)
    print("ack", params[1])
  end)
end
`,
  })

  const started = studio.playStart({ playerCount: 2 })
  assert.equal(started.playerCount, 2)
  assert.equal(started.viewPlayerIndex, 1)
  assert.equal(started.players.length, 2)

  studio.playServerSet('PlayerSelf', 'Gold', 1)
  studio.playSetView(2)
  studio.playServerSet('PlayerSelf', 'Gold', 2)
  const asTwo = studio.playGet()
  assert.equal(asTwo.viewPlayerIndex, 2)
  assert.equal(asTwo.server.vars.PlayerSelf.Gold.value, 2)
  assert.equal(asTwo.server.vars.Player1.Gold.value, 1)
  assert.equal(asTwo.server.vars.Player2.Gold.value, 2)
  assert.match(asTwo.logs.map((row) => row.text).join('\n'), /gold\t2/)
  assert.doesNotMatch(asTwo.logs.map((row) => row.text).join('\n'), /gold\t1/)

  studio.playSetView(1)
  const asOne = studio.playGet()
  assert.equal(asOne.viewPlayerIndex, 1)
  assert.equal(asOne.server.vars.PlayerSelf.Gold.value, 1)
  assert.match(asOne.logs.map((row) => row.text).join('\n'), /gold\t1/)

  studio.playServerSend('Ping', ['all'], 'AllPlayers')
  studio.playStop()
})

test('replay of saved history plus JSON/lua asserts passes, and a failing assert keeps the snapshot', () => {
  const studio = createStudio()
  studio.patch({
    op: 'addScript',
    controlId: 'n1',
    controlAsset: 'server-control-template',
    path: 'main',
    source: `
function OnStart()
  script.object.showCursor = true
  local button = script.object:FindChild("预设按钮")
  button:AddCursorEventListener(Enum.CursorEventType.CursorClick, function()
    print("replay-hit")
  end)
end
`,
  })
  studio.playStart()
  studio.playPointer('click', 800, 450)
  const spec = studio.playSaveCase({
    name: 'replay-click',
    asserts: [
      { kind: 'log', contains: 'replay-hit' },
      { kind: 'tree', name: '预设按钮', exists: true },
      {
        kind: 'lua',
        source: `
if not query.logContains("replay-hit") then error("missing replay-hit") end
local button = query.control("预设按钮")
if button == nil then error("missing button") end
`,
      },
    ],
  })
  const report = studio.playRunCase(spec)
  assert.equal(report.passed, true)
  assert.equal(report.results.length, 3)
  assert.ok(report.results.every((row) => row.ok))

  const failed = studio.playRunCase({
    ...spec,
    asserts: [{ kind: 'log', contains: 'this-log-does-not-exist' }],
  })
  assert.equal(failed.passed, false)
  assert.equal(failed.failedAt, 0)
  assert.ok(Array.isArray(failed.snapshot.logs))
  studio.playStop()
})

test('queue shorthand and unknown assert kinds are rejected instead of silently passing', () => {
  const spec = normalizeCase([
    { do: 'start' },
    { do: 'pointer', type: 'click', x: 800, y: 450 },
    { do: 'step', dt: 0.1 },
    { kind: 'log', contains: 'ok' },
  ])
  assert.equal(spec.events[0].kind, 'pointer')
  assert.ok(spec.asserts[0].at > 0)
  assert.throws(() => normalizeCase({ events: [], asserts: [{ kind: 'unknown' }] }), /unsupported assert kind/)
  const judged = evaluateAssert({ kind: 'log', contains: 'hit' }, { logs: [{ level: 'info', text: 'hit', time: 0 }] })
  assert.equal(judged.ok, true)
})
