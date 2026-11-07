import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createPlaySession, keyEventName, PLAY_MOVE_THROTTLE_MS, PLAY_POLL_INTERVAL_MS } from '../play/browser-session.js'
import { mouseKeyEventName } from '../play/key-bindings.js'
import { buildEnumTree } from '../../client/lua-runtime/src/enums.js'
import { createStudio } from '../index.js'

test('a muted browser asks restarted play to stay silent without dropping caller args', async t => {
  const calls = []
  const play = createPlaySession({
    renderer: { async applyScene() {} },
    audio: { muted: true, audioChoice: null, sync() {}, reset() {}, unlock() {}, destroy() {} },
    api: async (action, args) => { calls.push({ action, args }); return { running: true, frame: 1, time: 0 } },
  })
  t.after(() => play.destroy())
  await play.start({ canvasId: 'mobile-16-9' })
  await play.device({ canvasId: 'pc-16-9' })
  assert.equal(calls[0].args.muteAudio, true)
  assert.equal(calls[0].args.canvasId, 'mobile-16-9')
  assert.equal(calls[1].args.muteAudio, true)
  play.audio.audioChoice = 'on'
  play.audio.muted = false
  await play.start()
  assert.equal(calls[2].args.muteAudio, false)
})

test('reloading a browser attaches to the existing paused game without a start or player change', async t => {
  const calls = [], rendered = []
  const snapshot = { running: true, paused: true, frame: 1254, time: 41.8,
    canvasWidth: 1280, canvasHeight: 720, viewPlayerIndex: 2, fps: 60,
    scene: { format: 'tree-v1', revision: 7, reset: true, nodes: [] } }
  const play = createPlaySession({
    renderer: { async applyScene(scene) { rendered.push(scene) } },
    async api(action, args) { calls.push({ action, args }); return snapshot },
  })
  t.after(() => play.destroy())
  await play.attach()
  play.stopPolling()
  assert.deepEqual(calls, [{ action: 'get', args: { view: true, compact: true, sceneRev: 0 } }])
  assert.equal(play.running, true)
  assert.equal(play.snapshot.paused, true)
  assert.equal(play.snapshot.frame, 1254)
  assert.equal(play.snapshot.viewPlayerIndex, 2)
  assert.equal(play.fps, 60)
  assert.equal(play.sceneRev, 7)
  assert.equal(rendered.length, 1)
})

test('browser doubles scene polling at 60 FPS and preserves the choice across restarts and device changes', async t => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'] })
  t.mock.method(performance, 'now', () => Date.now())
  const calls = []
  let fps = 30
  const play = createPlaySession({ renderer: { async applyScene() {} }, async api(action, args = {}) {
    calls.push({ action, args })
    if (args.fps !== undefined) fps = args.fps
    return { running: true, frame: 20, time: 0.5, fps }
  } })
  t.after(() => play.destroy())
  const pollsPerSecond = async () => {
    const first = calls.length
    for (let ms = 0; ms < 1000; ms++) {
      t.mock.timers.tick(1)
      await new Promise(resolve => setImmediate(resolve))
    }
    return calls.slice(first).filter(call => call.action === 'get').length
  }
  await play.start()
  const slow = await pollsPerSecond()
  await play.setFps(60)
  const fast = await pollsPerSecond()
  assert.ok(slow >= 29 && slow <= 31, `30 FPS requests: ${slow}`)
  assert.ok(fast >= 59 && fast <= 64, `60 FPS requests: ${fast}`)
  assert.equal(calls.filter(call => call.action === 'start').length, 1, 'switching must not restart Lua')
  await play.start()
  assert.equal(calls.at(-1).args.fps, 60)
  await play.device({ canvasId: 'mobile-16-9' })
  assert.equal(calls.at(-1).args.fps, 60)
  await play.setFps(30)
  const restored = await pollsPerSecond()
  assert.ok(restored >= 29 && restored <= 32, `restored 30 FPS requests: ${restored}`)
})

