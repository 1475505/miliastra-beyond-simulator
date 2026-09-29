import { ease } from './ease.js'
import { lerpColor } from './color.js'
import { DEEP_DIRTY_FIELDS } from './scene.js'

const COLOR_FIELDS = new Set(['fontColor', 'bgColor', 'outlineColor', 'imageColor'])
// Device TWSEM v1: a fontSize tween writes truncated integers (20.99 -> 20).
const TRUNCATED_FIELDS = new Set(['fontSize'])
const TIME_EPSILON = 1e-9

// Tweens start from the value Lua would read (rotation getters normalise to
// [0, 360), so an absolute -116 -> -136 tween runs 244 -> -136 on device).
function readField(object, key) {
  return typeof object?.luaFieldValue === 'function' ? object.luaFieldValue(key) : object[key]
}

export class Tween {
  constructor(runtime, object, data, duration) {
    this.runtime = runtime
    this.object = object
    this.data = { ...data }
    this.duration = Math.max(0, Number(duration) || 0)
    this.easeName = 'Linear'
    this.relative = false
    this.playing = false
    this.paused = false
    this.elapsed = 0
    this.loops = 1
    this.loopIndex = 0
    this.from = {}
    this.to = {}
    this.initialFrom = null
    this.initialTo = null
    this.onComplete = null
    this.onStepComplete = null
    this.killed = false
  }

  capture() {
    this.from = {}
    this.to = {}
    for (const [k, v] of Object.entries(this.data)) {
      const cur = readField(this.object, k)
      this.from[k] = cur
      this.to[k] = this.relative ? Number(cur) + Number(v) : v
    }
  }

  restoreInitial() {
    this.from = { ...this.initialFrom }
    this.to = { ...this.initialTo }
  }

  SetEase(item) {
    this.easeName = typeof item === 'string' ? item : item?.Name || 'Linear'
    return this
  }

  SetRelative(v) {
    this.relative = !!v
    return this
  }

  Play() {
    return this._start(false)
  }

  // Values are captured when playback starts (device TWSEM v1 C1), not at creation.
  _begin(restart) {
    this.playing = true
    this.paused = false
    this.elapsed = 0
    this.loopIndex = 0
    this.killed = false
    if (restart && this.initialFrom) this.restoreInitial()
    else {
      this.capture()
      this.initialFrom = { ...this.from }
      this.initialTo = { ...this.to }
    }
  }

  _start(restart) {
    this._begin(restart)
    this.runtime.tweens.add(this)
    this.runtime.animations.add(this)
    if (this.duration === 0) this.Complete()
    return this
  }

  Pause() {
    this.paused = true
  }

  Resume() {
    this.paused = false
  }

  Restart() {
    return this._start(true)
  }

  Complete() {
    this.apply(1)
    this.finish(true)
  }

  Kill(complete) {
    if (complete) this.Complete()
    else this.finish(false)
  }

  SetOnComplete(fn) {
    this.onComplete = fn
    return this
  }

  SetOnStepComplete(fn) {
    this.onStepComplete = fn
    return this
  }

  SetLoops(n) {
    this.loops = n
    return this
  }

  apply(u) {
    if (this.object?.alive === false) return
    const e = ease(this.easeName, u)
    let changed = false
    let deep = false
    for (const k of Object.keys(this.to)) {
      const a = this.from[k]
      const b = this.to[k]
      if (COLOR_FIELDS.has(k) && typeof a === 'number' && typeof b === 'number') {
        this.object[k] = lerpColor(a, b, e)
      } else if (typeof a === 'number' && typeof b === 'number') {
        const value = a + (b - a) * e
        this.object[k] = TRUNCATED_FIELDS.has(k) ? Math.trunc(value) : value
      } else {
        this.object[k] = e >= 1 ? b : a
      }
      changed = true
      if (DEEP_DIRTY_FIELDS.has(k)) deep = true
    }
    if (changed && typeof this.object?.markPlayDirty === 'function') this.object.markPlayDirty(deep)
  }

