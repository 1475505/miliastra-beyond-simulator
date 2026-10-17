import test from 'node:test'
import assert from 'node:assert/strict'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { Container, Matrix, Text } from 'pixi.js'
import { createRuntime } from '../../client/lua-runtime/src/index.js'
import { injectPlayPointer, paintList, playSnapshot, hitPlayControl, playAdapter } from '../play/session.js'
import { renderScenePng, renderPaintPng } from '../host-png.js'
import { PixiPlayRenderer } from '../play/pixi-renderer.js'
import { replayCase } from '../autotest/runner.js'

function fixture(t, spec = {}) {
  const runtime = createRuntime({ canvasWidth: 240, canvasHeight: 160 })
  t.after(() => runtime.destroy())
  const root = runtime.addRoot({ name: 'Root', kind: 'container', active: true, showCursor: true, sizeDeltaX: 240, sizeDeltaY: 160,
    children: [{ kind: 'textwindow', name: 'Scroll', active: true, sizeDeltaX: 160, sizeDeltaY: 80,
      text: Array.from({ length: 10 }, (_, i) => `Line ${i}`).join('\n'), fontSize: 20, horizontalAlignment: 'Left', verticalAlignment: 'Top', ...spec }] })
  return { runtime, control: root.children[0], session: { runtime, compiled: { canvasId: 'pc-16-9', platform: 'PC' }, recording: true, history: { events: [] } } }
}

const scrollNode = (session) => playSnapshot(session, { view: true }).scene.nodes.find(n => n.name === 'Scroll')
const pointer = (session, type, x, y, extra = {}) => injectPlayPointer(session, type, x, y, { silent: true, ...extra })

test('text window drag and wheel move content, clamp both ends, and generate incremental scene changes', t => {
  const { session, control } = fixture(t)
  const first = playSnapshot(session, { view: true }).scene
  assert.equal(first.nodes.find(n => n.name === 'Scroll').scroll.max, 160) // 10*24 - 80
  assert.equal(pointer(session, 'down', 120, 60), control)
  pointer(session, 'move', 120, 95)
  pointer(session, 'up', 120, 95)
  const patch = playSnapshot(session, { view: true, sceneRev: first.revision }).scene
  assert.equal(patch.reset, false)
  assert.equal(patch.changed.find(n => n.name === 'Scroll').scroll.offset, 35)
  pointer(session, 'wheel', 120, 80, { deltaY: 1000 })
  assert.equal(scrollNode(session).scroll.offset, 160)
  pointer(session, 'wheel', 120, 80, { deltaY: -1000 })
  assert.equal(scrollNode(session).scroll.offset, 0)
  assert.throws(() => pointer(session, 'wheel', 120, 80, { deltaY: Infinity }), /finite/)
})

test('scrollbar track/handle, disabled and hidden states, cancel and short-text reflow', t => {
  const { session, control } = fixture(t)
  pointer(session, 'down', 194, 46) // bottom of track -> end
  pointer(session, 'up', 194, 46)
  assert.equal(scrollNode(session).scroll.offset, 160)
  pointer(session, 'down', 194, 56)
  pointer(session, 'move', 194, 100)
  pointer(session, 'up', 194, 100)
  assert.ok(scrollNode(session).scroll.offset < 30)
  control.interactable = false
  pointer(session, 'wheel', 120, 80, { deltaY: 100 })
  assert.ok(scrollNode(session).scroll.offset < 30)
  control.interactable = true
  control.showScrollBar = false
  pointer(session, 'wheel', 120, 80, { deltaY: 100 })
  assert.equal(scrollNode(session).scroll.showBar, false)
  const offset = scrollNode(session).scroll.offset
  pointer(session, 'down', 120, 60)
  pointer(session, 'cancel', 120, 60)
  pointer(session, 'move', 120, 95)
  assert.equal(scrollNode(session).scroll.offset, offset)
  control.SetVisible(false)
  pointer(session, 'wheel', 120, 80, { deltaY: -100 })
  assert.equal(control._scrollOffset, offset)
  control.SetVisible(true)
  control.text = 'short'
  control.markPlayDirty()
  assert.equal(scrollNode(session).scroll.max, 0)
  assert.equal(scrollNode(session).scroll.offset, 0)
  control.text = 'W'.repeat(100)
  control.markPlayDirty()
  assert.ok(scrollNode(session).scroll.lines.length > 1, 'long single lines wrap before computing overflow')
})