test('slow observations use the remaining frame budget without overlapping or dropping queued refreshes', async t => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'] })
  t.mock.method(performance, 'now', () => Date.now())
  const calls = [], revisions = []
  let active = 0, peak = 0, revision = 0
  const play = createPlaySession({
    renderer: { async applyScene() { await wait(3) } },
    async api(action, args) {
      if (action !== 'get') return { running: action !== 'stop', fps: 60 }
      calls.push(Date.now()); revisions.push(args.sceneRev)
      peak = Math.max(peak, ++active)
      await wait(17)
      active--
      return { running: true, fps: 60, scene: { format: 'tree-v1', revision: ++revision } }
    },
  })
  t.after(() => play.destroy())
  const advance = async ms => {
    for (let i = 0; i < ms; i++) {
      t.mock.timers.tick(1)
      await new Promise(resolve => setImmediate(resolve))
    }
  }
  await play.start()
  await advance(220)
  assert.ok(calls.length >= 10, `17 ms transport + 3 ms render must not become 32 ms polling: ${calls.length}`)
  assert.ok(calls.slice(1).every((at, i) => at - calls[i] >= 20 && at - calls[i] <= 21))
  assert.deepEqual(revisions, revisions.map((_, i) => i), 'each request uses the scene revision after rendering')
  assert.equal(peak, 1)
  play.stopPolling()
  await advance(50)
  const stopped = calls.length
  await advance(100)
  assert.equal(calls.length, stopped, 'a completed in-flight poll must not rearm stopped polling')

  play.pollSoon(0)
  await advance(1)
  play.pollSoon(0); play.pollSoon(0)
  await advance(60)
  assert.equal(calls.length, stopped + 2, 'refreshes during an in-flight poll coalesce into one follow-up')
  assert.equal(peak, 1)
})

test('late observations cannot revive stopped sessions or overwrite a replacement scene', async t => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'] })
  t.mock.method(performance, 'now', () => Date.now())
  const rendered = [], statuses = []
  let finish, gets = 0
  const play = createPlaySession({ renderer: { async applyScene(scene) { rendered.push(scene.revision) } },
    onSnapshot: next => statuses.push(next),
    async api(action) {
      if (action === 'get') { gets++; return new Promise(resolve => { finish = resolve }) }
      return { running: action !== 'stop', fps: 60, scene: { format: 'tree-v1', reset: true, revision: 10 } }
    },
  })
  t.after(() => play.destroy())
  await play.start()
  const pending = play.poll()
  await play.start()
  finish({ running: true, fps: 30, scene: { format: 'tree-v1', revision: 99 } })
  await pending
  assert.equal(play.sceneRev, 10)
  assert.equal(play.fps, 60)
  assert.deepEqual(rendered, [10, 10])
  const last = play.poll()
  await play.stop()
  finish({ running: true, fps: 30, scene: { format: 'tree-v1', revision: 100 } })
  await last
  t.mock.timers.tick(100)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(play.running, false)
  assert.equal(gets, 2)
  assert.equal(statuses.length, 2)
})

test('shared play loop polls compact scene views and sends light input', async () => {
  const calls = []
  const scenes = []
  const statuses = []
  let sceneRevSeen
  const renderer = {
    applied: [],
    async applyScene(scene, width, height) { this.applied.push({ scene, width, height }) },
    async render() {},
    destroy() { this.destroyed = true },
  }
  const play = createPlaySession({
    renderer,
    async api(action, args = {}) {
      calls.push({ action, args })
      if (action === 'start' || action === 'get') {
        sceneRevSeen = args.sceneRev
        return {
          running: true,
          paused: false,
          frame: calls.length,
          time: 0.1,
          canvasWidth: 1600,
          canvasHeight: 900,
          audio: { sessionId: 'play-1' },
          scene: { format: 'tree-v1', revision: 2, reset: action === 'start', nodes: [] },
        }
      }
      if (action === 'pointer' || action === 'key' || action === 'step') {
        return { running: true, paused: false, frame: 3, time: 0.2 }
      }
      if (action === 'stop') return { running: false }
      return { running: true }
    },
    onSnapshot: (next) => scenes.push(next),
    onStatus: (next) => statuses.push(next),
  })

  await play.start({ canvasId: 'pc-16-9' })
  assert.equal(calls[0].action, 'start')
  assert.equal(calls[0].args.view, true)
  assert.equal(calls[0].args.compact, true)
  assert.equal(calls[0].args.canvasId, 'pc-16-9')
  assert.equal(renderer.applied.length, 1)
  assert.equal(scenes.length, 1)

  await play.act('pointer', { type: 'down', x: 10, y: 20 })
  const pointer = calls.find((call) => call.action === 'pointer')
  assert.equal(pointer.args.light, true)
  assert.equal(pointer.args.type, 'down')
  assert.equal(statuses.length, 1)

  await play.poll()
  const get = calls.find((call) => call.action === 'get')
  assert.equal(get.args.view, true)
  assert.equal(get.args.compact, true)
  assert.equal(get.args.sceneRev, 2)
  assert.equal(get.args.sceneSessionId, 'play-1')
  assert.equal(sceneRevSeen, 2)

  play.destroy()
  assert.equal(renderer.destroyed, true)
  assert.equal(PLAY_POLL_INTERVAL_MS, 33)
})