  step(dt) {
    if (!this.playing || this.paused || this.killed) return
    this.elapsed += dt
    const u = this.duration <= 0 ? 1 : Math.min(1, this.elapsed / this.duration)
    this.apply(u)
    if (u < 1) return
    if (this.onStepComplete) this.runtime.safeCall(this.onStepComplete)
    this.loopIndex++
    if (this.loops < 0 || this.loopIndex < this.loops) {
      // Device (TWSEM v1 L1): the frame reaching the end shows the end value;
      // the next loop starts on the following frame and drops the overflow.
      this.elapsed = 0
      if (this.relative) this.capture()
      else this.restoreInitial()
    } else {
      this.finish(true)
    }
  }

  finish(fireComplete) {
    this.playing = false
    this.killed = true
    this.runtime.tweens.delete(this)
    this.runtime.animations.delete(this)
    if (fireComplete && this.onComplete) this.runtime.safeCall(this.onComplete)
  }
}

// The sequence drives its child tweens on its own timeline; children are not
// registered as standalone tweens. Device rules (TWINV v1, TWSEM v1):
// - Play() only schedules; entries due at 0 run on the next update.
// - Per update, due events run in time order: a child's end, then callbacks,
//   then child starts at equal times. A callback therefore sees a child ending
//   at its time at the end value (E1) but a mid-flight child at the previous
//   frame's value (K1); a starting child captures after same-time callbacks
//   (O1/O2). Running children are interpolated last, credited with the time
//   since their slot.
// - Each loop replays from the start. A child restarts from its first capture
//   only when its slot comes round again and keeps its end value until then.
export class TweenSequence {
  constructor(runtime) {
    this.runtime = runtime
    this.steps = []
    this.playing = false
    this.paused = false
    this.killed = false
    this.elapsed = 0
    this.loops = 1
    this.loopIndex = 0
    this.onComplete = null
    this.onStepComplete = null
    this._entries = null
  }

  Append(tween) {
    this.steps.push({ kind: 'tween', tween, parallel: false })
    return this
  }

  AppendInterval(sec) {
    this.steps.push({ kind: 'interval', duration: sec })
    return this
  }

  AppendCallback(fn) {
    this.steps.push({ kind: 'callback', fn })
    return this
  }

  Join(tween) {
    this.steps.push({ kind: 'tween', tween, parallel: true })
    return this
  }

  Insert(time, tween) {
    this.steps.push({ kind: 'insert', time, tween })
    return this
  }

  InsertCallback(time, fn) {
    this.steps.push({ kind: 'insertCb', time, fn })
    return this
  }

  Play() {
    this.playing = true
    this.paused = false
    this.killed = false
    this.elapsed = 0
    this.loopIndex = 0
    this._schedule()
    this.runtime.sequences.add(this)
    this.runtime.animations.add(this)
    return this
  }

  _schedule() {
    let t = 0
    // Join starts alongside the latest appended tween or interval.  Keep its
    // start separately from the sequence cursor: a Join must not be delayed
    // until the preceding Append has finished.
    let lastAppendStart = 0
    let hasAppend = false
    const entries = []
    for (const s of this.steps) {
      if (s.kind === 'tween' && s.parallel) {
        const at = hasAppend ? lastAppendStart : t
        entries.push({ at, tween: s.tween })
        t = Math.max(t, at + s.tween.duration)
      } else if (s.kind === 'tween') {
        entries.push({ at: t, tween: s.tween })
        lastAppendStart = t
        hasAppend = true
        t += s.tween.duration
      } else if (s.kind === 'interval') {
        lastAppendStart = t
        hasAppend = true
        t += s.duration
      } else if (s.kind === 'callback') {
        entries.push({ at: t, fn: s.fn })
      } else if (s.kind === 'insert') {
        entries.push({ at: s.time, tween: s.tween })
        t = Math.max(t, s.time + s.tween.duration)
      } else if (s.kind === 'insertCb') {
        entries.push({ at: s.time, fn: s.fn })
        t = Math.max(t, s.time)
      }
    }
    this._entries = entries.map((entry, index) => ({ ...entry, index }))
    this._end = t
    this._resetEntries()
  }

