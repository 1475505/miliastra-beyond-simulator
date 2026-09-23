export const CASE_FORMAT = 'qxqy-autotest'
export const CASE_VERSION = 1
export const DEFAULT_DT = 1 / 30

const EVENT_KINDS = new Set(['pointer', 'key', 'click', 'pause', 'resume', 'serverSet', 'serverSend', 'view'])
const ASSERT_KINDS = new Set(['log', 'control', 'var', 'signal', 'tree', 'lua'])

function finiteNumber(value, label) {
  const n = Number(value)
  if (!Number.isFinite(n)) throw new Error(`${label} must be a finite number`)
  return n
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value ?? null))
}

function normalizeEvent(raw, index) {
  if (!raw || typeof raw !== 'object') throw new Error(`events[${index}] must be an object`)
  const kind = String(raw.kind || raw.do || '')
  if (!EVENT_KINDS.has(kind)) throw new Error(`unsupported event kind: ${kind || '(empty)'}`)
  const payload = raw.payload && typeof raw.payload === 'object' ? { ...raw.payload } : {}
  if (kind === 'pointer') {
    if (!payload.type && raw.type) payload.type = raw.type
    if (payload.x === undefined) payload.x = raw.x
    if (payload.y === undefined) payload.y = raw.y
    payload.x = finiteNumber(payload.x, 'pointer.x')
    payload.y = finiteNumber(payload.y, 'pointer.y')
    payload.type = String(payload.type || 'click')
  } else if (kind === 'key') {
    payload.typeName = String(payload.typeName || payload.key || raw.typeName || raw.key || '')
    if (!payload.typeName) throw new Error('key event requires typeName')
  } else if (kind === 'click') {
    payload.name = String(payload.name || raw.name || '')
    if (!payload.name) throw new Error('click event requires control name')
  } else if (kind === 'serverSet') {
    payload.entityType = String(payload.entityType || raw.entityType || '')
    payload.name = String(payload.name || raw.name || '')
    if (payload.value === undefined) payload.value = raw.value
    if (payload.value === undefined) payload.value = null
    if (!payload.entityType || !payload.name) throw new Error('serverSet requires entityType and name')
  } else if (kind === 'serverSend') {
    payload.name = String(payload.name || raw.name || '')
    payload.params = Array.isArray(payload.params) ? payload.params : (Array.isArray(raw.params) ? raw.params : [])
    payload.target = String(payload.target || raw.target || 'PlayerSelf')
    if (!payload.name) throw new Error('serverSend requires signal name')
  } else if (kind === 'view') {
    payload.playerIndex = Number(payload.playerIndex || payload.viewPlayerIndex || raw.playerIndex || raw.viewPlayerIndex || 0)
    if (!Number.isInteger(payload.playerIndex) || payload.playerIndex < 1) throw new Error('view event requires playerIndex 1-8')
  }
  return {
    t: finiteNumber(raw.t ?? 0, 'event.t'),
    source: String(raw.source || 'user'),
    kind,
    payload,
  }
}

function normalizeAssert(raw, index) {
  if (!raw || typeof raw !== 'object') throw new Error(`asserts[${index}] must be an object`)
  const kind = String(raw.kind || (raw.check ? 'log' : ''))
  if (!ASSERT_KINDS.has(kind)) throw new Error(`unsupported assert kind: ${kind || '(empty)'}`)
  const row = { kind }
  if (raw.at !== undefined) row.at = finiteNumber(raw.at, 'assert.at')
  if (kind === 'log') {
    row.contains = String(raw.contains || raw.check || raw.text || '')
    row.source = raw.source === 'server' ? 'server' : 'client'
    if (raw.level) row.level = String(raw.level)
    if (!row.contains) throw new Error('log assert requires contains')
  } else if (kind === 'control') {
    row.id = raw.id ? String(raw.id) : ''
    row.name = raw.name ? String(raw.name) : ''
    row.field = String(raw.field || '')
    if (!row.field) throw new Error('control assert requires field')
    if (!row.id && !row.name) throw new Error('control assert requires id or name')
    if (!Object.prototype.hasOwnProperty.call(raw, 'equals')) throw new Error('control assert requires equals')
    row.equals = cloneJson(raw.equals)
  } else if (kind === 'var') {
    row.entityType = String(raw.entityType || '')
    row.name = String(raw.name || '')
    if (!row.entityType || !row.name) throw new Error('var assert requires entityType and name')
    if (!Object.prototype.hasOwnProperty.call(raw, 'equals')) throw new Error('var assert requires equals')
    row.equals = cloneJson(raw.equals)
  } else if (kind === 'signal') {
    row.direction = raw.direction === 'outbound' ? 'outbound' : 'inbound'
    row.name = String(raw.name || '')
    if (!row.name) throw new Error('signal assert requires name')
    if (raw.values !== undefined) row.values = cloneJson(raw.values)
  } else if (kind === 'tree') {
    row.name = String(raw.name || '')
    row.exists = raw.exists !== false
    if (!row.name) throw new Error('tree assert requires name')
  } else if (kind === 'lua') {
    row.source = String(raw.source || '')
    if (!row.source.trim()) throw new Error('lua assert requires source')
  }
  return row
}