test('drag uses transformed local coordinates and does not scroll an obscured window', t => {
  const { session, control, runtime } = fixture(t, { localScaleY: 2 })
  pointer(session, 'down', 120, 60)
  pointer(session, 'move', 120, 100)
  pointer(session, 'up', 120, 100)
  assert.equal(scrollNode(session).scroll.offset, 20)
  runtime.addRoot({ kind: 'button', active: true, sizeDeltaX: 240, sizeDeltaY: 160 })
  pointer(session, 'wheel', 120, 80, { deltaY: 60 })
  assert.equal(scrollNode(session).scroll.offset, 20)
  assert.equal(control.anchoredPositionY, 0)
})

test('PNG and Pixi text use identical wrapping/offset and draw the scrollbar', async t => {
  const { session } = fixture(t)
  const first = playSnapshot(session, { view: true }).scene
  const before = renderScenePng(first, 240, 160).data
  pointer(session, 'wheel', 120, 80, { deltaY: 48 })
  const second = playSnapshot(session, { view: true }).scene
  const after = renderScenePng(second, 240, 160).data
  assert.equal(before.equals(after), false)
  assert.ok(after.equals(renderPaintPng(paintList(session), 240, 160).data))
  const renderer = Object.create(PixiPlayRenderer.prototype), root = new Container()
  t.after(() => root.destroy({ children: true, context: true }))
  const node = second.nodes.find(n => n.name === 'Scroll')
  renderer.replaceVisual(root, node, 160, 80)
  const text = root.__visual.children.find(n => n instanceof Text)
  assert.equal(text.y, -64)
  assert.equal(text.text, node.scroll.lines.slice(1, 7).join('\n'))
  assert.equal(text.style.wordWrap, false)
  assert.ok(root.__visual.children.some(n => n.label === 'scrollbar'))
})

function gridFixture(t, extra = {}) {
  const f = fixture(t, { kind: 'grid', itemPrefabIndex: 123, cellSizeX: 70, cellSizeY: 30, spacingX: 0, spacingY: 0,
    padding1X: 0, padding1Y: 0, padding2X: 0, padding2Y: 0, ...extra })
  f.runtime.registerTemplate(123, { kind: 'button', name: 'item', active: true, children: [
    { kind: 'image', active: true, sizeDeltaX: 70, sizeDeltaY: 30, imageId: 100001, imageColor: 0xffff0000 },
  ] })
  f.control.RefreshItems(10, (item, index) => { item.name = `item-${index}` })
  return f
}

test('grid refresh uses Lua callback/control/index, zero-based indexes, reuse, size getters and programmatic scrolling', t => {
  const { runtime, control, session } = gridFixture(t)
  const firstItem = control._gridItems[0]
  runtime.mountScript({ path: 'grid-test', control, source: `
function OnStart()
  local grid = script.object
  local count = 0
  grid:RefreshItems(10, function(item, index)
    assert(grid:GetItemIndex(item) == index)
    item.name = 'row-' .. index
    count = count + 1
  end)
  assert(count == 10 and grid.itemCount == 10)
  local w, h = grid:GetItemSize()
  assert(w == 70 and h == 30)
  local x, y = grid:GetItemSpacing()
  assert(x == 0 and y == 0)
  local top, bottom, left, right = grid:GetPadding()
  assert(top == 0 and bottom == 0 and left == 0 and right == 0)
  assert(grid:GetContentLength() == 150)
  grid:ScrollToItemAt(9, Enum.ScrollAlignType.Bottom)
  assert(grid.scrollProgress == 1)
end` })
  assert.deepEqual(runtime.logs.filter(n => n.level === 'lua-error'), [])
  assert.equal(control._gridItems[0], firstItem)
  assert.equal(scrollNode(session).scroll.offset, 70)
  assert.equal(control._gridItems[8].anchoredPositionY, -65)
  const old = control._gridItems.slice()
  control.RefreshItems(2, () => {})
  assert.equal(old[2].alive, false)
  assert.equal(control._gridItems[0], firstItem)
  assert.equal(scrollNode(session).scroll.max, 0)
  assert.throws(() => control.RefreshItems(2001, () => {}), /2000/)
})

test('grid wheel/drag route through items, suppress item click, horizontal layout and static children stay fixed', t => {
  const { runtime, session, control } = gridFixture(t, { scrollDirection: 'Horizontal', layoutConstraint: 'Fixed', layoutConstraintFixedCount: 1 })
  const item = control._gridItems[0]
  let clicks = 0
  item.AddCursorEventListener('CursorClick', () => clicks++)
  pointer(session, 'down', 70, 100)
  pointer(session, 'move', 40, 100)
  pointer(session, 'up', 40, 100)
  assert.equal(clicks, 0)
  assert.equal(scrollNode(session).scroll.offset, 30)
  pointer(session, 'wheel', 120, 80, { deltaY: 40 })
  assert.equal(scrollNode(session).scroll.offset, 70)
  assert.equal(item.anchoredPositionX, -35)
  assert.notEqual(hitPlayControl(session, 20, 100), item, 'outside viewport is not clickable')
  const staticChild = runtime.instantiate(123, control, 'running')
  staticChild.SetAnchoredPosition(7, 9)
  pointer(session, 'wheel', 120, 80, { deltaX: 40 })
  scrollNode(session)
  assert.deepEqual(staticChild.GetAnchoredPosition(), [7, 9])
})

