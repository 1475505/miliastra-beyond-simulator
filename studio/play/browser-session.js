import { BrowserAudioPlayer } from './audio-player.js'
import { browserAudioMutedByDefault } from './audio-policy.js'
import { keyEventName, mouseKeyEventName } from './key-bindings.js'
import { DEFAULT_PLAY_FPS, validatePlayFps } from './frame-rate.js'
export { keyEventName } from './key-bindings.js'

export const PLAY_POLL_INTERVAL_MS = Math.floor(1000 / DEFAULT_PLAY_FPS)
export const PLAY_MOVE_THROTTLE_MS = 60
// Upper bound for one presented frame's dt; the Worker applies the same cap.
export const PLAY_MAX_FRAME_DT = 1 / 3
// A due frame is sent on the closest display refresh, up to this much early,
// so 30 FPS on a 144/160 Hz display averages 30 rather than rounding down.
const FRAME_SLACK_MS = 4
// A hidden page sends no frames but stays open; this heartbeat keeps hosts that
// stop idle Workers (Web editor: 15 minutes) from ending its background game.
// Browsers still run timers at least once a minute in background tabs.
export const PLAY_HIDDEN_HEARTBEAT_MS = 60_000

function defaultFrameScheduler() {
  if (typeof requestAnimationFrame === 'function') {
    return { request: callback => requestAnimationFrame(callback), cancel: id => cancelAnimationFrame(id) }
  }
  return { request: callback => setTimeout(() => callback(performance.now()), 4), cancel: id => clearTimeout(id) }
}

