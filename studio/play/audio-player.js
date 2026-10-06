import { audioAssetUrl, audioDuration } from '../assets/audio-catalog.js'

// One output per play page. Runtime instances are deterministic; media loading
// and the user's autoplay consent never feed back into Lua's clock/state.
export class BrowserAudioPlayer {
  constructor({ contextFactory = () => new (globalThis.AudioContext || globalThis.webkitAudioContext)(),
    fetch: fetcher = (...args) => globalThis.fetch(...args), onStatus = () => {}, now = () => performance.now() } = {}) {
    Object.assign(this, { contextFactory, fetcher, onStatus, now })
    this.context = null
    this.output = null
    this.buffers = new Map()
    this.voices = new Map()
    this.key = ''
    this.sequence = 0
    this.paused = false
    this.muted = false
    this.disposed = false
    this.error = ''
    this.revision = -1
    this.unlockHandlers = []
  }

  status() {
    return { unlocked: this.context?.state === 'running', muted: this.muted, error: this.error, voices: this.voices.size }
  }

  publish() { this.onStatus(this.status()) }

  ensureContext() {
    if (!this.context) {
      this.context = this.contextFactory()
      this.output = this.context.createGain()
      this.output.gain.value = this.muted ? 0 : 1
      this.output.connect(this.context.destination)
      this.context.onstatechange = () => this.publish()
    }
    return this.context
  }

  unlock() {
    if (this.disposed) return
    try {
      const context = this.ensureContext()
      // Call resume synchronously inside the trusted input handler.
      void context.resume().then(() => {
        if (this.disposed) return
        for (const voice of this.voices.values()) this.playVoice(voice)
        this.publish()
      }).catch(error => { this.error = error.message; this.publish() })
      for (const voice of this.voices.values()) this.playVoice(voice)
    } catch (error) { this.error = error.message; this.publish() }
  }

  bindUnlock(target) {
    const handler = event => { if (!event.target?.closest?.('[data-audio-toggle]')) this.unlock() }
    for (const name of ['pointerdown', 'keydown']) target.addEventListener(name, handler, { capture: true })
    const dispose = () => { for (const name of ['pointerdown', 'keydown']) target.removeEventListener(name, handler, { capture: true }) }
    this.unlockHandlers.push(dispose)
    return dispose
  }

  toggle() {
    if (this.context?.state !== 'running') this.unlock()
    else this.setMuted(!this.muted)
  }

  setMuted(muted) {
    this.muted = Boolean(muted)
    if (this.output) this.output.gain.value = this.muted ? 0 : 1
    this.publish()
  }

  buffer(id) {
    const cached = this.buffers.get(id)
    if (cached && (!cached.failed || this.now() < cached.retryAt)) {
      this.buffers.delete(id); this.buffers.set(id, cached)
      return cached.promise
    }
    const entry = { bytes: 0, failed: false, abort: new AbortController() }
    const timer = setTimeout(() => entry.abort.abort(), 30_000)
    entry.promise = (async () => {
      const response = await this.fetcher(audioAssetUrl(id), { signal: entry.abort.signal })
      if (!response.ok) throw new Error(`音效 ${id} 加载失败：HTTP ${response.status}`)
      const bytes = await response.arrayBuffer()
      if (this.disposed) throw new Error('audio player disposed')
      const buffer = await this.ensureContext().decodeAudioData(bytes)
      entry.bytes = buffer.length * buffer.numberOfChannels * 4
      let total = [...this.buffers.values()].reduce((n, row) => n + row.bytes, 0)
      for (const [key, row] of this.buffers) {
        if (total <= 32 * 1024 * 1024 && this.buffers.size <= 64) break
        if (key === id || (!row.bytes && !row.failed)) continue
        this.buffers.delete(key); total -= row.bytes
      }
      return buffer
    })().catch(error => {
      entry.failed = true; entry.retryAt = this.now() + 60_000
      throw error
    }).finally(() => clearTimeout(timer))
    this.buffers.set(id, entry)
    return entry.promise
  }