test('grid item clipping reaches PNG and Pixi, including descendants and incremental updates', async t => {
  const { session } = gridFixture(t)
  const scene = playSnapshot(session, { view: true }).scene
  const png = renderScenePng(scene, 240, 160).data
  assert.ok(png.equals(renderPaintPng(paintList(session), 240, 160).data))
  const ctx = createCanvas(240, 160).getContext('2d')
  ctx.drawImage(await loadImage(png), 0, 0)
  const pixel = (x, y) => [...ctx.getImageData(x, y, 1, 1).data].slice(0, 3)
  assert.deepEqual(pixel(50, 50), [255, 0, 0])
  assert.notDeepEqual(pixel(50, 125), [255, 0, 0], 'items beyond the 40..120 viewport must be clipped')
  const renderer = Object.create(PixiPlayRenderer.prototype)
  Object.assign(renderer, { ready: Promise.resolve(), nodes: new Map(), scratch: new Matrix(), canvasWidth: 240, canvasHeight: 160,
    app: { stage: new Container(), render() {}, renderer: { resize() {} } } })
  t.after(() => renderer.clearNodes())
  await renderer.applyScene(scene, 240, 160)
  const item = scene.nodes.find(n => n.name === 'item-0')
  assert.ok(renderer.nodes.get(item.id).mask)
  pointer(session, 'wheel', 120, 80, { deltaY: 40 })
  const patch = playSnapshot(session, { view: true, sceneRev: scene.revision }).scene
  await renderer.applyScene(patch, 240, 160)
  assert.equal(renderer.nodes.get(item.id).y, -65)
  const bounds = renderer.nodes.get(item.id).__viewportClip.getLocalBounds()
  assert.equal(bounds.height, 80)
})

test('wheel input is recorded and replayed with its deltas', t => {
  const { session } = fixture(t)
  const report = replayCase(playAdapter(session), { events: [{ kind: 'pointer', payload: { type: 'wheel', x: 120, y: 80, deltaY: 48 } }],
    asserts: [{ kind: 'control', name: 'Scroll', field: 'scrollOffset', equals: 48 }] })
  assert.equal(report.passed, true, JSON.stringify(report))
  assert.equal(session.history.events[0].payload.deltaY, 48)
})

test('Lua grid progress Tween drives scene movement, releases refresh callbacks and cleans up destroyed items', t => {
  const { runtime, session, control } = gridFixture(t)
  runtime.mountScript({ path: 'grid-tween', control, source: `
function OnStart()
  for i=1,10 do script.object:RefreshItems(10, function() end) end
  game.Tween(script.object, { scrollProgress = 1 }, 1):Play()
end` })
  assert.equal(runtime.luaFunctions.size, 0, 'synchronous refresh callbacks must not remain retained')
  runtime.step(0.5)
  assert.equal(scrollNode(session).scroll.offset, 35)
  runtime.step(0.5)
  assert.equal(scrollNode(session).scroll.offset, 70)
  pointer(session, 'down', 120, 60)
  const item = control._gridItems[0]
  runtime.destroyControl(control)
  pointer(session, 'move', 120, 95)
  pointer(session, 'up', 120, 95)
  assert.equal(item.alive, false)
  assert.equal(runtime.scrollControls.size, 0)
  assert.equal(session.pointerScroll, null)
})

test('flattened Pixi path clips grid descendants and releases viewport masks', async t => {
  const { session } = gridFixture(t)
  const renderer = Object.create(PixiPlayRenderer.prototype)
  Object.assign(renderer, { ready: Promise.resolve(), nodes: new Map(), scratch: new Matrix(), canvasWidth: 240, canvasHeight: 160,
    app: { stage: new Container(), render() {}, renderer: { resize() {} } } })
  t.after(() => renderer.clearNodes())
  await renderer.render(paintList(session), 240, 160)
  const images = [...renderer.nodes.values()].filter(n => n.__sceneItem.kind === 'image')
  assert.equal(images.length, 10)
  assert.ok(images.every(n => n.mask), 'flattened descendants inherit the viewport clip')
  const context = images[0].__viewportClip.context
  pointer(session, 'wheel', 120, 80, { deltaY: 30 })
  await renderer.render(paintList(session), 240, 160)
  assert.equal(context.destroyed, true)
})
