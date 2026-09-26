import { parentPort } from 'node:worker_threads'
import { createStudio } from '../index.js'

let studio = null
let ticking = false
let lastTick = 0
let accumulator = 0

// Shared fixed-step play clock.  Every host (DSH, MCP and local Web) runs the
// same 30 FPS simulation in the worker; page code only observes it.
const CLOCK_INTERVAL_MS = 33
const FIXED_DT = 1 / 30
const MAX_CATCHUP_STEPS = 5

function observeOptions(args = {}) {
  return {
    ...(args.inspect ? { inspect: true } : {}),
    ...(args.view ? { view: true } : {}),
    ...(args.paint ? { paint: true } : {}),
    ...(args.compact ? { compact: true } : {}),
    ...(args.sceneRev !== undefined && args.sceneRev !== null ? { sceneRev: args.sceneRev } : {}),
  }
}

function startOptions(args = {}) {
  const options = observeOptions(args)
  for (const key of ['canvasId', 'playerCount', 'viewPlayerIndex', 'language']) {
    if (args[key] !== undefined && args[key] !== null && args[key] !== '') options[key] = args[key]
  }
  return options
}

function respond(args = {}) {
  return args.light
    ? { ...studio.playStatus() }
    : studio.playGet(observeOptions(args))
}

function tickClock() {
  if (!studio || ticking) return
  const status = studio.playStatus()
  if (!status.running || status.paused) {
    lastTick = 0
    accumulator = 0
    return
  }
  const now = Date.now()
  if (!lastTick) {
    lastTick = now
    return
  }
  ticking = true
  try {
    accumulator += Math.min(0.25, Math.max(0, (now - lastTick) / 1000))
    lastTick = now
    let steps = 0
    while (accumulator >= FIXED_DT && steps < MAX_CATCHUP_STEPS) {
      studio.playStep(FIXED_DT, { observe: false })
      accumulator -= FIXED_DT
      steps += 1
    }
    if (accumulator > FIXED_DT) accumulator = FIXED_DT
  } finally {
    ticking = false
  }
}

const clockTimer = setInterval(tickClock, CLOCK_INTERVAL_MS)

function run(action, args = {}) {
  if (action === 'start') {
    if (studio) studio.playStop()
    studio = createStudio(args.archive || args.project, { workspacePath: args.workspacePath || '' })
    lastTick = 0
    accumulator = 0
    return studio.playStart(startOptions(args))
  }
  if (!studio) throw new Error('play session has not started')
  if (action === 'get') return args.light ? respond(args) : studio.playGet(observeOptions(args))
  if (action === 'step') {
    const value = studio.playStep(args.dt, args.light ? { observe: false } : observeOptions(args))
    return args.light ? respond(args) : value
  }
  if (action === 'pointer') {
    studio.playPointer(args.type, args.x, args.y, { observe: false })
    return respond(args)
  }
  if (action === 'key') {
    studio.playKey(args.key, { observe: false })
    return respond(args)
  }
  if (action === 'click') {
    studio.playClick(args.name, { observe: false })
    return respond(args)
  }
  if (action === 'pause') {
    studio.playPause({ observe: false })
    return respond(args)
  }
  if (action === 'resume') {
    studio.playResume({ observe: false })
    return respond(args)
  }
  if (action === 'device') {
    return studio.playSetCanvas(args.canvasId, observeOptions(args))
  }
  if (action === 'view') {
    studio.playSetView(args.playerIndex ?? args.viewPlayerIndex, { observe: false })
    return respond(args)
  }
  if (action === 'serverGet') return studio.playServerGet(args.entityType, args.name)
  if (action === 'serverSet') return studio.playServerSet(args.entityType, args.name, args.value)
  if (action === 'serverSend') return studio.playServerSend(args.name, args.params || [], args.target || 'PlayerSelf')
  if (action === 'history') return studio.playHistory()
  if (action === 'saveCase') return studio.playSaveCase(args.case || args)
  if (action === 'runCase') {
    return studio.playRunCase(args.case || args, {
      canvasId: args.canvasId,
      playerCount: args.playerCount,
      viewPlayerIndex: args.viewPlayerIndex,
    })
  }
  if (action === 'stop') {
    const value = studio.playStop()
    studio = null
    lastTick = 0
    accumulator = 0
    return value
  }
  throw new Error(`unknown play action: ${action}`)
}

parentPort.on('message', (message) => {
  const { id, action, args = {} } = message || {}
  try {
    parentPort.postMessage({ id, ok: true, value: run(action, args), error: null })
  } catch (error) {
    parentPort.postMessage({ id, ok: false, value: null, error: error?.message || String(error) })
  }
})