test('browser key mapping covers the documented 58 keyboard/mouse bindings and only supported letters', () => {
  // Independent expectations transcribed from the official rev223 key table,
  // not imported from the production map. 33–35 are comma, period, slash.
  const craft = [
    ...Array.from('1234567890', n => `Digit${n}`),
    ...Array.from('UZYGHIOPJKLV', letter => `Key${letter}`),
    ...Array.from({ length: 6 }, (_, i) => `F${i + 5}`),
    'Backquote', 'Minus', 'Equal', 'BracketLeft', 'Comma', 'Period', 'Slash',
    'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ControlRight', 'ShiftRight', 'Backspace', 'CapsLock',
  ]
  const pairs = craft.map((code, i) => [code, `CraftspersonKey${i + 1}`]).concat([
    ['KeyW', 'MoveForwardKey'], ['KeyS', 'MoveBackwardKey'], ['KeyA', 'MoveLeftKey'], ['KeyD', 'MoveRightKey'],
    ['ControlLeft', 'SwitchToWalkOrRunKey'], ['Space', 'JumpKey'], ['KeyX', 'DropKey'],
    ['Tab', 'OpenShortcutWheelKey'], ['KeyF', 'InteractKey'], ['KeyE', 'CharacterSkill1Key'],
    ['KeyQ', 'CharacterSkill2Key'], ['KeyR', 'CharacterSkill3Key'], ['KeyT', 'CharacterSkill4Key'],
  ])
  const actual = new Set()
  for (const phase of ['Down', 'Up']) {
    for (const [code, name] of pairs) {
      const mapped = keyEventName({ code }, phase)
      assert.equal(mapped, `Keyboard${name}${phase}`, code)
      actual.add(mapped)
    }
    for (const [button, name] of [[0, 'NormalAttackKey'], [2, 'SprintKey']]) {
      const mapped = mouseKeyEventName(button, phase)
      assert.equal(mapped, `Keyboard${name}${phase}`)
      actual.add(mapped)
    }
  }
  const documented = Object.keys(buildEnumTree().KeyEventType).filter(name => name.startsWith('Keyboard'))
  assert.equal(actual.size, 116)
  assert.deepEqual([...actual].sort(), documented.sort())
  assert.equal(keyEventName({ code: 'KeyY', key: 'j' }, 'Down'), 'KeyboardCraftspersonKey19Down')
  assert.equal(keyEventName({ code: 'KeyF', key: 'D' }, 'Up'), 'KeyboardMoveRightKeyUp')
  for (const event of [{ code: 'KeyJ', key: 'c' }, { code: 'KeyW', key: 'n' }, { code: 'KeyB', key: 'b' },
    { code: 'BracketRight' }, { code: 'Backslash' }, { code: 'Escape' },
    { code: 'KeyJ', key: 'Process' }, { code: 'KeyJ', key: 'j', isComposing: true }]) {
    assert.equal(keyEventName(event, 'Down'), '', JSON.stringify(event))
  }
  assert.equal(mouseKeyEventName(1, 'Down'), '')
})

