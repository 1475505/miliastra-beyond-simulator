/** Thin single-process server: custom variables + signals + a small executable rule set. No full node graph. */

export const MAX_PLAYERS = 8
export const PLAYER_SLOTS = Object.freeze(Array.from({ length: MAX_PLAYERS }, (_, i) => `Player${i + 1}`))
export const AVATAR_SLOTS = Object.freeze(Array.from({ length: MAX_PLAYERS }, (_, i) => `Avatar${i + 1}`))

/** Lua `Enum.CustomVariableEntityType` — relative to the calling client. */
export const ENTITY_TYPES = Object.freeze(['Level', 'PlayerSelf', 'AvatarSelf'])
export const PLAYER_ENTITY_TYPES = PLAYER_SLOTS
export const AVATAR_ENTITY_TYPES = AVATAR_SLOTS
export const ALL_ENTITY_TYPES = Object.freeze([...ENTITY_TYPES, ...PLAYER_SLOTS, ...AVATAR_SLOTS])
export const CLIENT_SIGNAL_TARGETS = Object.freeze(['PlayerSelf', 'AllPlayers', ...PLAYER_SLOTS])
export const LOGIC_ENTITY_TYPES = Object.freeze(['Level', 'PlayerSelf', ...PLAYER_SLOTS])

export const VAR_TYPES = Object.freeze([
  'Int', 'Float', 'String', 'Bool', 'Vector3', 'Entity', 'Guid', 'PrefabId', 'ConfigId',
  'IntList', 'FloatList', 'StringList', 'BoolList', 'Vector3List',
  'EntityList', 'GuidList', 'PrefabIdList', 'ConfigIdList',
  'Dict', 'Struct',
])

const INT_MIN = -2147483648
const INT_MAX = 2147483647

const SIGNAL_OR_VAR_NODES = new Set([
  'set-custom-variable',
  'get-custom-variable',
  'custom-variable-changed',
  '设置自定义变量',
  '获取自定义变量',
  '自定义变量变化时',
  'send-signal',
  'listen-signal',
  'send-client-script-signal',
  '发送信号',
  '监听信号',
  '发送客户端脚本信号',
  'setVar',
  'getVar',
  'signal',
  'var',
])

export function playerEntity(index) {
  return `Player${Number(index)}`
}

export function avatarEntity(index) {
  return `Avatar${Number(index)}`
}

export function playerIndexOf(name) {
  const match = String(name || '').match(/^(?:Player|Avatar)([1-8])$/)
  return match ? Number(match[1]) : 0
}

export function normalizePlayerCount(raw) {
  if (raw === undefined || raw === null || raw === '') return 1
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 1 || value > MAX_PLAYERS) {
    throw new Error(`playerCount must be an integer 1-${MAX_PLAYERS}`)
  }
  return value
}

export function normalizePlayerIndex(raw, playerCount = MAX_PLAYERS) {
  const count = normalizePlayerCount(playerCount)
  if (raw === undefined || raw === null || raw === '') return 1
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 1 || value > count) {
    throw new Error(`playerIndex must be an integer 1-${count}`)
  }
  return value
}

function emptyBags() {
  const bags = {
    Level: Object.create(null),
    PlayerSelf: Object.create(null),
    AvatarSelf: Object.create(null),
  }
  for (const name of PLAYER_SLOTS) bags[name] = Object.create(null)
  for (const name of AVATAR_SLOTS) bags[name] = Object.create(null)
  return bags
}

function requireEntity(entityType) {
  const name = String(entityType || '')
  if (!ALL_ENTITY_TYPES.includes(name)) {
    throw new Error(`unknown CustomVariableEntityType: ${entityType}`)
  }
  return name
}

function requireLogicEntity(entityType, label) {
  const name = requireEntity(entityType)
  if (!LOGIC_ENTITY_TYPES.includes(name)) {
    throw new Error(`${label}.entityType must be Level, PlayerSelf, or Player1-8`)
  }
  return name
}

function requireName(name) {
  const value = String(name ?? '')
  if (!value) throw new Error('custom variable name is required')
  return value
}

function requireSignalName(name) {
  const value = String(name ?? '')
  if (!value) throw new Error('signal name is required')
  return value
}