function newDriverId() {
  return globalThis.crypto?.randomUUID?.() || `driver-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

const fpsStorageKey = 'qxqy-play-fps'
function preferredFps() {
  try { return validatePlayFps(Number(globalThis.localStorage?.getItem(fpsStorageKey))) }
  catch { return DEFAULT_PLAY_FPS }
}

export function stagePoint(event, rect, width, height) {
  return {
    x: (event.clientX - rect.left) * width / rect.width,
    y: (rect.bottom - event.clientY) * height / rect.height,
  }
}

/**
 * Shared browser play loop used by the DSH standalone page and local Web preview.
 * While visible and active, the page drives the game: each due display refresh
 * sends one `frame` with the measured dt and renders its compact scene delta.
 * Worker semantics stay in studio/host/worker.js, including the single-driver
 * lease: a newer page or a tool that starts or steps play preempts this one.
 */
export function createPlaySession({ renderer, api, onSnapshot, onStatus, onError, onAudioStatus, onPreempted, audio,
  audioMuted, isActive, isInputActive, keyInputEnabled = true, frameScheduler = defaultFrameScheduler(),
  driverId = newDriverId() } = {}) {
  const agentMuted = audioMuted ?? (typeof window !== 'undefined' && browserAudioMutedByDefault())
  audio ||= typeof window !== 'undefined' ? new BrowserAudioPlayer({ onStatus: onAudioStatus, muted: agentMuted }) : null
  if (typeof window !== 'undefined') audio?.bindUnlock(window)
  let generation = 0
  let snapshot = null
  let running = false
  let driving = false
  let frameHandle = null
  let frameInFlight = false
  let lastFrameAt = null
  let nextFrameAt = 0
  let leased = false
  let idle = false
  let preempted = false
  let heartbeat = null
  let fps = preferredFps()
  let sceneRev = 0
  let moveTimer = null
  let lastMove = null
  let activePointer = null
  let pointerSurface = null
  let pointerPoint = null
  let switchingView = false
  const inputDisposers = []
  const keyReleasers = new Set()
  let inputQueue = Promise.resolve()

  function sendInput(action, args, options) {
    const current = generation
    // HTTP requests can arrive out of order. Serialize pointer and key input so
    // a quick release cannot overtake its press, including flushed drag moves.
    // Discard queued input when the Worker/session is replaced.
    inputQueue = inputQueue.then(() => current === generation && running
      ? act(action, args, options) : null)
    return inputQueue
  }

  const sendKey = key => sendInput('key', { key }, { allowInactive: true })
  const sendPointer = args => sendInput('pointer', args)

  function releaseKeys(send = true) {
    return Promise.all([...keyReleasers].map(release => release(send))).then(() => inputQueue)
  }

  function releasePointer(send = true) {
    clearMove()
    const id = activePointer, surface = pointerSurface, position = pointerPoint
    activePointer = null
    pointerSurface = null
    pointerPoint = null
    // Clear ownership before releasing capture: lostpointercapture can reenter.
    if (surface?.hasPointerCapture?.(id)) surface.releasePointerCapture(id)
    return send && id !== null && running
      ? sendInput('pointer', { type: 'cancel', ...position }, { allowInactive: true }) : inputQueue
  }

  function releaseInputs(send = true) {
    const keys = releaseKeys(send)
    const pointer = releasePointer(send)
    return Promise.all([keys, pointer]).then(() => inputQueue)
  }

  function setKeyInputEnabled(enabled) {
    keyInputEnabled = Boolean(enabled)
    if (!keyInputEnabled) void releaseKeys()
  }

  function emitError(error) {
    if (onError) onError(error)
  }

  function syncFps(value) {
    if (value === undefined) return
    const next = validatePlayFps(value)
    if (fps === next) return
    fps = next
    if (lastFrameAt !== null) nextFrameAt = lastFrameAt + 1000 / fps
    try { globalThis.localStorage?.setItem(fpsStorageKey, String(fps)) } catch { /* Session-only if storage is blocked. */ }
  }

  const withDriver = (args = {}) => ({ ...args, driverId })

  async function setFps(value) {
    const next = validatePlayFps(value)
    if (running) return act('fps', { fps: next })
    syncFps(next)
  }

  async function applyScene(next, { freshAudio = false } = {}) {
    const current = generation
    snapshot = next
    running = next?.running !== false
    syncFps(next?.fps)
    audio?.sync(next, { fresh: freshAudio })
    if (next?.scene && next.scene.format === 'tree-v1') {
      if (next.scene.reset) sceneRev = 0
      await renderer.applyScene(next.scene, next.canvasWidth, next.canvasHeight)
      if (current !== generation) return
      sceneRev = next.scene.revision || sceneRev
    } else if (Array.isArray(next?.paint)) {
      await renderer.render(next.paint, next.canvasWidth, next.canvasHeight)
    }
    if (current !== generation) return
    if (!isActive || isActive()) renderer.syncEffects?.(next)
    if (onSnapshot) await onSnapshot(next)
  }

  function sceneArgs(args = {}) {
    return withDriver({ ...args, view: true, sceneRev, compact: true,
      ...(snapshot?.audio?.sessionId ? { sceneSessionId: snapshot.audio.sessionId } : {}) })
  }

  function failPlay(error) {
    running = false
    stopPolling()
    audio?.reset()
    renderer.resetEffects?.()
    emitError(error)
  }

  // Another page, or a tool that started or stepped play, now owns the game.
  // Exit without stopping it; the page can only take it back with start/attach.
  function handlePreempted() {
    if (preempted) return
    preempted = true
    leased = false
    void releaseInputs(false)
    generation++
    running = false
    stopDriving()
    audio?.reset()
    renderer.resetEffects?.()
    if (onPreempted) onPreempted()
  }

  // One-shot observation without advancing Lua (the frame loop is the driver).
  async function poll() {
    if (!running) return
    const current = generation
    try {
      const next = await api('get', sceneArgs())
      if (current !== generation) return
      if (next?.preempted) return handlePreempted()
      await applyScene(next)
    } catch (error) {
      if (current === generation) failPlay(error)
    }
  }

  async function sendFrame(dt) {
    const current = generation
    frameInFlight = true
    try {
      const next = await api('frame', sceneArgs({ dt }))
      if (current !== generation) return
      if (next?.preempted) return handlePreempted()
      leased = true
      await applyScene(next)
    } catch (error) {
      if (current === generation) failPlay(error)
    } finally {
      if (current === generation) frameInFlight = false
    }
  }

  function pageHidden() {
    return typeof document !== 'undefined' && document.hidden === true
  }

  function scheduleFrame() {
    if (frameHandle !== null || !driving || !running || preempted) return
    frameHandle = frameScheduler.request(onDisplayFrame)
  }

  function onDisplayFrame(now) {
    frameHandle = null
    if (!driving || !running || preempted) return
    scheduleFrame()
    const inactive = isActive && !isActive()
    if (inactive || pageHidden()) {
      if (!idle) {
        idle = true
        releaseLease()
        if (inactive) { audio?.reset(); renderer.resetEffects?.() }
      }
      return
    }
    idle = false
    if (frameInFlight || switchingView) return
    const interval = 1000 / fps
    if (lastFrameAt !== null && now < nextFrameAt - FRAME_SLACK_MS) return
    // One Lua update per presented frame with the measured dt, like Unity
    // Update and the device OnUpdate(dt). A slow response just makes the next
    // frame's dt larger; it never sends catch-up steps.
    const dt = lastFrameAt === null ? 1 / fps : Math.min(PLAY_MAX_FRAME_DT, Math.max(0, now - lastFrameAt) / 1000)
    nextFrameAt = (lastFrameAt === null || now - nextFrameAt > interval ? now : nextFrameAt) + interval
    lastFrameAt = now
    void sendFrame(dt)
  }

  // Hand the clock back to the Worker: hidden tabs keep running like the PC client.
  function releaseLease() {
    lastFrameAt = null
    if (!leased || preempted) return
    leased = false
    const current = generation
    void Promise.resolve(api('release', withDriver())).then(value => {
      if (current === generation && value?.preempted) handlePreempted()
    }, () => {})
  }

  function stopHeartbeat() {
    if (heartbeat !== null) clearInterval(heartbeat)
    heartbeat = null
  }

  function startHeartbeat() {
    if (heartbeat !== null || !driving || !running || preempted) return
    heartbeat = setInterval(() => {
      if (!driving || !running || preempted) return stopHeartbeat()
      const current = generation
      void Promise.resolve(api('release', withDriver())).then(value => {
        if (current === generation && value?.preempted) handlePreempted()
      }, () => {})
    }, PLAY_HIDDEN_HEARTBEAT_MS)
  }

  function onVisibilityChange() {
    if (pageHidden()) { releaseLease(); startHeartbeat() }
    else { stopHeartbeat(); lastFrameAt = null; scheduleFrame() }
  }
  if (typeof document !== 'undefined') document.addEventListener?.('visibilitychange', onVisibilityChange)

  function stopDriving() {
    driving = false
    stopHeartbeat()
    if (frameHandle !== null) frameScheduler.cancel(frameHandle)
    frameHandle = null
    lastFrameAt = null
  }

  function startPolling() {
    if (driving || preempted) return
    driving = true
    idle = false
    scheduleFrame()
  }

  function stopPolling() {
    stopDriving()
    releaseLease()
    if (isActive && !isActive()) { audio?.reset(); renderer.resetEffects?.() }
  }

  // Input reaches the Worker immediately and shows on the next frame; an extra
  // frame here would run Lua twice in one display refresh.
  function pollSoon() {
    scheduleFrame()
  }

  function clearMove() {
    if (moveTimer) clearTimeout(moveTimer)
    moveTimer = null
  }

  // Send a throttled move now so it cannot land after the down/up that follows it.
  function flushMove() {
    if (!moveTimer) return
    clearMove()
    void sendPointer({ type: 'move', ...lastMove })
  }

  function reset() {
    // These transitions replace or terminate the Worker; never carry held
    // browser keys into the next session. Blur/toggle/view release live keys.
    void releaseInputs(false)
    generation++
    audio?.reset()
    renderer.resetEffects?.()
    switchingView = false
    running = false
    sceneRev = 0
    // The next start/device/attach/stop supersedes the lease; no release here.
    stopDriving()
    leased = false
    frameInFlight = false
    idle = false
  }

  async function act(action, args, { allowInactive = false } = {}) {
    if (preempted) return null
    if (!allowInactive && isActive && !isActive()) return null
    const current = generation
    try {
      const value = await api(action, withDriver({ light: true, ...(args || {}) }))
      if (current !== generation || !running) return value
      if (value?.preempted) { handlePreempted(); return null }
      syncFps(value?.fps)
      if (value && typeof value === 'object' && value.frame !== undefined && onStatus) onStatus(value)
      pollSoon()
      return value
    } catch (error) {
      if (current === generation) emitError(error)
      return null
    }
  }

  function playbackArgs(args = {}) {
    args = { ...args, fps: args.fps ?? fps }
    if (!audio || args.muteAudio != null) return args
    if (audio.audioChoice === 'on') return { ...args, muteAudio: false }
    if (audio.audioChoice === 'off' || audio.muted) return { ...args, muteAudio: true }
    return args
  }

  // start/device/attach are explicit takeovers: this page becomes the driver.
  async function start(args = {}) {
    reset()
    preempted = false
    args = playbackArgs(args)
    audio?.unlock()
    const current = generation
    sceneRev = 0
    const next = await api('start', withDriver({ view: true, compact: true, ...args }))
    if (current !== generation) return next
    await applyScene({ ...next, running: true }, { freshAudio: true })
    if (current !== generation) return next
    running = true
    leased = true
    stopDriving()
    startPolling()
    return next
  }

  async function attach() {
    // Reconnect a reloaded browser to the existing worker without restarting
    // the game, changing its player, or resuming a paused session.
    await releaseInputs()
    reset()
    preempted = false
    const current = generation
    sceneRev = 0
    const next = await api('attach', withDriver({ view: true, compact: true, sceneRev: 0 }))
    if (current !== generation) return next
    await applyScene(next)
    if (current !== generation) return next
    leased = true
    if (running) startPolling()
    return next
  }

  async function device(args = {}) {
    reset()
    preempted = false
    args = playbackArgs(args)
    const current = generation
    sceneRev = 0
    const next = await api('device', withDriver({ view: true, compact: true, ...args }))
    if (current !== generation) return next
    await applyScene({ ...next, running: true }, { freshAudio: true })
    if (current !== generation) return next
    running = true
    leased = true
    startPolling()
    return next
  }

  async function view(args = {}) {
    switchingView = true
    let current = generation
    try {
      await releaseInputs()
      if (current !== generation) return null
      current = ++generation
      audio?.reset()
      renderer.resetEffects?.()
      sceneRev = 0
      const next = await api('view', withDriver({ view: true, compact: true, ...args }))
      if (current !== generation) return next
      if (next?.preempted) { handlePreempted(); return next }
      await applyScene({ ...next, running: true })
      return next
    } finally {
      if (current === generation) switchingView = false
    }
  }

  // A preempted page's stop is ignored by the Worker, so it cannot end the
  // game that replaced it.
  async function stop() {
    reset()
    return api('stop', withDriver())
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
      pointerSurface = surface
      pointerPoint = point(event, surface)
      surface.setPointerCapture?.(event.pointerId)
      flushMove()
      void sendPointer({ type: 'down', ...pointerPoint })
    }
    const onPointerUp = (event) => {
      if (activePointer !== event.pointerId) return
      if (!canInput()) { void releasePointer(); return }
      flushMove()
      void sendPointer({ type: 'up', ...point(event, surface) })
      void releasePointer(false)
    }
    const onPointerMove = (event) => {
      if (!canInput()) return
      if (activePointer !== null && activePointer !== event.pointerId) return
      lastMove = point(event, surface)
      if (activePointer !== null) pointerPoint = lastMove
      if (moveTimer) return
      moveTimer = setTimeout(() => {
        moveTimer = null
        if (canInput()) void sendPointer({ type: 'move', ...lastMove })
      }, PLAY_MOVE_THROTTLE_MS)
    }
    const onPointerLeave = () => {
      if (activePointer !== null) return
      clearMove()
      if (canInput()) void sendPointer({ type: 'move', x: -1, y: -1 })
    }
    const onPointerCancel = (event) => {
      if (event.pointerType === 'mouse') { void release('mouse:0'); void release('mouse:2') }
      if (activePointer !== event.pointerId) return
      void releasePointer()
    }
    const onWheel = (event) => {
      if (!canInput()) return
      event.preventDefault()
      const rect = surface.getBoundingClientRect()
      // Browser line/page deltas have no pixel unit. Use 16 CSS px per line and
      // one viewport per page, then convert to logical canvas units.
      const unitX = event.deltaMode === 2 ? rect.width : event.deltaMode === 1 ? 16 : 1
      const unitY = event.deltaMode === 2 ? rect.height : event.deltaMode === 1 ? 16 : 1
      // DOM Y is positive for wheel-down; the play viewport advances on wheel-up.
      void sendPointer({ type: 'wheel', ...point(event, surface),
        deltaX: event.deltaX * unitX * snapshot.canvasWidth / rect.width,
        deltaY: -event.deltaY * unitY * snapshot.canvasHeight / rect.height })
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
    const onBlur = () => { void releaseInputs() }
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
      if (pointerSurface === surface) void releasePointer()
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
    // Best effort on unload; otherwise the Worker takes over after its lease timeout.
    releaseLease()
    reset()
    if (typeof document !== 'undefined') document.removeEventListener?.('visibilitychange', onVisibilityChange)
    while (inputDisposers.length) inputDisposers.pop()()
    renderer?.destroy?.()
    audio?.destroy()
  }

  return {
    audio,
    driverId,
    get snapshot() { return snapshot },
    get running() { return running },
    get preempted() { return preempted },
    get sceneRev() { return sceneRev },
    get fps() { return fps },
    setFps,
    get keyInputEnabled() { return keyInputEnabled },
    setKeyInputEnabled,
    releaseKeys,
    releaseInputs,
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