  _resetEntries() {
    for (const entry of this._entries) {
      entry.started = false
      entry.done = false
    }
  }

  _startChild(entry) {
    entry.started = true
    entry.tween._begin(!!entry.tween.initialFrom)
  }

  _finishChild(entry) {
    entry.done = true
    entry.tween.apply(1)
    if (entry.tween.onStepComplete) this.runtime.safeCall(entry.tween.onStepComplete)
    entry.tween.finish(true)
  }

  // Run every child end, callback and child start due by `time` in time order,
  // then move still-running children to the current position. Returns false
  // when a callback restarted, completed or killed the sequence.
  _advanceTo(time) {
    const entries = this._entries
    const due = []
    for (const entry of entries) {
      if (!entry.started && entry.at <= time + TIME_EPSILON) due.push({ at: entry.at, rank: entry.fn ? 1 : 2, entry })
      if (entry.tween && !entry.done && entry.at + entry.tween.duration <= time + TIME_EPSILON) {
        due.push({ at: entry.at + entry.tween.duration, rank: 0, entry })
      }
    }
    due.sort((a, b) => a.at - b.at || a.rank - b.rank || a.entry.index - b.entry.index)
    for (const { rank, entry } of due) {
      if (rank === 1) {
        entry.started = true
        this.runtime.safeCall(entry.fn)
        if (!this.playing || this.killed || this._entries !== entries) return false
      } else {
        if (!entry.started) this._startChild(entry)
        if (rank === 0 && !entry.done) this._finishChild(entry)
      }
    }
    for (const entry of entries) {
      if (!entry.tween || !entry.started || entry.done) continue
      const tween = entry.tween
      tween.elapsed = this.elapsed - entry.at
      tween.apply(tween.duration <= 0 ? 1 : Math.min(1, tween.elapsed / tween.duration))
    }
    return true
  }

  step(dt) {
    if (!this.playing || this.paused || this.killed) return
    this.elapsed += dt
    if (!this._advanceTo(this.elapsed)) return
    if (this.elapsed + TIME_EPSILON < this._end) return
    if (this.onStepComplete) this.runtime.safeCall(this.onStepComplete)
    this.loopIndex++
    if (this.loops < 0 || this.loopIndex < this.loops) {
      // Like a single Tween, the next loop starts on the following update.
      this.elapsed = 0
      this._resetEntries()
    } else {
      this.finish(true)
    }
  }

  Pause() {
    this.paused = true
  }

  Resume() {
    this.paused = false
  }

  Restart() {
    this.Play()
  }

  // Device (TWSEM v1 K1-K3): the rest of the timeline runs at once in time
  // order (a callback at 0.8 still sees a tween ending at 1.0 mid-way), then
  // the step and complete callbacks. A sequence that never played completes too.
  Complete() {
    if (!this._entries) this._schedule()
    this.playing = true
    this.killed = false
    if (!this._advanceTo(Infinity)) return
    if (this.onStepComplete) this.runtime.safeCall(this.onStepComplete)
    this.finish(true)
  }

  Kill(complete) {
    if (complete) this.Complete()
    else this.finish(false)
  }

  SetOnComplete(fn) {
    this.onComplete = fn
    return this
  }

  SetOnStepComplete(fn) {
    this.onStepComplete = fn
    return this
  }

  SetLoops(n) {
    this.loops = n
    return this
  }

  finish(fire) {
    this.playing = false
    this.killed = true
    this.runtime.sequences.delete(this)
    this.runtime.animations.delete(this)
    if (fire && this.onComplete) this.runtime.safeCall(this.onComplete)
  }
}