function requireClientSignalTarget(target) {
  const value = String(target || 'PlayerSelf')
  if (!CLIENT_SIGNAL_TARGETS.includes(value)) {
    throw new Error(`unsupported client signal target: ${target}. use PlayerSelf, AllPlayers, or Player1-8`)
  }
  return value
}

function inferType(value) {
  if (value === null || value === undefined) return ''
  if (typeof value === 'boolean') return 'Bool'
  if (typeof value === 'string') return 'String'
  if (typeof value === 'number') return Number.isInteger(value) ? 'Int' : 'Float'
  if (Array.isArray(value)) {
    if (value.length === 0) return 'IntList'
    const inner = inferType(value[0])
    if (inner && !inner.endsWith('List') && inner !== 'Dict' && inner !== 'Struct') return `${inner}List`
    return 'IntList'
  }
  if (value && typeof value === 'object') {
    if ('x' in value || 'y' in value || 'z' in value) return 'Vector3'
    return 'Dict'
  }
  return ''
}

function cloneJson(value) {
  if (value === undefined) return null
  return JSON.parse(JSON.stringify(value))
}

function valuesOfParams(params) {
  if (!Array.isArray(params)) return []
  return params.map((item) => {
    if (item && typeof item === 'object' && Object.prototype.hasOwnProperty.call(item, 'value') && ('type' in item)) {
      return item.value
    }
    return item
  })
}

function typedParams(params) {
  if (!Array.isArray(params)) return []
  return params.map((item) => {
    if (item && typeof item === 'object' && Object.prototype.hasOwnProperty.call(item, 'value') && ('type' in item)) {
      return { type: String(item.type || ''), value: item.value }
    }
    return { type: inferType(item), value: item }
  })
}

