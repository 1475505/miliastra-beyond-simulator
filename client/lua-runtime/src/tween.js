import { ease } from './ease.js'
import { lerpColor } from './color.js'
import { DEEP_DIRTY_FIELDS } from './scene.js'

const COLOR_FIELDS = new Set(['fontColor', 'bgColor', 'outlineColor', 'imageColor'])

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
      const cur = this.object[k]
      this.from[k] = cur
      this.to[k] = this.relative ? Number(cur) + Number(v) : v
    }
  }

  restoreInitial() {
    if (this.initialFrom) {
      this.from = { ...this.initialFrom }
      this.to = { ...this.initialTo }
    } else {
      // 首次快照缺失（理论不可达：Play/Restart 总会先 capture）时退化为从当前值重建。
      this.capture()
    }
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

  _start(restart) {
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
    this.runtime.tweens.add(this)
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
    const e = ease(this.easeName, u)
    let changed = false
    let deep = false
    for (const k of Object.keys(this.to)) {
      const a = this.from[k]
      const b = this.to[k]
      if (COLOR_FIELDS.has(k) && typeof a === 'number' && typeof b === 'number') {
        this.object[k] = lerpColor(a, b, e)
      } else if (typeof a === 'number' && typeof b === 'number') {
        this.object[k] = a + (b - a) * e
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
    if (u >= 1) {
      if (this.onStepComplete) this.runtime.safeCall(this.onStepComplete)
      const infinite = this.loops < 0
      this.loopIndex++
      if (infinite || this.loopIndex < this.loops) {
        this.elapsed = Math.max(0, this.elapsed - this.duration)
        if (this.relative) this.capture()
        else this.restoreInitial()
        const next = this.duration <= 0 ? 1 : Math.min(1, this.elapsed / this.duration)
        this.apply(next)
      } else {
        this.finish(true)
      }
    }
  }

  finish(fireComplete) {
    this.playing = false
    this.killed = true
    this.runtime.tweens.delete(this)
    if (fireComplete && this.onComplete) this.runtime.safeCall(this.onComplete)
  }
}

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
    this._built = []
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
    this._activateDueEntries()
    this.runtime.sequences.add(this)
    return this
  }

  _schedule() {
    let t = 0
    // Join starts alongside the latest appended tween or interval.  Keep its
    // start separately from the sequence cursor: a Join must not be delayed
    // until the preceding Append has finished.
    let lastAppendStart = 0
    let hasAppend = false
    this._built = []
    for (const s of this.steps) {
      if (s.kind === 'tween' && s.parallel) {
        const at = hasAppend ? lastAppendStart : t
        this._built.push({ at, tween: s.tween })
        t = Math.max(t, at + s.tween.duration)
      } else if (s.kind === 'tween') {
        this._built.push({ at: t, tween: s.tween })
        lastAppendStart = t
        hasAppend = true
        t += s.tween.duration
      } else if (s.kind === 'interval') {
        lastAppendStart = t
        hasAppend = true
        t += s.duration
      } else if (s.kind === 'callback') {
        this._built.push({ at: t, fn: s.fn })
      } else if (s.kind === 'insert') {
        this._built.push({ at: s.time, tween: s.tween })
        t = Math.max(t, s.time + s.tween.duration)
      } else if (s.kind === 'insertCb') {
        this._built.push({ at: s.time, fn: s.fn })
        t = Math.max(t, s.time)
      }
    }
    this._end = t
    this._fired = new Set()
  }

  Pause() {
    this.paused = true
    for (const b of this._built) {
      if (b.tween && this._fired.has(b)) b.tween.Pause()
    }
  }

  Resume() {
    this.paused = false
    for (const b of this._built) {
      if (b.tween && this._fired.has(b)) b.tween.Resume()
    }
  }

  Restart() {
    this.Play()
  }

  Complete() {
    for (const b of this._built) {
      if (b.tween) {
        if (!this._fired.has(b)) b.tween.Play()
        b.tween.Complete()
      }
      if (b.fn && !this._fired.has(b)) this.runtime.safeCall(b.fn)
      this._fired.add(b)
    }
    this.finish(true)
  }

  Kill(complete) {
    if (complete) this.Complete()
    else {
      for (const b of this._built) {
        if (b.tween && this._fired.has(b)) b.tween.Kill(false)
      }
      this.finish(false)
    }
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

  _activateDueEntries() {
    for (const b of this._built) {
      if (this._fired.has(b) || this.elapsed + 1e-9 < b.at) continue
      this._fired.add(b)
      if (b.tween) b.tween.Play()
      if (b.fn) this.runtime.safeCall(b.fn)
    }
  }

  step(dt) {
    if (!this.playing || this.paused || this.killed) return
    this.elapsed += dt
    this._activateDueEntries()
    if (this.elapsed >= this._end) {
      if (this.onStepComplete) this.runtime.safeCall(this.onStepComplete)
      this.loopIndex++
      if (this.loops < 0 || this.loopIndex < this.loops) {
        this.elapsed = 0
        this._schedule()
      } else {
        this.finish(true)
      }
    }
  }

  finish(fire) {
    this.playing = false
    this.killed = true
    this.runtime.sequences.delete(this)
    if (fire && this.onComplete) this.runtime.safeCall(this.onComplete)
  }
}
