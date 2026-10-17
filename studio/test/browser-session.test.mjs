import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createPlaySession, keyEventName, PLAY_MOVE_THROTTLE_MS, PLAY_POLL_INTERVAL_MS } from '../play/browser-session.js'
import { mouseKeyEventName } from '../play/key-bindings.js'
import { buildEnumTree } from '../../client/lua-runtime/src/enums.js'
import { createStudio } from '../index.js'

test('reloading a browser attaches to the existing paused game without a start or player change', async t => {
  const calls = [], rendered = []
  const snapshot = { running: true, paused: true, frame: 1254, time: 41.8,
    canvasWidth: 1280, canvasHeight: 720, viewPlayerIndex: 2,
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
  assert.equal(play.sceneRev, 7)
  assert.equal(rendered.length, 1)
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

async function bindStudioPlay(t) {
  const studio = createStudio()
  studio.patch({ op: 'addScript', controlId: 'n1', controlAsset: 'server-control-template', path: 'main', source: `
function OnStart()
  script.object.showCursor = true
  local button = script.object:FindChild("预设按钮")
  for _, name in ipairs({ ${CURSOR_EVENTS.map((name) => `"${name}"`).join(', ')} }) do
    button:AddCursorEventListener(Enum.CursorEventType[name], function() print(name) end)
  end
end` })
  const pointers = []
  const play = createPlaySession({
    renderer: { async applyScene() {}, async render() {} },
    async api(action, args = {}) {
      if (action === 'start') return studio.playStart(args)
      if (action === 'get') return studio.playGet(args)
      if (action === 'stop') return studio.playStop()
      if (action === 'pointer') {
        pointers.push(args)
        return studio.playPointer(args.type, args.x, args.y, { observe: false })
      }
      return null
    },
  })
  t.after(() => { play.destroy(); studio.playStop() })
  await play.start()
  const { canvasWidth: width, canvasHeight: height } = play.snapshot
  const handlers = {}
  play.bindInput({
    addEventListener(type, fn) { handlers[type] = fn },
    removeEventListener(type) { delete handlers[type] },
    getBoundingClientRect: () => ({ left: 0, width, bottom: height, height }),
  }, { keysOn: { addEventListener() {}, removeEventListener() {} } })
  const fire = (type, x, y) => handlers[type]({ pointerId: 1, clientX: x, clientY: height - y })
  const cursorLogs = () => studio.playGet().logs.map((row) => row.text).filter((text) => CURSOR_EVENTS.includes(text))
  return { play, pointers, fire, cursorLogs }
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

test('pending browser moves are dropped when the play session resets', async t => {
  const { play, pointers, fire } = await bindStudioPlay(t)
  fire('pointermove', 810, 450)
  play.reset()
  await wait(PLAY_MOVE_THROTTLE_MS + 20)
  assert.deepEqual(pointers, [])
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
