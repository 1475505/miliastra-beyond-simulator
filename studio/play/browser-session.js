import { BrowserAudioPlayer } from './audio-player.js'

export const PLAY_POLL_INTERVAL_MS = 33
export const PLAY_MOVE_THROTTLE_MS = 60

export function keyEventName(event, phase) {
  const digit = event.code && String(event.code).startsWith('Digit') ? String(event.code).slice(5) : ''
  if (digit && Number(digit) >= 1 && Number(digit) <= 9) return `KeyboardCraftspersonKey${digit}${phase}`
  return ''
}

export function stagePoint(event, rect, width, height) {
  return {
    x: (event.clientX - rect.left) * width / rect.width,
    y: (rect.bottom - event.clientY) * height / rect.height,
  }
}

/**
 * Shared browser play loop used by the DSH standalone page and local Web preview.
 * Worker semantics stay in studio/host/worker.js; this only observes compact
 * scene snapshots and sends light-weight input.
 */
export function createPlaySession({ renderer, api, onSnapshot, onStatus, onError, onAudioStatus, audio,
  isActive } = {}) {
  audio ||= typeof window !== 'undefined' ? new BrowserAudioPlayer({ onStatus: onAudioStatus }) : null
  if (typeof window !== 'undefined') audio?.bindUnlock(window)
  let generation = 0
  let snapshot = null
  let running = false
  let polling = false
  let timer = null
  let pollSoonTimer = null
  let sceneRev = 0
  let moveTimer = null
  let lastMove = null
  let activePointer = null
  const inputDisposers = []

  function emitError(error) {
    if (onError) onError(error)
  }

  async function applyScene(next, { freshAudio = false } = {}) {
    snapshot = next
    running = next?.running !== false
    audio?.sync(next, { fresh: freshAudio })
    if (next?.scene && next.scene.format === 'tree-v1') {
      if (next.scene.reset) sceneRev = 0
      await renderer.applyScene(next.scene, next.canvasWidth, next.canvasHeight)
      sceneRev = next.scene.revision || sceneRev
    } else if (Array.isArray(next?.paint)) {
      await renderer.render(next.paint, next.canvasWidth, next.canvasHeight)
    }
    if (onSnapshot) await onSnapshot(next)
  }

  async function poll() {
    if (!running || polling) return
    if (isActive && !isActive()) { audio?.reset(); return }
    polling = true
    const current = generation
    try {
      const next = await api('get', { view: true, sceneRev, compact: true })
      if (current !== generation) return
      await applyScene(next)
    } catch (error) {
      if (current !== generation) return
      running = false
      stopPolling()
      audio?.reset()
      emitError(error)
    } finally {
      polling = false
    }
  }

  function startPolling() {
    if (timer) return
    timer = setInterval(() => { void poll() }, PLAY_POLL_INTERVAL_MS)
  }

  function stopPolling() {
    if (timer) clearInterval(timer)
    timer = null
    if (pollSoonTimer) clearTimeout(pollSoonTimer)
    pollSoonTimer = null
  }

  function pollSoon(delay = 30) {
    if (pollSoonTimer) return
    pollSoonTimer = setTimeout(() => {
      pollSoonTimer = null
      void poll()
    }, delay)
  }

  function clearMove() {
    if (moveTimer) clearTimeout(moveTimer)
    moveTimer = null
  }

  // Send a throttled move now so it cannot land after the down/up that follows it.
  function flushMove() {
    if (!moveTimer) return
    clearMove()
    void act('pointer', { type: 'move', ...lastMove })
  }

  function reset() {
    generation++
    audio?.reset()
    clearMove()
    activePointer = null
    running = false
    sceneRev = 0
    stopPolling()
  }

  async function act(action, args) {
    if (isActive && !isActive()) return null
    try {
      const value = await api(action, { light: true, ...(args || {}) })
      if (value && typeof value === 'object' && value.frame !== undefined && onStatus) onStatus(value)
      pollSoon(30)
      return value
    } catch (error) {
      emitError(error)
      return null
    }
  }

  async function start(args = {}) {
    reset()
    audio?.unlock()
    const current = generation
    sceneRev = 0
    const next = await api('start', { view: true, compact: true, ...args })
    if (current !== generation) return next
    await applyScene({ ...next, running: true }, { freshAudio: true })
    if (current !== generation) return next
    running = true
    stopPolling()
    startPolling()
    return next
  }

  async function attach() {
    // Reconnect a reloaded browser to the existing worker without restarting
    // the game, changing its player, or resuming a paused session.
    reset()
    const current = generation
    sceneRev = 0
    stopPolling()
    const next = await api('get', { view: true, compact: true, sceneRev: 0 })
    if (current !== generation) return next
    await applyScene(next)
    if (current !== generation) return next
    if (running) startPolling()
    return next
  }

  async function device(args = {}) {
    reset()
    const current = generation
    sceneRev = 0
    stopPolling()
    const next = await api('device', { view: true, compact: true, ...args })
    if (current !== generation) return next
    await applyScene({ ...next, running: true }, { freshAudio: true })
    if (current !== generation) return next
    running = true
    startPolling()
    return next
  }

  async function view(args = {}) {
    generation++
    audio?.reset()
    const current = generation
    sceneRev = 0
    const next = await api('view', { view: true, compact: true, ...args })
    if (current !== generation) return next
    await applyScene({ ...next, running: true })
    return next
  }

  async function stop() {
    reset()
    return api('stop')
  }

  function point(event, el) {
    return stagePoint(event, el.getBoundingClientRect(), snapshot.canvasWidth, snapshot.canvasHeight)
  }

  function bindInput(surface, { keysOn } = {}) {
    const keyTarget = keysOn || surface
    const onPointerDown = (event) => {
      if (!snapshot || !running || (isActive && !isActive())) return
      if (activePointer !== null || (event.button != null && event.button !== 0)) return
      activePointer = event.pointerId
      surface.setPointerCapture?.(event.pointerId)
      flushMove()
      void act('pointer', { type: 'down', ...point(event, surface) })
    }
    const onPointerUp = (event) => {
      if (!snapshot || !running || (isActive && !isActive())) return
      if (activePointer !== event.pointerId) return
      flushMove()
      void act('pointer', { type: 'up', ...point(event, surface) })
      activePointer = null
    }
    const onPointerMove = (event) => {
      if (!snapshot || !running || (isActive && !isActive())) return
      if (activePointer !== null && activePointer !== event.pointerId) return
      lastMove = point(event, surface)
      if (moveTimer) return
      moveTimer = setTimeout(() => {
        moveTimer = null
        void act('pointer', { type: 'move', ...lastMove })
      }, PLAY_MOVE_THROTTLE_MS)
    }
    const onPointerLeave = () => {
      if (activePointer !== null) return
      clearMove()
      if (snapshot && running && (!isActive || isActive())) void act('pointer', { type: 'move', x: -1, y: -1 })
    }
    const onPointerCancel = (event) => {
      if (activePointer !== event.pointerId) return
      clearMove()
      activePointer = null
      if (snapshot && running) void act('pointer', { type: 'cancel', ...point(event, surface) })
    }
    const onWheel = (event) => {
      if (!snapshot || !running || (isActive && !isActive())) return
      event.preventDefault()
      const rect = surface.getBoundingClientRect()
      // Browser line/page deltas have no pixel unit. Use 16 CSS px per line and
      // one viewport per page, then convert to logical canvas units.
      const unitX = event.deltaMode === 2 ? rect.width : event.deltaMode === 1 ? 16 : 1
      const unitY = event.deltaMode === 2 ? rect.height : event.deltaMode === 1 ? 16 : 1
      void act('pointer', { type: 'wheel', ...point(event, surface),
        deltaX: event.deltaX * unitX * snapshot.canvasWidth / rect.width,
        deltaY: event.deltaY * unitY * snapshot.canvasHeight / rect.height })
    }
    const onKeyDown = (event) => {
      if (!snapshot || !running || (isActive && !isActive())) return
      const name = keyEventName(event, 'Down')
      if (name) {
        event.preventDefault()
        void act('key', { key: name })
      }
    }
    const onKeyUp = (event) => {
      if (!snapshot || !running || (isActive && !isActive())) return
      const name = keyEventName(event, 'Up')
      if (name) {
        event.preventDefault()
        void act('key', { key: name })
      }
    }
    surface.addEventListener('pointerdown', onPointerDown)
    surface.addEventListener('pointerup', onPointerUp)
    surface.addEventListener('pointermove', onPointerMove)
    surface.addEventListener('pointerleave', onPointerLeave)
    surface.addEventListener('pointercancel', onPointerCancel)
    surface.addEventListener('lostpointercapture', onPointerCancel)
    surface.addEventListener('wheel', onWheel, { passive: false })
    keyTarget.addEventListener('keydown', onKeyDown)
    keyTarget.addEventListener('keyup', onKeyUp)
    const dispose = () => {
      surface.removeEventListener('pointerdown', onPointerDown)
      surface.removeEventListener('pointerup', onPointerUp)
      surface.removeEventListener('pointermove', onPointerMove)
      surface.removeEventListener('pointerleave', onPointerLeave)
      surface.removeEventListener('pointercancel', onPointerCancel)
      surface.removeEventListener('lostpointercapture', onPointerCancel)
      surface.removeEventListener('wheel', onWheel)
      keyTarget.removeEventListener('keydown', onKeyDown)
      keyTarget.removeEventListener('keyup', onKeyUp)
      clearMove()
    }
    inputDisposers.push(dispose)
    return dispose
  }

  function destroy() {
    reset()
    while (inputDisposers.length) inputDisposers.pop()()
    renderer?.destroy?.()
    audio?.destroy()
  }

  return {
    audio,
    get snapshot() { return snapshot },
    get running() { return running },
    get sceneRev() { return sceneRev },
    applyScene,
    poll,
    pollSoon,
    startPolling,
    stopPolling,
    reset,
    act,
    start,
    attach,
    device,
    view,
    stop,
    bindInput,
    destroy,
  }
}
