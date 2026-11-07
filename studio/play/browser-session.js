import { BrowserAudioPlayer } from './audio-player.js'
import { browserAudioMutedByDefault } from './audio-policy.js'
import { keyEventName, mouseKeyEventName } from './key-bindings.js'
import { DEFAULT_PLAY_FPS, validatePlayFps } from './frame-rate.js'
export { keyEventName } from './key-bindings.js'

export const PLAY_POLL_INTERVAL_MS = Math.floor(1000 / DEFAULT_PLAY_FPS)
export const PLAY_MOVE_THROTTLE_MS = 60

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
 * Worker semantics stay in studio/host/worker.js; this only observes compact
 * scene snapshots and sends light-weight input.
 */
export function createPlaySession({ renderer, api, onSnapshot, onStatus, onError, onAudioStatus, audio,
  audioMuted, isActive, isInputActive, keyInputEnabled = true } = {}) {
  const agentMuted = audioMuted ?? (typeof window !== 'undefined' && browserAudioMutedByDefault())
  audio ||= typeof window !== 'undefined' ? new BrowserAudioPlayer({ onStatus: onAudioStatus, muted: agentMuted }) : null
  if (typeof window !== 'undefined') audio?.bindUnlock(window)
  let generation = 0
  let snapshot = null
  let running = false
  let polling = false
  let pollingEnabled = false
  let timer = null
  let nextPollAt = Infinity
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
    if (pollingEnabled) {
      nextPollAt = performance.now() + Math.floor(1000 / fps)
      armPoll()
    }
    try { globalThis.localStorage?.setItem(fpsStorageKey, String(fps)) } catch { /* Session-only if storage is blocked. */ }
  }

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

  async function poll() {
    if (!running || polling) return
    if (timer !== null) clearTimeout(timer)
    timer = null
    nextPollAt = Infinity
    const startedAt = performance.now()
    polling = true
    const current = generation
    try {
      if (isActive && !isActive()) { audio?.reset(); renderer.resetEffects?.(); return }
      const next = await api('get', { view: true, sceneRev, compact: true,
        ...(snapshot?.audio?.sessionId ? { sceneSessionId: snapshot.audio.sessionId } : {}) })
      if (current !== generation) return
      await applyScene(next)
    } catch (error) {
      if (current !== generation) return
      running = false
      stopPolling()
      audio?.reset()
      renderer.resetEffects?.()
      emitError(error)
    } finally {
      polling = false
      // Count request, drawing and UI work against this frame's budget. A slow
      // request starts the next observation as soon as it finishes, rather than
      // missing an interval tick and falling from 60 Hz straight to 30 Hz.
      // Never overlap observations or accumulate catch-up requests.
      if (pollingEnabled && running) nextPollAt = Math.min(nextPollAt, startedAt + Math.floor(1000 / fps))
      armPoll()
    }
  }

  function armPoll() {
    if (timer !== null) clearTimeout(timer)
    timer = null
    if (polling || !running || !Number.isFinite(nextPollAt)) return
    timer = setTimeout(() => { timer = null; void poll() }, Math.max(0, nextPollAt - performance.now()))
  }

  function startPolling() {
    if (pollingEnabled) return
    pollingEnabled = true
    pollSoon()
  }

  function stopPolling() {
    pollingEnabled = false
    if (timer !== null) clearTimeout(timer)
    timer = null
    nextPollAt = Infinity
    if (isActive && !isActive()) { audio?.reset(); renderer.resetEffects?.() }
  }

  function pollSoon(delay = Math.floor(1000 / fps)) {
    if (!running) return
    nextPollAt = Math.min(nextPollAt, performance.now() + Math.max(0, delay))
    armPoll()
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
    stopPolling()
  }

  async function act(action, args, { allowInactive = false } = {}) {
    if (!allowInactive && isActive && !isActive()) return null
    const current = generation
    try {
      const value = await api(action, { light: true, ...(args || {}) })
      if (current !== generation || !running) return value
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

  async function start(args = {}) {
    reset()
    args = playbackArgs(args)
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
    await releaseInputs()
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
    args = playbackArgs(args)
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
      await releaseInputs()
      if (current !== generation) return null
      current = ++generation
      audio?.reset()
      renderer.resetEffects?.()
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
      void sendPointer({ type: 'wheel', ...point(event, surface),
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