  stopSource(voice) {
    const source = voice.source
    voice.source = null
    if (!source) return
    source.onended = null
    try { source.stop() } catch {}
    source.disconnect()
  }

  removeVoice(id) {
    const voice = this.voices.get(id)
    if (!voice) return
    this.stopSource(voice)
    this.voices.delete(id)
  }

  playVoice(voice) {
    if (this.disposed || this.voices.get(voice.row.instanceId) !== voice || this.paused || voice.source || voice.loading || voice.done) return
    if (!voice.buffer) {
      voice.loading = true
      this.buffer(voice.row.audioId).then(buffer => {
        voice.loading = false
        if (this.disposed || this.voices.get(voice.row.instanceId) !== voice) return
        voice.buffer = buffer
        this.playVoice(voice)
      }).catch(error => {
        if (this.disposed || this.voices.get(voice.row.instanceId) !== voice) return
        this.removeVoice(voice.row.instanceId)
        this.error = error.message
        this.publish()
      })
      return
    }
    if (this.context?.state !== 'running') { this.publish(); return }
    if (voice.offset >= voice.buffer.duration) { voice.done = true; return }
    const source = this.context.createBufferSource()
    source.buffer = voice.buffer
    source.connect(this.output)
    voice.source = source
    voice.beganAt = this.context.currentTime
    source.onended = () => {
      if (voice.source !== source) return
      source.disconnect()
      voice.source = null
      voice.done = true
      this.publish()
    }
    source.start(0, voice.offset)
    this.publish()
  }

  sync(snapshot, { fresh = false } = {}) {
    if (this.disposed) return
    if (snapshot?.running === false) { this.reset(); return }
    const audio = snapshot?.audio
    if (!audio) return
    const key = `${audio.sessionId}:${audio.playerIndex}`
    const first = key !== this.key
    if (first) { this.reset(); this.key = key }
    if (!first && (audio.sequence < this.sequence || audio.revision < this.revision)) return
    this.revision = audio.revision
    const wasPaused = this.paused
    this.paused = Boolean(snapshot.paused)
    const active = new Map(audio.active.map(row => [row.instanceId, row]))
    const recent = new Map(audio.recent.map(row => [row.instanceId, row]))
    for (const [id, voice] of this.voices) {
      const state = recent.get(id) || active.get(id)
      if (state?.stopped || (voice.done && !active.has(id)) || !state) { this.removeVoice(id); continue }
      if (this.paused && !wasPaused && voice.source) {
        voice.offset += Math.max(0, this.context.currentTime - voice.beganAt)
        this.stopSource(voice)
      }
    }
    // Attachment/view changes resume only live voices at their logical offset.
    // New events play once from the start even if cold download exceeds their
    // logical lifetime; explicit StopAudio still cancels delayed playback.
    const rows = first && !fresh ? audio.active : audio.recent
    for (const row of rows) {
      if ((!first && row.instanceId <= this.sequence) || row.stopped || audioDuration(row.audioId) === null || row.duration <= 0) continue
      if (this.voices.size >= 64) this.removeVoice(this.voices.keys().next().value)
      const voice = { row, offset: first && !fresh ? Math.max(0, snapshot.time - row.startedAt) : 0,
        source: null, buffer: null, loading: false, done: false }
      this.voices.set(row.instanceId, voice)
    }
    this.sequence = audio.sequence
    for (const voice of this.voices.values()) this.playVoice(voice)
    this.publish()
  }

  reset() {
    for (const id of this.voices.keys()) this.removeVoice(id)
    this.key = ''; this.sequence = 0; this.revision = -1; this.paused = false
    this.publish()
  }

  destroy() {
    this.disposed = true
    this.reset()
    for (const entry of this.buffers.values()) entry.abort.abort()
    this.buffers.clear()
    for (const dispose of this.unlockHandlers) dispose()
    this.unlockHandlers.length = 0
    if (this.context) { this.context.onstatechange = null; void this.context.close().catch(() => {}) }
  }
}
