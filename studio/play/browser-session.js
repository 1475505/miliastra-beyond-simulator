import { BrowserAudioPlayer } from './audio-player.js'
import { keyEventName, mouseKeyEventName } from './key-bindings.js'
export { keyEventName } from './key-bindings.js'

export const PLAY_POLL_INTERVAL_MS = 33
export const PLAY_MOVE_THROTTLE_MS = 60

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
  isActive, isInputActive, keyInputEnabled = true } = {}) {
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
  let switchingView = false
  const inputDisposers = []
  const keyReleasers = new Set()
  let keyQueue = Promise.resolve()

  function sendKey(key) {
    const current = generation
    // HTTP requests can complete out of order. Keep a quick Down→Up pair in
    // order, and discard queued input when the Worker/session is replaced.
    keyQueue = keyQueue.then(() => current === generation && running
      ? act('key', { key }, { allowInactive: true }) : null)
    return keyQueue
  }

  function releaseKeys(send = true) {
    return Promise.all([...keyReleasers].map(release => release(send))).then(() => keyQueue)
  }

  function setKeyInputEnabled(enabled) {
    keyInputEnabled = Boolean(enabled)
    if (!keyInputEnabled) void releaseKeys()
  }

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
    // These transitions replace or terminate the Worker; never carry held
    // browser keys into the next session. Blur/toggle/view release live keys.
    void releaseKeys(false)
    generation++
    audio?.reset()
    clearMove()
    activePointer = null
    switchingView = false
    running = false
    sceneRev = 0
    stopPolling()
  }

  async function act(action, args, { allowInactive = false } = {}) {
    if (!allowInactive && isActive && !isActive()) return null
    const current = generation
    try {
      const value = await api(action, { light: true, ...(args || {}) })
      if (current !== generation || !running) return value
      if (value && typeof value === 'object' && value.frame !== undefined && onStatus) onStatus(value)
      pollSoon(30)
      return value
    } catch (error) {
      if (current === generation) emitError(error)
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
    await releaseKeys()
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
    switchingView = true
    let current = generation
    try {
      await releaseKeys()
      if (current !== generation) return null
      current = ++generation
      audio?.reset()
      sceneRev = 0
      const next = await api('view', { view: true, compact: true, ...args })
      if (current !== generation) return next
      await applyScene({ ...next, running: true })
      return next
    } finally {
      if (current === generation) switchingView = false
    }
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
    const document = surface.ownerDocument || keyTarget.ownerDocument
    const blurTarget = document?.defaultView || keyTarget
    const mouseUpTarget = document || keyTarget
    const held = new Map()
    let pointerType = ''
    const canInput = () => snapshot && running && !switchingView && (!isActive || isActive()) && (!isInputActive || isInputActive())
    const canKey = () => keyInputEnabled && canInput()
    const editable = event => event.target?.isContentEditable || event.target?.closest?.(
      'input,textarea,select,button,a[href],[role="textbox"],[contenteditable]:not([contenteditable="false"])')
    const press = (id, name) => {
      if (!name || held.has(id)) return
      const alreadyDown = [...held.values()].includes(name)
      held.set(id, name)
      if (!alreadyDown) void sendKey(name)
    }
    const release = id => {
      const name = held.get(id)
      if (!name) return null
      held.delete(id)
      if (running && ![...held.values()].includes(name)) {
        return sendKey(name.replace(/Down$/, 'Up'))
      }
      return null
    }
    const releaseHeld = (send = true) => {
      if (!send) { held.clear(); return Promise.resolve() }
      return Promise.all([...held.keys()].map(release))
    }
    keyReleasers.add(releaseHeld)
    const onPointerDown = (event) => {
      pointerType = event.pointerType || ''
      if (!canInput()) return
      if (activePointer !== null || (event.button != null && event.button !== 0)) return
      activePointer = event.pointerId
      surface.setPointerCapture?.(event.pointerId)
      flushMove()
      void act('pointer', { type: 'down', ...point(event, surface) })
    }
    const onPointerUp = (event) => {
      if (!canInput()) return
      if (activePointer !== event.pointerId) return
      flushMove()
      void act('pointer', { type: 'up', ...point(event, surface) })
      activePointer = null
    }
    const onPointerMove = (event) => {
      if (!canInput()) return
      if (activePointer !== null && activePointer !== event.pointerId) return
      lastMove = point(event, surface)
      if (moveTimer) return
      moveTimer = setTimeout(() => {
        moveTimer = null
        if (canInput()) void act('pointer', { type: 'move', ...lastMove })
      }, PLAY_MOVE_THROTTLE_MS)
    }
    const onPointerLeave = () => {
      if (activePointer !== null) return
      clearMove()
      if (canInput()) void act('pointer', { type: 'move', x: -1, y: -1 })
    }
    const onPointerCancel = (event) => {
      if (event.pointerType === 'mouse') { void release('mouse:0'); void release('mouse:2') }
      if (activePointer !== event.pointerId) return
      clearMove()
      activePointer = null
      if (snapshot && running) void act('pointer', { type: 'cancel', ...point(event, surface) })
    }
    const onWheel = (event) => {
      if (!canInput()) return
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
      if (!canKey() || editable(event)) return
      const name = keyEventName(event, 'Down')
      if (name) {
        event.preventDefault()
        if (!event.repeat) press(`key:${event.code || event.key}`, name)
      }
    }
    const onKeyUp = (event) => {
      const id = `key:${event.code || event.key}`
      if (held.has(id)) {
        event.preventDefault()
        void release(id)
      }
    }
    // Mouse events include button chords; PointerEvent down/up only describe
    // the first/last button. Ignore compatibility mouse events from touch.
    const onMouseDown = event => {
      if (!canKey() || (pointerType && pointerType !== 'mouse') || event.sourceCapabilities?.firesTouchEvents) return
      press(`mouse:${event.button}`, mouseKeyEventName(event.button, 'Down'))
    }
    const onMouseUp = event => { void release(`mouse:${event.button}`) }
    const onBlur = () => { void releaseHeld() }
    const onVisibility = () => { if (document?.hidden) onBlur() }
    const onContextMenu = event => { if (canKey()) event.preventDefault() }
    surface.addEventListener('pointerdown', onPointerDown)
    surface.addEventListener('pointerup', onPointerUp)
    surface.addEventListener('pointermove', onPointerMove)
    surface.addEventListener('pointerleave', onPointerLeave)
    surface.addEventListener('pointercancel', onPointerCancel)
    surface.addEventListener('lostpointercapture', onPointerCancel)
    surface.addEventListener('wheel', onWheel, { passive: false })
    surface.addEventListener('mousedown', onMouseDown)
    surface.addEventListener('contextmenu', onContextMenu)
    mouseUpTarget.addEventListener('mouseup', onMouseUp)
    keyTarget.addEventListener('keydown', onKeyDown)
    keyTarget.addEventListener('keyup', onKeyUp)
    keyTarget.addEventListener('focusout', onBlur)
    blurTarget.addEventListener('blur', onBlur)
    document?.addEventListener('visibilitychange', onVisibility)
    const dispose = () => {
      void releaseHeld()
      keyReleasers.delete(releaseHeld)
      surface.removeEventListener('pointerdown', onPointerDown)
      surface.removeEventListener('pointerup', onPointerUp)
      surface.removeEventListener('pointermove', onPointerMove)
      surface.removeEventListener('pointerleave', onPointerLeave)
      surface.removeEventListener('pointercancel', onPointerCancel)
      surface.removeEventListener('lostpointercapture', onPointerCancel)
      surface.removeEventListener('wheel', onWheel)
      surface.removeEventListener('mousedown', onMouseDown)
      surface.removeEventListener('contextmenu', onContextMenu)
      mouseUpTarget.removeEventListener('mouseup', onMouseUp)
      keyTarget.removeEventListener('keydown', onKeyDown)
      keyTarget.removeEventListener('keyup', onKeyUp)
      keyTarget.removeEventListener('focusout', onBlur)
      blurTarget.removeEventListener('blur', onBlur)
      document?.removeEventListener('visibilitychange', onVisibility)
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
    get keyInputEnabled() { return keyInputEnabled },
    setKeyInputEnabled,
    releaseKeys,
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