function nodeKind(node) {
  return String(node?.kind || node?.type || node?.name || node?.id || '')
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function signalParamReference(value, label) {
  if (!isPlainObject(value) || !Object.prototype.hasOwnProperty.call(value, 'fromSignalParam')) return null
  if (Object.keys(value).some((key) => key !== 'fromSignalParam')) {
    throw new Error(`${label}.fromSignalParam cannot be combined with literal fields`)
  }
  const index = Number(value.fromSignalParam)
  if (!Number.isSafeInteger(index) || index < 0) {
    throw new Error(`${label}.fromSignalParam must be a non-negative integer`)
  }
  return { fromSignalParam: index }
}

function normalizeValueSpec(value, label) {
  return signalParamReference(value, label) || cloneJson(value)
}

function normalizeLogicAction(raw, ruleIndex, actionIndex) {
  if (!isPlainObject(raw)) throw new Error(`serverLogic.rules[${ruleIndex}].actions[${actionIndex}] must be an object`)
  const kind = String(raw.kind || raw.type || '')
  const label = `serverLogic.rules[${ruleIndex}].actions[${actionIndex}]`
  if (kind === 'setCustomVariable') {
    const entityType = requireLogicEntity(raw.entityType, label)
    const hasValue = Object.prototype.hasOwnProperty.call(raw, 'value')
    if (!hasValue) throw new Error(`${label}.value is required`)
    return {
      kind,
      entityType,
      name: requireName(raw.name),
      value: normalizeValueSpec(raw.value, `${label}.value`),
      ...(raw.variableType ? { variableType: String(raw.variableType) } : {}),
    }
  }
  if (kind === 'sendClientScriptSignal') {
    if (!Array.isArray(raw.params)) throw new Error(`${label}.params must be an array`)
    return {
      kind,
      target: requireClientSignalTarget(raw.target),
      signalName: requireSignalName(raw.signalName),
      params: raw.params.map((value, index) => normalizeValueSpec(value, `${label}.params[${index}]`)),
    }
  }
  throw new Error(`${label}.kind must be setCustomVariable or sendClientScriptSignal`)
}

/**
 * Lightweight executable server-logic format. It intentionally models only
 * the operations exposed in the Studio: signal listener, variable write, and
 * a client-script signal to PlayerSelf / a named player / AllPlayers.
 * It is not an official node-graph file format.
 */
export function normalizeServerLogic(raw) {
  if (raw === undefined || raw === null) return { version: 1, rules: [] }
  if (!isPlainObject(raw)) throw new Error('serverLogic must be an object')
  const inputRules = raw.rules === undefined ? [] : raw.rules
  if (!Array.isArray(inputRules)) throw new Error('serverLogic.rules must be an array')
  return {
    version: 1,
    rules: inputRules.map((rawRule, ruleIndex) => {
      if (!isPlainObject(rawRule)) throw new Error(`serverLogic.rules[${ruleIndex}] must be an object`)
      if (!Array.isArray(rawRule.actions) || rawRule.actions.length === 0) {
        throw new Error(`serverLogic.rules[${ruleIndex}].actions must be a non-empty array`)
      }
      return {
        id: String(rawRule.id || `signal-${ruleIndex + 1}`),
        signalName: requireSignalName(rawRule.signalName),
        actions: rawRule.actions.map((action, actionIndex) => normalizeLogicAction(action, ruleIndex, actionIndex)),
      }
    }),
  }
}

function resolveLogicValue(spec, entry, { typed = false } = {}) {
  const ref = signalParamReference(spec, 'server logic value')
  if (ref) {
    const values = typed ? entry.params : entry.values
    if (ref.fromSignalParam >= values.length) {
      throw new Error(`signal ${entry.name} has no parameter at index ${ref.fromSignalParam}`)
    }
    return cloneJson(values[ref.fromSignalParam])
  }
  return cloneJson(spec)
}

function luaEntityForSlot(slot) {
  if (slot === 'Level') return 'Level'
  if (PLAYER_SLOTS.includes(slot)) return 'PlayerSelf'
  if (AVATAR_SLOTS.includes(slot)) return 'AvatarSelf'
  return slot
}

export function createServer(options = {}) {
  const bags = emptyBags()
  const meta = emptyBags()
  const inbound = []
  const outbound = []
  const pendingClient = []
  const logs = []
  const runtimes = Array.from({ length: MAX_PLAYERS + 1 }, () => null)
  let seq = 1
  let clock = 0
  let onlineLatencyMs = Number(options.onlineLatencyMs || 0)
  if (!Number.isFinite(onlineLatencyMs) || onlineLatencyMs < 0) onlineLatencyMs = 0
  let logic = normalizeServerLogic(options.logic)
  let playerCount = normalizePlayerCount(options.playerCount)
  let viewPlayerIndex = normalizePlayerIndex(options.viewPlayerIndex, playerCount)

  function log(level, text) {
    logs.push({
      source: 'server',
      level: String(level || 'engine'),
      text: String(text),
      time: clock,
    })
  }

  function syncRuntimeClock(playerIndex) {
    const rt = runtimes[playerIndex || viewPlayerIndex]
    const time = Number(rt?.clock?.time)
    if (Number.isFinite(time)) clock = time
  }

  function record(entityType, name, value, type) {
    bags[entityType][name] = value
    meta[entityType][name] = { type: type || inferType(value) || meta[entityType][name]?.type || '' }
  }

  function applyIntRange(entityType, name, value) {
    if (typeof value !== 'number' || !Number.isInteger(value)) return { ok: true, value }
    if (value >= INT_MIN && value <= INT_MAX) return { ok: true, value }
    log('engine', `Int custom variable ${entityType}.${name} out of range ${value}; keeping previous legal value`)
    return { ok: false, value: bags[entityType][name] }
  }

  function resolveSlot(entityType, relativePlayerIndex) {
    const et = requireEntity(entityType)
    const player = relativePlayerIndex || viewPlayerIndex
    if (et === 'PlayerSelf') return playerEntity(player)
    if (et === 'AvatarSelf') return avatarEntity(player)
    return et
  }

  function notifySlot(slot, name) {
    const luaEntity = luaEntityForSlot(slot)
    if (slot === 'Level') {
      for (let i = 1; i <= playerCount; i += 1) {
        const rt = runtimes[i]
        if (rt && typeof rt.notifyVarHandlers === 'function') rt.notifyVarHandlers('Level', name)
      }
      return
    }
    const index = playerIndexOf(slot)
    if (!index) return
    const rt = runtimes[index]
    if (rt && typeof rt.notifyVarHandlers === 'function') rt.notifyVarHandlers(luaEntity, name)
  }

  function deliveryPlayers(target, relativePlayerIndex) {
    const resolved = requireClientSignalTarget(target)
    if (resolved === 'AllPlayers') return Array.from({ length: playerCount }, (_, i) => i + 1)
    if (resolved === 'PlayerSelf') return [relativePlayerIndex || viewPlayerIndex]
    return [playerIndexOf(resolved)]
  }

  function runLogic(entry) {
    for (const rule of logic.rules) {
      if (rule.signalName !== entry.name) continue
      for (const action of rule.actions) {
        if (action.kind === 'setCustomVariable') {
          const value = resolveLogicValue(action.value, entry)
          api.setVar(action.entityType, action.name, value, { type: action.variableType, playerIndex: entry.playerIndex })
          log('info', `logic ${rule.id}: set ${action.entityType}.${action.name}`)
          continue
        }
        if (action.kind === 'sendClientScriptSignal') {
          const params = action.params.map((value) => resolveLogicValue(value, entry, { typed: true }))
          api.sendToClient(action.signalName, params, { target: action.target, playerIndex: entry.playerIndex })
          log('info', `logic ${rule.id}: sent ${action.signalName} to ${action.target}`)
        }
      }
    }
  }

  function bindRuntime(runtime, playerIndex) {
    if (!runtime) return
    runtime.serverBridge = {
      getVar: (entityType, name) => api.getVar(entityType, name, { playerIndex }),
      setVar: (entityType, name, value) => api.setVar(entityType, name, value, { playerIndex }),
      receiveFromClient: (signalName, params) => api.receiveFromClient(signalName, params, { playerIndex }),
    }
  }

  function unbindRuntime(runtime) {
    if (runtime) runtime.serverBridge = null
  }

  const api = {
    ENTITY_TYPES,
    ALL_ENTITY_TYPES,
    CLIENT_SIGNAL_TARGETS,
    get clock() { return clock },
    get playerCount() { return playerCount },
    get viewPlayerIndex() { return viewPlayerIndex },
    setClock(time) {
      clock = Number(time) || 0
    },
    setPlayerCount(next) {
      playerCount = normalizePlayerCount(next)
      if (viewPlayerIndex > playerCount) viewPlayerIndex = playerCount
      return playerCount
    },
    setViewPlayerIndex(next) {
      viewPlayerIndex = normalizePlayerIndex(next, playerCount)
      return viewPlayerIndex
    },

    log(level, text) {
      log(level, text)
    },

    defineVar(entityType, name, spec = {}, { playerIndex } = {}) {
      const slot = resolveSlot(entityType, playerIndex)
      const key = requireName(name)
      if (Object.prototype.hasOwnProperty.call(bags[slot], key)) {
        throw new Error(`custom variable already exists: ${slot}.${key}`)
      }
      const type = spec.type ? String(spec.type) : inferType(spec.value ?? spec.defaultValue)
      if (type && !VAR_TYPES.includes(type)) throw new Error(`unsupported custom variable type: ${type}`)
      const value = spec.value !== undefined ? spec.value : (spec.defaultValue !== undefined ? spec.defaultValue : null)
      record(slot, key, value, type)
      return api.getVar(slot, key)
    },

    getVar(entityType, name, { playerIndex } = {}) {
      const slot = resolveSlot(entityType, playerIndex)
      const key = requireName(name)
      if (!Object.prototype.hasOwnProperty.call(bags[slot], key)) {
        log('engine', `GetGlobalCustomVariableValue missing ${slot}.${key}; returning nil (simulator policy)`)
        return undefined
      }
      return bags[slot][key]
    },

    setVar(entityType, name, value, { notify = true, type, playerIndex } = {}) {
      const slot = resolveSlot(entityType, playerIndex)
      const key = requireName(name)
      const declared = type || meta[slot][key]?.type || inferType(value)
      if (declared && !VAR_TYPES.includes(declared) && declared !== '') {
        throw new Error(`unsupported custom variable type: ${declared}`)
      }
      let next = value
      if (declared === 'Int' || (declared === '' && typeof value === 'number' && Number.isInteger(value))) {
        const ranged = applyIntRange(slot, key, value)
        next = ranged.value
        if (next === undefined) return undefined
      }
      record(slot, key, next, declared)
      if (notify) notifySlot(slot, key)
      return next
    },

    listVars(entityType) {
      const types = entityType ? [resolveSlot(entityType)] : ['Level', ...Array.from({ length: playerCount }, (_, i) => playerEntity(i + 1)), ...Array.from({ length: playerCount }, (_, i) => avatarEntity(i + 1))]
      const out = []
      for (const et of types) {
        for (const name of Object.keys(bags[et])) {
          out.push({
            entityType: et,
            name,
            type: meta[et][name]?.type || '',
            value: cloneJson(bags[et][name]),
          })
        }
      }
      return out
    },

    receiveFromClient(name, params = [], { playerIndex } = {}) {
      const sender = normalizePlayerIndex(playerIndex || viewPlayerIndex, playerCount)
      syncRuntimeClock(sender)
      const signalName = requireSignalName(name)
      const entry = {
        id: seq++,
        direction: 'inbound',
        name: signalName,
        params: typedParams(params),
        values: valuesOfParams(params),
        time: clock,
        playerIndex: sender,
        from: playerEntity(sender),
      }
      inbound.push(entry)
      runLogic(entry)
      return entry
    },

    sendToClient(name, params = [], { target = 'PlayerSelf', playerIndex } = {}) {
      const signalName = requireSignalName(name)
      const clientTarget = requireClientSignalTarget(target)
      const relative = playerIndex || viewPlayerIndex
      const players = deliveryPlayers(clientTarget, relative)
      const entry = {
        id: seq++,
        direction: 'outbound',
        name: signalName,
        params: typedParams(params),
        values: valuesOfParams(params),
        time: clock,
        target: clientTarget,
        players,
        deliverAt: clock + (onlineLatencyMs / 1000),
        delivered: false,
      }
      outbound.push(entry)
      if (onlineLatencyMs === 0) api.deliver(entry)
      else pendingClient.push(entry)
      return entry
    },

    getLogic() {
      return cloneJson(logic)
    },

    setLogic(next) {
      logic = normalizeServerLogic(next)
      return api.getLogic()
    },

    deliver(entry) {
      if (!entry || entry.delivered) return
      entry.delivered = true
      const players = Array.isArray(entry.players) && entry.players.length
        ? entry.players
        : deliveryPlayers(entry.target)
      for (const index of players) {
        const rt = runtimes[index]
        if (rt && typeof rt.sendClientSignal === 'function') {
          rt.sendClientSignal(entry.name, entry.values)
        }
      }
    },

    flush(time) {
      if (time !== undefined) clock = Number(time) || 0
      const ready = []
      for (let i = pendingClient.length - 1; i >= 0; i -= 1) {
        if (pendingClient[i].deliverAt <= clock) {
          ready.push(pendingClient.splice(i, 1)[0])
        }
      }
      ready.sort((a, b) => a.id - b.id)
      for (const entry of ready) api.deliver(entry)
      return ready
    },

    inbound() {
      return inbound.slice()
    },

    outbound() {
      return outbound.slice()
    },

    loadConfig(config) {
      if (config == null) return
      if (typeof config !== 'object') throw new Error('server config must be an object')
      if (config.graph && !Array.isArray(config.nodes)) {
        throw new Error('unsupported server node graph: v1 only accepts custom variables and signals')
      }
      for (const node of config.nodes || []) {
        const kind = nodeKind(node)
        if (!SIGNAL_OR_VAR_NODES.has(kind)) {
          throw new Error(`unsupported server node: ${kind || JSON.stringify(node)}. v1 only supports custom variables and signals`)
        }
      }
      if (config.onlineLatencyMs !== undefined) {
        const ms = Number(config.onlineLatencyMs)
        if (!Number.isFinite(ms) || ms < 0) throw new Error('onlineLatencyMs must be a non-negative finite number')
        onlineLatencyMs = ms
      }
      if (config.playerCount !== undefined) api.setPlayerCount(config.playerCount)
      if (config.viewPlayerIndex !== undefined) api.setViewPlayerIndex(config.viewPlayerIndex)
      if (config.logic !== undefined || config.serverLogic !== undefined) {
        api.setLogic(config.logic ?? config.serverLogic)
      }
      for (const row of config.vars || []) {
        const slot = resolveSlot(row.entityType)
        const key = requireName(row.name)
        if (Object.prototype.hasOwnProperty.call(bags[slot], key)) {
          api.setVar(slot, key, row.value ?? row.defaultValue, { notify: false, type: row.type })
        } else {
          api.defineVar(slot, key, row)
        }
      }
    },

    attachRuntime(next, { playerIndex = 1 } = {}) {
      const index = normalizePlayerIndex(playerIndex, MAX_PLAYERS)
      if (runtimes[index] && runtimes[index] !== next) unbindRuntime(runtimes[index])
      runtimes[index] = next || null
      bindRuntime(runtimes[index], index)
      return api
    },

    attachRuntimes(list) {
      api.detachRuntime()
      const rows = Array.isArray(list) ? list : []
      for (let i = 0; i < rows.length && i < MAX_PLAYERS; i += 1) {
        runtimes[i + 1] = rows[i] || null
        bindRuntime(runtimes[i + 1], i + 1)
      }
      return api
    },

    detachRuntime() {
      for (let i = 1; i <= MAX_PLAYERS; i += 1) {
        unbindRuntime(runtimes[i])
        runtimes[i] = null
      }
    },

    snapshot() {
      const viewPlayer = playerEntity(viewPlayerIndex)
      const viewAvatar = avatarEntity(viewPlayerIndex)
      const vars = {
        Level: {},
        PlayerSelf: {},
        AvatarSelf: {},
      }
      for (const name of Object.keys(bags.Level)) {
        vars.Level[name] = { type: meta.Level[name]?.type || '', value: cloneJson(bags.Level[name]) }
      }
      for (const name of Object.keys(bags[viewPlayer])) {
        vars.PlayerSelf[name] = { type: meta[viewPlayer][name]?.type || '', value: cloneJson(bags[viewPlayer][name]) }
      }
      for (const name of Object.keys(bags[viewAvatar])) {
        vars.AvatarSelf[name] = { type: meta[viewAvatar][name]?.type || '', value: cloneJson(bags[viewAvatar][name]) }
      }
      for (let i = 1; i <= playerCount; i += 1) {
        const player = playerEntity(i)
        const avatar = avatarEntity(i)
        vars[player] = {}
        vars[avatar] = {}
        for (const name of Object.keys(bags[player])) {
          vars[player][name] = { type: meta[player][name]?.type || '', value: cloneJson(bags[player][name]) }
        }
        for (const name of Object.keys(bags[avatar])) {
          vars[avatar][name] = { type: meta[avatar][name]?.type || '', value: cloneJson(bags[avatar][name]) }
        }
      }
      return {
        clock,
        onlineLatencyMs,
        playerCount,
        viewPlayerIndex,
        logic: api.getLogic(),
        vars,
        inbound: inbound.map((row) => ({
          id: row.id,
          name: row.name,
          params: cloneJson(row.params),
          values: cloneJson(row.values),
          time: row.time,
          playerIndex: row.playerIndex,
          from: row.from,
        })),
        outbound: outbound.map((row) => ({
          id: row.id,
          name: row.name,
          params: cloneJson(row.params),
          values: cloneJson(row.values),
          time: row.time,
          target: row.target,
          players: Array.isArray(row.players) ? row.players.slice() : [],
          deliverAt: row.deliverAt,
          delivered: !!row.delivered,
        })),
        logs: logs.map((row) => ({
          source: 'server',
          level: row.level,
          text: row.text,
          time: row.time,
        })),
      }
    },

    reset() {
      for (const et of ALL_ENTITY_TYPES) {
        for (const key of Object.keys(bags[et])) delete bags[et][key]
        for (const key of Object.keys(meta[et])) delete meta[et][key]
      }
      inbound.length = 0
      outbound.length = 0
      pendingClient.length = 0
      logs.length = 0
      seq = 1
      clock = 0
    },

    destroy() {
      api.detachRuntime()
      api.reset()
    },
  }

  if (options.config) api.loadConfig(options.config)
  for (const row of options.vars || []) api.defineVar(row.entityType, row.name, row)
  return api
}