test('key forwarding toggles, releases held inputs and leaves cursor events independent', async t => {
  const events = [], calls = []
  const studio = createStudio()
  const names = ['KeyboardCraftspersonKey19', 'KeyboardMoveForwardKey', 'KeyboardNormalAttackKey', 'KeyboardSprintKey']
    .flatMap(name => [name + 'Down', name + 'Up'])
  studio.patch({ op: 'addScript', controlId: 'n1', controlAsset: 'server-control-template', path: 'keys', source: `
function OnStart()
  for _, name in ipairs({${names.map(name => JSON.stringify(name)).join(',')}}) do
    script.object:AddKeyEventListener(Enum.KeyEventType[name], function() print(name) end)
  end
end` })
  let active = true, inputActive = true
  const play = createPlaySession({ renderer: { async applyScene() {} }, isActive: () => active, isInputActive: () => inputActive,
    async api(action, args = {}) {
      calls.push(action)
      if (action === 'start') return studio.playStart(args)
      if (action === 'get') return studio.playGet(args)
      if (action === 'key') { events.push(args.key); return studio.playKey(args.key, { observe: false }) }
      if (action === 'pointer') return studio.playPointer(args.type, args.x, args.y, { observe: false })
      if (action === 'view') return { running: true, canvasWidth: 1600, canvasHeight: 900 }
    },
  })
  t.after(() => { play.destroy(); studio.playStop() })
  const target = () => ({ handlers: {}, addEventListener(name, fn) { this.handlers[name] = fn }, removeEventListener(name) { delete this.handlers[name] } })
  const win = target(), doc = { ...target(), defaultView: win, hidden: false }
  const surface = { ...target(), ownerDocument: doc, getBoundingClientRect: () => ({ left: 0, bottom: 900, width: 1600, height: 900 }) }
  const dispose = play.bindInput(surface, { keysOn: win })
  const key = (type, extra = {}) => {
    const event = { code: 'KeyY', key: 'j', target: surface, preventDefault() { this.prevented = true }, ...extra }
    win.handlers[type](event)
    return !!event.prevented
  }
  await play.start()
  play.stopPolling()
  assert.equal(key('keydown'), true)
  key('keydown', { repeat: true })
  key('keyup', { key: 'Y' }) // release uses the original binding, even if the layout changed
  await wait(0)
  assert.deepEqual(events.splice(0), ['KeyboardCraftspersonKey19Down', 'KeyboardCraftspersonKey19Up'])

  for (const extra of [{ target: { closest: () => ({}) } }, { isComposing: true }, { key: 'c' }, { repeat: true }]) {
    key('keydown', extra)
  }
  assert.deepEqual(events, [])
  key('keydown', { code: 'KeyW', key: 'w' })
  play.setKeyInputEnabled(false)
  assert.equal(play.keyInputEnabled, false)
  assert.equal(key('keydown'), false)
  key('keyup', { code: 'KeyW', key: 'w' })
  await wait(0)
  assert.deepEqual(events.splice(0), ['KeyboardMoveForwardKeyDown', 'KeyboardMoveForwardKeyUp'])
  const pointer = { button: 0, pointerId: 1, pointerType: 'mouse', clientX: 800, clientY: 450 }
  surface.handlers.pointerdown(pointer)
  surface.handlers.mousedown(pointer)
  surface.handlers.pointerup(pointer)
  doc.handlers.mouseup(pointer)
  await wait(0)
  assert.ok(calls.includes('pointer'), 'turning keys off must not disable cursor input')
  assert.deepEqual(events, [])
  play.setKeyInputEnabled(true)
  surface.handlers.mousedown(pointer)
  surface.handlers.mousedown({ ...pointer, button: 2 })
  doc.handlers.mouseup(pointer)
  doc.handlers.mouseup({ ...pointer, button: 2 })
  await wait(0)
  assert.deepEqual(events.splice(0), ['KeyboardNormalAttackKeyDown', 'KeyboardSprintKeyDown', 'KeyboardNormalAttackKeyUp', 'KeyboardSprintKeyUp'])
  surface.handlers.mousedown({ ...pointer, sourceCapabilities: { firesTouchEvents: true } })
  assert.deepEqual(events, [], 'touch compatibility events are not physical mouse keys')
  for (const release of [() => win.handlers.blur(), () => win.handlers.focusout(), () => { doc.hidden = true; doc.handlers.visibilitychange() }]) {
    key('keydown')
    release()
    doc.hidden = false
    key('keyup')
    await wait(0)
    assert.deepEqual(events.splice(0), ['KeyboardCraftspersonKey19Down', 'KeyboardCraftspersonKey19Up'])
  }
  key('keydown')
  active = false
  await play.releaseKeys()
  assert.deepEqual(events.splice(0), ['KeyboardCraftspersonKey19Down', 'KeyboardCraftspersonKey19Up'])
  assert.equal(key('keydown'), false)
  active = true; inputActive = false
  assert.equal(key('keydown'), false)
  inputActive = true
  key('keydown')
  await wait(0)
  const switching = play.view({ playerIndex: 2 })
  assert.equal(key('keydown', { code: 'KeyW', key: 'w' }), false, 'do not add held keys while changing players')
  await switching
  assert.deepEqual(calls.slice(-2), ['key', 'view'], 'release the old player before switching')
  events.length = 0
  key('keydown')
  dispose()
  await wait(0)
  assert.deepEqual(events, ['KeyboardCraftspersonKey19Down', 'KeyboardCraftspersonKey19Up'])
  assert.equal(Object.keys(win.handlers).length + Object.keys(doc.handlers).length + Object.keys(surface.handlers).length, 0)
  assert.equal(studio.playGet().logs.some(row => row.text === 'KeyboardCraftspersonKey19Down'), true)
  assert.equal(studio.playGet().logs.some(row => row.level === 'lua-error'), false)
})

