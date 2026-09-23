/**
 * 试玩帧循环性能探针（flappy-fish 真实存档）。运行: cd simulator/studio && node scripts/bench-play-perf.mjs
 * 只读测量，不改任何状态文件。
 */
import { performance } from 'node:perf_hooks'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createRuntime } from 'qxqy-lua-runtime'
import { createStudio } from '../index.js'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const SAVE_PATH = join(repoRoot, 'workspace', 'flappy-fish', 'flappy-fish.save.json')
const PAGE_POLL_MS = 33
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function makeSpec(nImages, scriptSource) {
  const children = []
  for (let i = 0; i < nImages; i += 1) {
    children.push({
      kind: 'image',
      name: `img${i}`,
      imageId: 100001,
      imageColor: 0xffffffff,
      anchoredPositionX: (i % 8) * 60,
      anchoredPositionY: Math.floor(i / 8) * 60,
      sizeDeltaX: 48,
      sizeDeltaY: 48,
    })
  }
  return {
    kind: 'container',
    name: 'root',
    children,
    scripts: scriptSource ? [{ path: 'bench', source: scriptSource }] : undefined,
  }
}

const LUA_MEDIUM = `
function OnStart()
  script:EnableUpdate(true)
  kids = script.object:GetChildren()
end
function OnUpdate(dt)
  for i = 1, #kids do
    local x, y = kids[i]:GetAnchoredPosition()
    kids[i]:SetAnchoredPosition(x + dt * 120, y)
  end
end
`

const LUA_HEAVY = `
local pts = {}
local N = 30
function OnStart()
  script:EnableUpdate(true)
  for i = 1, N do
    pts[i] = { x = i * 10, y = 400 - i * 5, px = i * 10, py = 400 - i * 5 }
  end
end
function OnUpdate(dt)
  local g = -900 * dt * dt
  for i = 1, N do
    local p = pts[i]
    local nx = p.x + (p.x - p.px) * 0.99
    local ny = p.y + (p.y - p.py) * 0.99 + g
    p.px, p.py, p.x, p.y = p.x, p.y, nx, ny
  end
  for it = 1, 3 do
    for i = 1, N - 1 do
      local a, b = pts[i], pts[i + 1]
      local dx, dy = b.x - a.x, b.y - a.y
      local d = math.sqrt(dx * dx + dy * dy)
      local diff = (d - 10) / d * 0.5
      a.x = a.x + dx * diff
      a.y = a.y + dy * diff
      b.x = b.x - dx * diff
      b.y = b.y - dy * diff
    end
  end
end
`

function benchEngine(label, scriptSource, { steps = 300 } = {}) {
  const tBoot0 = performance.now()
  const rt = createRuntime({ canvasWidth: 1600, canvasHeight: 900 })
  rt.addRoot(makeSpec(40, scriptSource))
  for (let i = 0; i < 10; i += 1) rt.step(1 / 30)
  const bootMs = performance.now() - tBoot0
  let maxStep = 0
  const t0 = performance.now()
  for (let i = 0; i < steps; i += 1) {
    const s = performance.now()
    rt.step(1 / 30)
    const d = performance.now() - s
    if (d > maxStep) maxStep = d
  }
  const total = performance.now() - t0
  console.log(
    `[engine] ${label.padEnd(28)} boot=${bootMs.toFixed(0)}ms  avg=${(total / steps).toFixed(2)}ms/step  max=${maxStep.toFixed(2)}ms  ${(steps / (total / 1000)).toFixed(0)} steps/s`,
  )
  rt.destroy()
}

