import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, ENTITY_TYPES, PLAYER_SLOTS } from '../index.js'

test('Lua entity aliases remain Level / PlayerSelf / AvatarSelf; Player1-8 are extra slots', () => {
  const server = createServer()
  assert.deepEqual(ENTITY_TYPES, ['Level', 'PlayerSelf', 'AvatarSelf'])
  assert.deepEqual(PLAYER_SLOTS, ['Player1', 'Player2', 'Player3', 'Player4', 'Player5', 'Player6', 'Player7', 'Player8'])
  assert.throws(() => server.getVar('Enemy', 'Hp'), /unknown CustomVariableEntityType/)
  server.setVar('PlayerSelf', 'Gold', 3)
  assert.equal(server.getVar('Player1', 'Gold'), 3)
  assert.equal(server.getVar('PlayerSelf', 'Gold'), 3)
})

test('set then get records the value and missing Get returns undefined with engine log', () => {
  const server = createServer()
  const runtimeLogs = []
  server.attachRuntime({
    log(level, text) { runtimeLogs.push(`${level}:${text}`) },
  })
  server.setVar('PlayerSelf', 'Gold', 12)
  assert.equal(server.getVar('PlayerSelf', 'Gold'), 12)
  assert.equal(server.getVar('Level', 'Missing'), undefined)
  const snap = server.snapshot()
  assert.match(snap.logs.map((row) => row.text).join('\n'), /returning nil \(simulator policy\)/)
  assert.equal(snap.logs.every((row) => row.source === 'server'), true)
  assert.deepEqual(runtimeLogs, [])
})

test('same-value set still notifies handlers', () => {
  const server = createServer()
  const seen = []
  server.attachRuntime({
    notifyVarHandlers(entityType, name) { seen.push(`${entityType}.${name}`) },
  })
  server.setVar('Level', 'Score', 3)
  server.setVar('Level', 'Score', 3)
  assert.deepEqual(seen, ['Level.Score', 'Level.Score'])
  server.setVar('Level', 'Score', 4, { notify: false })
  assert.deepEqual(seen, ['Level.Score', 'Level.Score'])
})

test('integer range keeps the previous legal value', () => {
  const server = createServer()
  server.setVar('Level', 'Count', 7)
  assert.equal(server.setVar('Level', 'Count', -2147483648), -2147483648)
  assert.equal(server.getVar('Level', 'Count'), -2147483648)
  assert.equal(server.setVar('Level', 'Count', -2147483649), -2147483648)
  assert.equal(server.setVar('Level', 'Count', 2147483647), 2147483647)
})

test('duplicate define on the same entity fails', () => {
  const server = createServer()
  server.defineVar('AvatarSelf', 'Hp', { type: 'Int', defaultValue: 100 })
  assert.throws(() => server.defineVar('AvatarSelf', 'Hp', { type: 'Int' }), /already exists/)
})

test('Lua SendSignal records typed params in order', () => {
  const server = createServer()
  const entry = server.receiveFromClient('Battle_ReportKill', [
    { type: 'Int', value: 3 },
    { type: 'String', value: 'slime' },
    { type: 'Bool', value: true },
  ])
  assert.equal(entry.name, 'Battle_ReportKill')
  assert.deepEqual(entry.values, [3, 'slime', true])
  assert.equal(entry.params[0].type, 'Int')
  assert.equal(server.inbound().length, 1)
})

test('sendToClient delivers immediately in single-player policy and after latency when configured', () => {
  const immediate = []
  const delayed = []
  const solo = createServer()
  solo.attachRuntime({
    sendClientSignal(name, params) { immediate.push({ name, params }) },
  })
  solo.sendToClient('Battle_OnReward', [10])
  assert.deepEqual(immediate, [{ name: 'Battle_OnReward', params: [10] }])
  assert.equal(solo.outbound()[0].delivered, true)

  const online = createServer({ onlineLatencyMs: 100 })
  online.attachRuntime({
    sendClientSignal(name, params) { delayed.push({ name, params }) },
  })
  online.sendToClient('Battle_OnReward', [{ type: 'Int', value: 8 }])
  assert.equal(delayed.length, 0)
  online.flush(0.05)
  assert.equal(delayed.length, 0)
  online.flush(0.1)
  assert.deepEqual(delayed, [{ name: 'Battle_OnReward', params: [8] }])
})