test('slow key delivery cannot reorder Down/Up or replay queued keys into a restarted Worker', async t => {
  const calls = [], handlers = {}
  let finishDown
  const play = createPlaySession({ renderer: { async applyScene() {} }, async api(action, args) {
    if (action === 'key') {
      calls.push(args.key)
      if (args.key.endsWith('Down')) await new Promise(resolve => { finishDown = resolve })
    }
    return { running: true, canvasWidth: 1600, canvasHeight: 900 }
  } })
  t.after(() => { finishDown?.(); play.destroy() })
  play.bindInput({ addEventListener(type, fn) { handlers[type] = fn }, removeEventListener(type) { delete handlers[type] } })
  const event = { code: 'KeyW', key: 'w', preventDefault() {} }
  await play.start(); play.stopPolling()
  handlers.keydown(event); handlers.keyup(event)
  await wait(0)
  assert.deepEqual(calls, ['KeyboardMoveForwardKeyDown'])
  finishDown(); await play.releaseKeys()
  assert.deepEqual(calls, ['KeyboardMoveForwardKeyDown', 'KeyboardMoveForwardKeyUp'])
  calls.length = 0
  handlers.keydown(event); handlers.keyup(event)
  await wait(0)
  play.reset()
  finishDown(); await play.releaseKeys()
  assert.deepEqual(calls, ['KeyboardMoveForwardKeyDown'], 'the old queued Up must not enter a replacement session')
})

const CURSOR_EVENTS = ['CursorDown', 'CursorUp', 'CursorClick', 'CursorBeginDrag', 'CursorDrag', 'CursorEndDrag']
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function bindStudioPlay(t, { beforePointer, playerCount = 1 } = {}) {
  const studio = createStudio()
  studio.patch({ op: 'addScript', controlId: 'n1', controlAsset: 'server-control-template', path: 'main', source: `
function OnStart()
  script.object.showCursor = true
  local button = script.object:FindChild("预设按钮")
  for _, name in ipairs({ ${CURSOR_EVENTS.map((name) => `"${name}"`).join(', ')} }) do
    button:AddCursorEventListener(Enum.CursorEventType[name], function() print(name) end)
  end
end` })
  const pointers = [], actions = []
  let active = true
  const play = createPlaySession({
    renderer: { async applyScene() {}, async render() {} },
    isActive: () => active,
    async api(action, args = {}) {
      actions.push(action)
      if (action === 'start') return studio.playStart(args)
      if (action === 'get') return studio.playGet(args)
      if (action === 'stop') return studio.playStop()
      if (action === 'view') return studio.playSetView(args.playerIndex, args)
      if (action === 'pointer') {
        await beforePointer?.(args)
        pointers.push(args)
        return studio.playPointer(args.type, args.x, args.y, { observe: false })
      }
      return null
    },
  })
  t.after(() => { play.destroy(); studio.playStop() })
  await play.start({ playerCount })
  play.stopPolling()
  const { canvasWidth: width, canvasHeight: height } = play.snapshot
  const target = () => ({ handlers: {}, addEventListener(type, fn) { this.handlers[type] = fn }, removeEventListener(type) { delete this.handlers[type] } })
  const win = target(), doc = { ...target(), defaultView: win, hidden: false }
  const captured = new Set()
  const surface = { ...target(), ownerDocument: doc,
    setPointerCapture(id) { captured.add(id) },
    hasPointerCapture(id) { return captured.has(id) },
    releasePointerCapture(id) { captured.delete(id); this.handlers.lostpointercapture?.({ pointerId: id }) },
    getBoundingClientRect: () => ({ left: 0, width, bottom: height, height }),
  }
  const bind = () => play.bindInput(surface, { keysOn: win })
  const dispose = bind()
  const fire = (type, x, y, extra = {}) => surface.handlers[type]?.({ pointerId: 1, clientX: x, clientY: height - y, ...extra })
  const cursorLogs = () => studio.playGet().logs.map((row) => row.text).filter((text) => CURSOR_EVENTS.includes(text))
  return { play, pointers, actions, fire, cursorLogs, win, doc, captured, dispose, bind, setActive(value) { active = value } }
}

