import { parentPort } from 'node:worker_threads'
import { createStudio } from '../index.js'
import { DEFAULT_PLAY_FPS, validatePlayFps } from '../play/frame-rate.js'

let studio = null
let ticking = false
let lastTick = null
let accumulator = 0
let clockMode = 'realtime'
let audioMuted = false
let fps = DEFAULT_PLAY_FPS
let clockTimer = null

// Web/DSH use a fixed-step wall clock. MCP defaults to manual: only explicit
// step / case replay advances Lua, including between observation requests.
const MAX_CATCHUP_SECONDS = 5 / 30

function scheduleClock() {
  if (clockTimer) clearInterval(clockTimer)
  clockTimer = clockMode === 'realtime' ? setInterval(tickClock, Math.floor(1000 / fps)) : null
}

function observeOptions(args = {}) {
  return {
    ...(args.inspect ? { inspect: true } : {}),
    ...(args.view ? { view: true } : {}),
    ...(args.paint ? { paint: true } : {}),
    ...(args.compact ? { compact: true } : {}),
    ...(args.sceneRev !== undefined && args.sceneRev !== null ? { sceneRev: args.sceneRev } : {}),
    ...(args.sceneSessionId ? { sceneSessionId: args.sceneSessionId } : {}),
  }
}

function startOptions(args = {}) {
  const options = observeOptions(args)
  for (const key of ['canvasId', 'playerCount', 'viewPlayerIndex', 'language', 'keyHintDevice']) {
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
  if (!studio || ticking || clockMode !== 'realtime') return
  const status = studio.playStatus()
  if (!status.running || status.paused) {
    lastTick = null
    accumulator = 0
    return
  }
  const now = performance.now()
  if (lastTick === null) {
    lastTick = now
    return
  }
  ticking = true
  try {
    accumulator += Math.min(0.25, Math.max(0, (now - lastTick) / 1000))
    lastTick = now
    let steps = 0
    const dt = 1 / fps
    while (accumulator >= dt && steps < Math.ceil(fps * MAX_CATCHUP_SECONDS)) {
      studio.playStep(dt, { observe: false })
      accumulator -= dt
      steps += 1
    }
    if (accumulator > dt) accumulator = dt
  } finally {
    ticking = false
  }
}

function run(action, args = {}) {
  if (action === 'start') {
    const requestedMode = args.clockMode ?? 'realtime'
    if (requestedMode !== 'manual' && requestedMode !== 'realtime') throw new Error('clockMode must be manual or realtime')
    const requestedFps = validatePlayFps(args.fps ?? DEFAULT_PLAY_FPS)
    if (studio) studio.playStop()
    studio = createStudio(args.archive || args.project, { workspacePath: args.workspacePath || '' })
    clockMode = requestedMode
    fps = requestedFps
    audioMuted = args.muteAudio === true
    lastTick = null
    accumulator = 0
    const value = studio.playStart(startOptions(args))
    lastTick = performance.now()
    scheduleClock()
    return value
  }
  if (!studio) throw new Error('play session has not started')
  if (action === 'get') return args.light ? respond(args) : studio.playGet(observeOptions(args))
  if (action === 'fps') {
    const requestedFps = validatePlayFps(args.fps)
    // Account for elapsed time at the old rate, retaining the fractional step.
    tickClock()
    fps = requestedFps
    scheduleClock()
    return respond(args)
  }
  if (action === 'step') {
    const value = studio.playStep(args.dt === undefined ? 1 / fps : args.dt, args.light ? { observe: false } : observeOptions(args))
    return args.light ? respond(args) : value
  }
  if (action === 'pointer') {
    studio.playPointer(args.type, args.x, args.y, { observe: false, deltaX: args.deltaX, deltaY: args.deltaY })
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
    lastTick = null
    accumulator = 0
    return respond(args)
  }
  if (action === 'resume') {
    studio.playResume({ observe: false })
    lastTick = performance.now()
    accumulator = 0
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
  if (action === 'history') {
    const value = studio.playHistory()
    value.case.dt = 1 / fps
    return value
  }
  if (action === 'saveCase') {
    const spec = args.case || args
    return studio.playSaveCase({ ...spec, dt: spec.dt ?? 1 / fps })
  }
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
    lastTick = null
    accumulator = 0
    clearInterval(clockTimer)
    clockTimer = null
    return value
  }
  throw new Error(`unknown play action: ${action}`)
}

parentPort.on('message', (message) => {
  const { id, action, args = {} } = message || {}
  try {
    const value = run(action, args)
    // Include the clock on all play snapshots, including light/input responses.
    const result = typeof value?.running === 'boolean' ? { ...value, clockMode, fps, audioMuted } : value
    parentPort.postMessage({ id, ok: true, value: result, error: null })
  } catch (error) {
    parentPort.postMessage({ id, ok: false, value: null, error: error?.message || String(error) })
  }
})