test('server logic listens to a signal, writes Level/PlayerSelf variables, and sends to PlayerSelf', () => {
  const received = []
  const changed = []
  const server = createServer({
    logic: {
      rules: [{
        id: 'earn-gold',
        signalName: 'EarnGold',
        actions: [
          { kind: 'setCustomVariable', entityType: 'PlayerSelf', name: 'Gold', value: { fromSignalParam: 0 } },
          { kind: 'setCustomVariable', entityType: 'Level', name: 'LastReward', value: 'gold' },
          {
            kind: 'sendClientScriptSignal',
            target: 'PlayerSelf',
            signalName: 'GoldChanged',
            params: [{ fromSignalParam: 0 }, 'ok'],
          },
        ],
      }],
    },
  })
  server.attachRuntime({
    notifyVarHandlers(entityType, name) { changed.push(`${entityType}.${name}`) },
    sendClientSignal(name, params) { received.push({ name, params }) },
  })

  server.receiveFromClient('EarnGold', [{ type: 'Int', value: 9 }])

  assert.equal(server.getVar('PlayerSelf', 'Gold'), 9)
  assert.equal(server.getVar('Level', 'LastReward'), 'gold')
  assert.deepEqual(changed, ['PlayerSelf.Gold', 'Level.LastReward'])
  assert.deepEqual(received, [{ name: 'GoldChanged', params: [9, 'ok'] }])
  assert.deepEqual(server.outbound()[0].params, [{ type: 'Int', value: 9 }, { type: 'String', value: 'ok' }])
  assert.equal(server.outbound()[0].target, 'PlayerSelf')
  assert.equal(server.snapshot().logic.rules[0].actions[2].target, 'PlayerSelf')
  assert.throws(() => server.sendToClient('BadTarget', [], { target: 'AvatarSelf' }), /PlayerSelf, AllPlayers, or Player1-8/)
  assert.throws(() => createServer({
    logic: { rules: [{ signalName: 'Bad', actions: [{ kind: 'setCustomVariable', entityType: 'AvatarSelf', name: 'Hp', value: 1 }] }] },
  }), /must be Level, PlayerSelf, or Player1-8/)
})

test('multiplayer PlayerSelf is relative to the sender; named seats and AllPlayers route independently', () => {
  const received = { 1: [], 2: [] }
  const changed = { 1: [], 2: [] }
  const server = createServer({
    playerCount: 2,
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
  server.attachRuntime({
    notifyVarHandlers(entityType, name) { changed[1].push(`${entityType}.${name}`) },
    sendClientSignal(name, params) { received[1].push({ name, params }) },
  }, { playerIndex: 1 })
  server.attachRuntime({
    notifyVarHandlers(entityType, name) { changed[2].push(`${entityType}.${name}`) },
    sendClientSignal(name, params) { received[2].push({ name, params }) },
  }, { playerIndex: 2 })

  server.receiveFromClient('Earn', [{ type: 'Int', value: 5 }], { playerIndex: 1 })
  server.receiveFromClient('Earn', [{ type: 'Int', value: 9 }], { playerIndex: 2 })

  assert.equal(server.getVar('Player1', 'Gold'), 5)
  assert.equal(server.getVar('Player2', 'Gold'), 9)
  assert.equal(server.getVar('PlayerSelf', 'Gold', { playerIndex: 2 }), 9)
  assert.deepEqual(changed[1], ['PlayerSelf.Gold'])
  assert.deepEqual(changed[2], ['PlayerSelf.Gold'])
  assert.deepEqual(received[1], [{ name: 'Ack', params: [5] }])
  assert.deepEqual(received[2], [{ name: 'Ack', params: [9] }])

  received[1] = []
  received[2] = []
  server.sendToClient('Ping', ['all'], { target: 'AllPlayers' })
  assert.deepEqual(received[1], [{ name: 'Ping', params: ['all'] }])
  assert.deepEqual(received[2], [{ name: 'Ping', params: ['all'] }])
  received[1] = []
  received[2] = []
  server.sendToClient('Ping', ['p2'], { target: 'Player2' })
  assert.deepEqual(received[1], [])
  assert.deepEqual(received[2], [{ name: 'Ping', params: ['p2'] }])
})

test('unsupported node graph fails instead of pretending to run', () => {
  const server = createServer()
  assert.throws(
    () => server.loadConfig({ nodes: [{ kind: 'create-creature', name: '刷怪' }] }),
    /unsupported server node/,
  )
  server.loadConfig({
    nodes: [{ kind: 'set-custom-variable' }, { kind: 'send-client-script-signal' }],
    vars: [{ entityType: 'Level', name: 'Wave', type: 'Int', defaultValue: 1 }],
  })
  assert.equal(server.getVar('Level', 'Wave'), 1)
})

test('snapshot is lossless JSON without host references', () => {
  const server = createServer()
  server.setVar('PlayerSelf', 'Gold', 5)
  server.receiveFromClient('Ping', ['ok'])
  const snap = server.snapshot()
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(snap)))
  assert.equal(snap.vars.PlayerSelf.Gold.value, 5)
  assert.equal(snap.inbound[0].name, 'Ping')
})