test('a quick browser drag reaches Lua as down, move, up instead of a click', async t => {
  const { pointers, fire, cursorLogs } = await bindStudioPlay(t)
  fire('pointerdown', 790, 450)
  fire('pointermove', 810, 450)
  fire('pointerup', 810, 450)
  await wait(PLAY_MOVE_THROTTLE_MS + 20)
  assert.deepEqual(pointers.map(({ type, x }) => `${type}:${x}`), ['down:790', 'move:810', 'up:810'])
  assert.deepEqual(cursorLogs(), ['CursorDown', 'CursorBeginDrag', 'CursorDrag', 'CursorUp', 'CursorEndDrag'])
})

test('browser clicks still click and throttled moves coalesce without stale replays', async t => {
  const { pointers, fire, cursorLogs } = await bindStudioPlay(t)
  fire('pointerdown', 800, 450)
  fire('pointerup', 800, 450)
  fire('pointermove', 801, 450)
  fire('pointermove', 802, 450)
  await wait(PLAY_MOVE_THROTTLE_MS + 20)
  fire('pointermove', 803, 450)
  fire('pointerdown', 803, 450)
  fire('pointerup', 803, 450)
  await wait(PLAY_MOVE_THROTTLE_MS + 20)
  assert.deepEqual(pointers.map(({ type, x }) => `${type}:${x}`),
    ['down:800', 'up:800', 'move:802', 'move:803', 'down:803', 'up:803'])
  assert.deepEqual(cursorLogs(), ['CursorDown', 'CursorUp', 'CursorClick', 'CursorDown', 'CursorUp', 'CursorClick'])
})

test('a delayed pointer request cannot deliver release before press or lose a real click', async t => {
  let finishDown
  const started = []
  const { fire, pointers, cursorLogs } = await bindStudioPlay(t, { beforePointer: async args => {
    started.push(args.type)
    if (args.type === 'down') await new Promise(resolve => { finishDown = resolve })
  } })
  t.after(() => finishDown?.())
  fire('pointerdown', 800, 450)
  fire('pointermove', 802, 450)
  fire('pointerup', 802, 450)
  await wait(0)
  assert.deepEqual(started, ['down'], 'the browser must wait for press delivery before sending move/release')
  assert.deepEqual(cursorLogs(), [])
  finishDown()
  await wait(0)
  assert.deepEqual(pointers.map(p => p.type), ['down', 'move', 'up'])
  assert.deepEqual(cursorLogs(), ['CursorDown', 'CursorUp', 'CursorClick'])
})

test('queued pointer cancellation follows press and old input cannot enter a restarted Worker', async t => {
  let finishDown
  const { play, fire, pointers, cursorLogs, win } = await bindStudioPlay(t, { beforePointer: async args => {
    if (args.type === 'down') await new Promise(resolve => { finishDown = resolve })
  } })
  t.after(() => finishDown?.())
  fire('pointerdown', 800, 450)
  fire('pointermove', 810, 450)
  win.handlers.blur()
  fire('pointerup', 800, 450)
  await wait(0)
  assert.deepEqual(pointers, [])
  finishDown()
  await wait(0)
  assert.deepEqual(pointers.map(p => p.type), ['down', 'cancel'])
  assert.deepEqual(cursorLogs(), ['CursorDown', 'CursorUp'])
  pointers.length = 0
  fire('pointerdown', 800, 450)
  fire('pointermove', 810, 450)
  win.handlers.blur()
  await wait(0)
  play.reset()
  finishDown()
  await wait(PLAY_MOVE_THROTTLE_MS + 20)
  assert.deepEqual(pointers.map(p => p.type), ['down'], 'queued release belongs to the old generation')
})