function fromQueue(steps) {
  let t = 0
  const events = []
  const asserts = []
  for (const step of steps) {
    if (!step || typeof step !== 'object') throw new Error('queue step must be an object')
    if (step.do === 'start') continue
    if (step.do === 'step') {
      t += finiteNumber(step.dt ?? DEFAULT_DT, 'step.dt')
      continue
    }
    if (step.do === 'pointer' || step.do === 'key' || step.do === 'click' || step.do === 'pause' || step.do === 'resume' || step.do === 'serverSet' || step.do === 'serverSend' || step.do === 'view') {
      events.push(normalizeEvent({ ...step, kind: step.do, t }, events.length))
      continue
    }
    if (step.assert || step.check || step.kind) {
      asserts.push(normalizeAssert({ ...(step.assert || step), at: step.at ?? t }, asserts.length))
      continue
    }
    throw new Error(`unsupported queue step: ${JSON.stringify(step)}`)
  }
  return { events, asserts, dt: DEFAULT_DT }
}

export function normalizeCase(raw) {
  if (Array.isArray(raw)) {
    const converted = fromQueue(raw)
    return {
      format: CASE_FORMAT,
      version: CASE_VERSION,
      name: '',
      dt: converted.dt,
      events: converted.events,
      asserts: converted.asserts,
    }
  }
  if (!raw || typeof raw !== 'object') throw new Error('autotest case must be an object or step array')
  if (Array.isArray(raw.queue) || Array.isArray(raw.steps)) {
    const converted = fromQueue(raw.queue || raw.steps)
    return {
      format: CASE_FORMAT,
      version: CASE_VERSION,
      name: String(raw.name || ''),
      dt: Number(raw.dt) > 0 ? Number(raw.dt) : converted.dt,
      events: converted.events,
      asserts: converted.asserts,
    }
  }
  const events = (raw.events || []).map((row, i) => normalizeEvent(row, i))
  const asserts = (raw.asserts || []).map((row, i) => normalizeAssert(row, i))
  events.sort((a, b) => a.t - b.t || 0)
  return {
    format: CASE_FORMAT,
    version: CASE_VERSION,
    name: String(raw.name || ''),
    dt: Number(raw.dt) > 0 ? Number(raw.dt) : DEFAULT_DT,
    playerCount: Number(raw.playerCount) > 0 ? Number(raw.playerCount) : 1,
    events,
    asserts,
  }
}

export function caseFromHistory(history, extras = {}) {
  const events = (history || []).map((row, i) => normalizeEvent(row, i))
  return {
    format: CASE_FORMAT,
    version: CASE_VERSION,
    name: String(extras.name || ''),
    dt: Number(extras.dt) > 0 ? Number(extras.dt) : DEFAULT_DT,
    playerCount: Number(extras.playerCount) > 0 ? Number(extras.playerCount) : 1,
    events,
    asserts: (extras.asserts || []).map((row, i) => normalizeAssert(row, i)),
  }
}

export function recordEvent(recorder, event, time) {
  if (!recorder) return null
  const row = normalizeEvent({ ...event, t: event.t ?? time ?? 0 }, recorder.events.length)
  recorder.events.push(row)
  return row
}
