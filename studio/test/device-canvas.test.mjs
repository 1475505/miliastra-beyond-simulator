import { externalRoot, externalFixture, missingFixture } from '../../test/fixtures.mjs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createStudio } from '../index.js'
import { CANVAS_PRESETS } from '../constants.js'

function loadFlappy(studio) {
  const save = JSON.parse(readFileSync(externalFixture('workspace/flappy-fish/flappy-fish.save.json'), 'utf8'))
  studio.importData('json', Buffer.from(JSON.stringify(save)).toString('base64'), 'flappy-fish.save.json')
}

function mountCanvasLogger(studio) {
  const rootId = studio.get().root.children[0].id
  studio.patch({
    op: 'addScript',
    controlId: rootId,
    path: 'inline',
    source: `
function OnStart()
  local w, h = game.GetUICanvasSize()
  local device = game.GetDevice()
  print("canvas", w, h, device.Name)
end
`,
  })
}

test('play start accepts a device canvasId override without touching the editor selection', { skip: missingFixture('workspace/flappy-fish/flappy-fish.save.json') }, () => {
  const studio = createStudio()
  try {
    loadFlappy(studio)
    mountCanvasLogger(studio)
    const snap = studio.playStart({ view: true, canvasId: 'mobile-19.5-9' })
    assert.equal(snap.canvasId, 'mobile-19.5-9')
    assert.equal(snap.platform, 'TOUCHSCREEN')
    assert.equal(snap.device, 'Mobile')
    assert.equal(snap.canvasWidth, 1560)
    assert.equal(snap.canvasHeight, 720)
    assert.match(snap.logs.map((l) => l.text).join('\n'), /canvas\t1560\t720\tMobile/)
    assert.ok(Array.isArray(snap.canvasPresets) && snap.canvasPresets.length === 5)
    assert.deepEqual(
      snap.canvasPresets.map((p) => `${p.id}:${p.width}×${p.height}`).sort(),
      ['mobile-16-9:1280×720', 'mobile-19.5-9:1560×720', 'mobile-4-3:1280×960', 'pc-16-9:1600×900', 'pc-21-9:2100×900'].sort(),
    )
    // 试玩设备只影响本次运行时，编辑器正在编辑的画布保持不变。
    assert.equal(studio.get().canvasId, 'pc-16-9')
  } finally {
    studio.playStop()
  }
})

test('every device preset reports its own GetUICanvasSize and platform device', { skip: missingFixture('workspace/flappy-fish/flappy-fish.save.json') }, () => {
  for (const preset of Object.values(CANVAS_PRESETS)) {
    const studio = createStudio()
    try {
      loadFlappy(studio)
      mountCanvasLogger(studio)
      const snap = studio.playStart({ canvasId: preset.id })
      assert.match(
        snap.logs.map((l) => l.text).join('\n'),
        new RegExp(`canvas\\t${preset.width}\\t${preset.height}\\t${preset.luaDevice}`),
        preset.id,
      )
      assert.equal(snap.canvasWidth, preset.width)
      assert.equal(snap.canvasHeight, preset.height)
      assert.equal(snap.platform, preset.platform)
    } finally {
      studio.playStop()
    }
  }
})

test('switching device mid-play rebuilds the runtime on the new canvas and re-solves anchors', { skip: missingFixture('workspace/flappy-fish/flappy-fish.save.json') }, () => {
  const studio = createStudio()
  try {
    loadFlappy(studio)
    studio.playStart()
    studio.playPause()
    for (let i = 0; i < 5; i++) studio.playStep(1 / 30)
    const before = studio.playGet()
    assert.equal(before.canvasId, 'pc-16-9')
    assert.equal(before.canvasWidth, 1600)

    const after = studio.playSetCanvas('mobile-4-3', { inspect: true })
    assert.equal(after.canvasId, 'mobile-4-3')
    assert.equal(after.platform, 'TOUCHSCREEN')
    assert.equal(after.canvasWidth, 1280)
    assert.equal(after.canvasHeight, 960)
    // 新生命周期：引擎时间归零，而不是接着旧时钟跑。
    assert.ok(after.time < 0.05, `time should reset, got ${after.time}`)
    assert.ok(after.time < before.time, 'device switch must not carry over elapsed time')
    // 锚点重排：stretch 根铺满新画布（原点左下，anchor 0–1 相对父矩形）。
    const root = after.tree.find((node) => node.name === 'GameRoot')
    assert.ok(root, 'GameRoot should exist')
    assert.equal(root.box.left, 0)
    assert.equal(root.box.bottom, 0)
    assert.equal(root.box.width, 1280)
    assert.equal(root.box.height, 960)

    // 粘性：显式切换后，无参的隐式重启沿用该设备。
    const rerun = studio.playRun(1)
    assert.equal(rerun.canvasId, 'mobile-4-3')
    // 显式 stop 之后回到跟随编辑器画布。
    studio.playStop()
    const fallback = studio.playRun(1)
    assert.equal(fallback.canvasId, 'pc-16-9')
    assert.equal(fallback.canvasWidth, 1600)
  } finally {
    studio.playStop()
  }
})

test('unknown or missing canvas ids are rejected with the available presets listed', { skip: missingFixture('workspace/flappy-fish/flappy-fish.save.json') }, () => {
  const studio = createStudio()
  try {
    loadFlappy(studio)
    assert.throws(() => studio.playStart({ canvasId: 'ipad-13' }), /unknown canvas preset: ipad-13.*pc-16-9/s)
    assert.throws(() => studio.playSetCanvas(''), /requires canvasId/)
    assert.throws(() => studio.playSetCanvas('pc-32-9'), /unknown canvas preset/)
    // 失败不产生副作用：没有留下半启动的会话。
    assert.equal(studio.playStatus().running, false)
  } finally {
    studio.playStop()
  }
})

test('runCase can pin its own device canvas for cross-device regression cases', { skip: missingFixture('workspace/flappy-fish/flappy-fish.save.json') }, () => {
  const studio = createStudio()
  try {
    loadFlappy(studio)
    mountCanvasLogger(studio)
    const report = studio.playRunCase({
      name: 'canvas-size-mobile',
      events: [],
      asserts: [{ kind: 'log', contains: 'canvas\t1280\t720\tMobile' }],
    }, { canvasId: 'mobile-16-9' })
    assert.equal(report.passed, true)
  } finally {
    studio.playStop()
  }
})