test('blur, hidden pages, inactive views, player switches and unbinding cancel drag once and accept a new pointer', async t => {
  for (const reason of ['blur', 'hidden', 'inactive', 'player', 'unbind']) {
    const { play, fire, pointers, actions, cursorLogs, win, doc, captured, dispose, bind, setActive } = await bindStudioPlay(t, { playerCount: 2 })
    fire('pointerdown', 790, 450)
    fire('pointermove', 810, 450)
    await wait(PLAY_MOVE_THROTTLE_MS + 20)
    assert.deepEqual(cursorLogs(), ['CursorDown', 'CursorBeginDrag', 'CursorDrag'], reason)
    fire('pointermove', 820, 450) // this throttled move must not survive cancellation
    if (reason === 'blur') win.handlers.blur()
    if (reason === 'hidden') { doc.hidden = true; doc.handlers.visibilitychange(); doc.hidden = false }
    if (reason === 'inactive') { setActive(false); await play.releaseInputs(); setActive(true) }
    if (reason === 'player') {
      await play.view({ playerIndex: 2 })
      assert.deepEqual(actions.slice(-2), ['pointer', 'view'])
      await play.view({ playerIndex: 1 })
    }
    if (reason === 'unbind') { dispose(); bind() }
    fire('lostpointercapture', 820, 450)
    fire('pointerup', 820, 450)
    await wait(PLAY_MOVE_THROTTLE_MS + 20)
    assert.deepEqual(pointers.map(p => p.type), ['down', 'move', 'cancel'], reason)
    assert.deepEqual(cursorLogs(), ['CursorDown', 'CursorBeginDrag', 'CursorDrag', 'CursorUp', 'CursorEndDrag'], reason)
    assert.equal(captured.size, 0, reason)
    fire('pointerdown', 800, 450, { pointerId: 2 })
    fire('pointerup', 800, 450, { pointerId: 2 })
    await wait(0)
    assert.equal(cursorLogs().at(-1), 'CursorClick', reason)
    play.destroy()
  }
})

test('wheel pixels/lines/pages scale into canvas units and cancellation ignores a second touch', async t => {
  const calls = [], handlers = {}
  const play = createPlaySession({
    renderer: { async applyScene() {} },
    async api(action, args) {
      calls.push({ action, args })
      return { running: true, canvasWidth: 1600, canvasHeight: 900 }
    },
  })
  t.after(() => play.destroy())
  await play.start()
  play.stopPolling()
  const surface = {
    addEventListener(type, fn) { handlers[type] = fn }, removeEventListener(type) { delete handlers[type] },
    getBoundingClientRect: () => ({ left: 10, bottom: 500, width: 800, height: 450 }),
  }
  const dispose = play.bindInput(surface)
  let prevented = 0
  for (const deltaMode of [0, 1, 2]) handlers.wheel({ clientX: 410, clientY: 275, deltaMode, deltaX: 1, deltaY: 2, preventDefault() { prevented++ } })
  await wait(0)
  const wheels = calls.filter(c => c.args?.type === 'wheel').map(c => c.args)
  assert.deepEqual(wheels.map(c => [c.x, c.y, c.deltaX, c.deltaY]), [[800, 450, 2, 4], [800, 450, 32, 64], [800, 450, 1600, 1800]])
  assert.equal(prevented, 3)
  const p = { pointerId: 1, clientX: 410, clientY: 275 }
  handlers.pointerdown(p)
  handlers.pointermove({ ...p, pointerId: 2, clientY: 240 })
  handlers.pointerup({ ...p, pointerId: 2 })
  handlers.pointermove({ ...p, clientY: 250 })
  handlers.pointercancel(p)
  handlers.pointerup(p)
  await wait(PLAY_MOVE_THROTTLE_MS + 20)
  assert.deepEqual(calls.filter(c => c.action === 'pointer' && c.args.type !== 'wheel').map(c => c.args.type), ['down', 'cancel'])
  dispose()
  assert.equal(Object.keys(handlers).length, 0)
})
