import { toJson } from '../json.js'
import { DEFAULT_DT, normalizeCase } from './format.js'
import { evaluateAssert } from './assert.js'

function nextTick(time, dt) {
  const step = dt > 0 ? dt : DEFAULT_DT
  return Math.round((time + step) * 1e9) / 1e9
}

function applyEvent(play, event) {
  const payload = event.payload || {}
  if (event.kind === 'pointer') play.pointer(payload.type, payload.x, payload.y)
  else if (event.kind === 'key') play.key(payload.typeName)
  else if (event.kind === 'click') play.click(payload.name)
  else if (event.kind === 'pause') play.pause()
  else if (event.kind === 'resume') play.resume()
  else if (event.kind === 'serverSet') play.serverSet(payload.entityType, payload.name, payload.value)
  else if (event.kind === 'serverSend') play.serverSend(payload.name, payload.params, payload.target)
  else if (event.kind === 'view') play.view(payload.playerIndex)
  else throw new Error(`unsupported event kind: ${event.kind}`)
}

function judge(row, snap) {
  const judged = evaluateAssert(row, snap)
  return {
    kind: row.kind,
    at: Number(row.at || 0),
    ok: !!judged.ok,
    actual: judged.actual ?? null,
    expected: judged.expected ?? null,
    message: judged.message || '',
  }
}

export function replayCase(play, rawCase) {
  const spec = normalizeCase(rawCase)
  const events = spec.events.slice().sort((a, b) => a.t - b.t)
  const asserts = spec.asserts.slice()
  const dt = spec.dt || DEFAULT_DT
  const lastEvent = events.reduce((max, row) => Math.max(max, row.t), 0)
  const lastAssert = asserts.reduce((max, row) => Math.max(max, Number(row.at || 0)), 0)
  const end = Math.max(lastEvent, lastAssert)
  let eventIndex = 0
  const results = []
  let time = 0
  const needsTree = asserts.some((row) => row.kind === 'control' || row.kind === 'tree' || row.kind === 'lua')
  let snap = play.snapshot({ inspect: needsTree })

  const applyDueEvents = () => {
    while (eventIndex < events.length && events[eventIndex].t <= time + 1e-9) {
      applyEvent(play, events[eventIndex])
      eventIndex += 1
      snap = play.snapshot({ inspect: needsTree })
    }
  }

  const runDueAsserts = () => {
    for (const row of asserts) {
      if (row._done) continue
      if (Number(row.at || 0) <= time + 1e-9) {
        const item = judge(row, snap)
        results.push(item)
        row._done = true
        if (!item.ok) {
          return {
            passed: false,
            failedAt: time,
            frame: snap.frame || 0,
            results,
            snapshot: snap,
          }
        }
      }
    }
    return null
  }

  applyDueEvents()
  const failNow = runDueAsserts()
  if (failNow) return finish(spec, failNow)

  while (time + 1e-9 < end) {
    play.step(dt)
    time = nextTick(time, dt)
    snap = play.snapshot({ inspect: needsTree })
    applyDueEvents()
    const failed = runDueAsserts()
    if (failed) return finish(spec, failed)
  }

  return finish(spec, {
    passed: results.every((row) => row.ok),
    failedAt: null,
    frame: snap.frame || 0,
    results,
    snapshot: snap,
  })
}

function finish(spec, report) {
  return toJson({
    format: spec.format,
    name: spec.name,
    passed: report.passed,
    failedAt: report.failedAt,
    frame: report.frame,
    results: report.results,
    snapshot: {
      time: report.snapshot?.time ?? 0,
      frame: report.snapshot?.frame ?? 0,
      logs: report.snapshot?.logs || [],
      serverLogs: report.snapshot?.serverLogs || report.snapshot?.server?.logs || [],
      server: report.snapshot?.server || { vars: {}, inbound: [], outbound: [], logs: [] },
    },
  })
}