async function benchFlappy() {
  console.log('')
  console.log('== B/C. flappy-fish 真实存档 ==')
  const raw = readFileSync(SAVE_PATH, 'utf8')
  let t0 = performance.now()
  const archive = JSON.parse(raw)
  console.log(`[load] 存档解析 ${(performance.now() - t0).toFixed(0)}ms（${(raw.length / 1024).toFixed(0)}KB）`)

  t0 = performance.now()
  const studio = createStudio(archive)
  console.log(`[load] createStudio ${(performance.now() - t0).toFixed(0)}ms`)

  // 启动成本分解
  t0 = performance.now()
  const startSnap = studio.playStart({ view: true, compact: true })
  const startMs = performance.now() - t0
  const logs = startSnap.logs || []
  const startLog = logs.find((l) => String(l.text).startsWith('flappy-start'))
  console.log(`[start] playStart 总耗时 ${startMs.toFixed(0)}ms；日志 ${logs.length} 条；spawned=${startLog ? startLog.text.split('\t')[2] : '?'}；可见图元=${startSnap.scene?.count ?? (startSnap.paint || []).length}`)

  // 进入游玩状态（点击画布中心开始）
  studio.playPointer('click', 800, 450)
  const runningSnap = studio.playGet()
  console.log(`[tap] 点击后日志尾: ${logs.length} -> ${runningSnap.logs.length} 条，state 日志含 flappy-play=${runningSnap.logs.some((l) => l.text === 'flappy-play')}`)

  // 单步成本分布（游玩态）
  const N = 300
  let sum = 0
  let max = 0
  for (let i = 0; i < N; i += 1) {
    const s = performance.now()
    studio.playStep(1 / 30, { observe: false })
    const d = performance.now() - s
    sum += d
    if (d > max) max = d
  }
  console.log(`[step] 游玩态 playStep(纯步进，含丢弃快照) avg=${(sum / N).toFixed(2)}ms  max=${max.toFixed(2)}ms  (${(N / (sum / 1000)).toFixed(0)} steps/s)`)

  // 观测成本
  const benchObserve = (label, fn, iterations) => {
    fn()
    const s0 = performance.now()
    for (let i = 0; i < iterations; i += 1) fn()
    const avg = (performance.now() - s0) / iterations
    console.log(`[observe] ${label.padEnd(36)} avg=${avg.toFixed(3)}ms/call`)
    return avg
  }
  benchObserve('playGet（AI 工具每次调用）', () => studio.playGet(), 100)
  let lastPayloadBytes = 0
  let sceneRev = 0
  benchObserve('playGet view:true 首帧（全量场景树）', () => {
    const snapView = studio.playGet({ view: true, compact: true })
    lastPayloadBytes = JSON.stringify(snapView).length
    sceneRev = snapView.scene?.revision || 0
  }, 1)
  console.log(`[observe] view:true 首帧载荷 ≈ ${(lastPayloadBytes / 1024).toFixed(0)}KB`)
  benchObserve('playGet view:true 增量（页面轮询负载）', () => {
    const snapView = studio.playGet({ view: true, sceneRev, compact: true })
    lastPayloadBytes = JSON.stringify(snapView).length
    sceneRev = snapView.scene?.revision || sceneRev
  }, 50)
  console.log(`[observe] view:true 增量载荷 ≈ ${(lastPayloadBytes / 1024).toFixed(0)}KB/次（页面每 ${PAGE_POLL_MS}ms 拉一次 → ${(lastPayloadBytes * 1000 / PAGE_POLL_MS / 1024).toFixed(0)}KB/s）`)

  // 近似叠加 worker 固定步长与试玩页 33ms view 轮询的成本。
  const wallSeconds = 8
  const FIXED_DT = 1 / 30
  let lastTick = 0
  let acc = 0
  const loopT0 = Date.now()
  let ticks = 0
  let stepsTotal = 0
  let polls = 0
  let pollMs = 0
  let maxTick = 0
  while (Date.now() - loopT0 < wallSeconds * 1000) {
    await sleep(PAGE_POLL_MS)
    const status = studio.playStatus()
    if (!status.running || status.paused) continue
    const now = Date.now()
    if (!lastTick) { lastTick = now; continue }
    const s0 = performance.now()
    acc += Math.min(0.25, Math.max(0, (now - lastTick) / 1000))
    lastTick = now
    let n = 0
    while (acc >= FIXED_DT && n < 5) { studio.playStep(FIXED_DT, { observe: false }); acc -= FIXED_DT; n += 1 }
    if (acc > FIXED_DT) acc = FIXED_DT
    const d = performance.now() - s0
    if (d > maxTick) maxTick = d
    ticks += 1
    stepsTotal += n
    const p0 = performance.now()
    const snapView = studio.playGet({ view: true, sceneRev, compact: true })
    sceneRev = snapView.scene?.revision || sceneRev
    pollMs += performance.now() - p0
    polls += 1
  }
  const finalTime = studio.playGet().time
  const wall = (Date.now() - loopT0) / 1000
  console.log(
    `[loop] 墙钟=${wall.toFixed(2)}s  模拟时钟(含前置步进)=${Number(finalTime).toFixed(2)}s  loop步数=${stepsTotal}(期望~${Math.round(wall * 30)})  ` +
    `最大单tick=${maxTick.toFixed(1)}ms  视图快照avg=${(pollMs / Math.max(1, polls)).toFixed(2)}ms@${(polls / wall).toFixed(1)}Hz`,
  )
}

console.log('== A. Fengari 引擎单步吞吐（40 控件树，dt=1/30）==')
benchEngine('空 OnUpdate', 'function OnUpdate(dt) end')
benchEngine('桥接写 40 控件位置', LUA_MEDIUM)
benchEngine('纯Lua 绳索物理30点x3迭代', LUA_HEAVY)

await benchFlappy()
