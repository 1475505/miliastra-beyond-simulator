import { uiVfxAsset, uiVfxTime, uiVfxUrl } from '../assets/ui-vfx-catalog.js'
import { applyMatrix, invertMatrix } from '../ui/layout.js'
import { createMaskSampler } from './image-mask.js'
import { loadBrowserImageAsset, subscribeImageRefresh } from '../assets/browser.js'
import { imageAssetKey } from '../assets/catalog.js'
import { t } from '../i18n.js'

// Each pair participates directly in the stage's isolated CSS blending context.
// Never wrap it in an opacity/transform/mask group: T and C must see the actual
// backdrop (including the transparent Pixi canvas), not an offscreen black group.
// multiply(T) followed by plus-lighter(C) gives C + backdrop*T. Applying the
// same coverage to each plane gives m*C + backdrop*(1-m+m*T).
export class BrowserUIVfxPlayer {
  constructor(host, { now = () => performance.now(), onStatus = () => {}, timeout = 30_000 } = {}) {
    Object.assign(this, { host, now, onStatus, timeout })
    this.entries = new Map()
    this.key = ''
    this.disposed = false
    this.snapshot = null
    this.raf = null
    this.lastFrame = 0
    this.host.style.display = 'contents'
    this.badge = host.ownerDocument.createElement('span')
    this.badge.dataset.uiVfxStatus = ''
    Object.assign(this.badge.style, { position: 'absolute', left: '5px', bottom: '5px', zIndex: '3',
      color: '#ffc18b', background: '#1a233ddd', padding: '2px 5px', font: '11px sans-serif', pointerEvents: 'none', display: 'none' })
    host.append(this.badge)
    this.errors = new Map()
    this.maskAssets = new Map()
    this.unsubscribeImages = subscribeImageRefresh(key => {
      this.maskAssets.delete(key)
      this.refreshMasks(key)
    })
  }

  refreshMasks(key) {
    for (const entry of this.entries.values()) {
      if (!entry.row.masks?.some(mask => imageAssetKey(mask.imageId, mask.imageSource) === key)) continue
      entry.maskKey = ''
      try { this.position(entry, false); this.draw(entry) } catch (error) { this.fail(entry, error) }
    }
  }

  maskAsset(spec) {
    if (spec.primitive !== 'sprite') return null
    const key = imageAssetKey(spec.imageId, spec.imageSource)
    let entry = this.maskAssets.get(key)
    if (!entry) {
      entry = {}
      this.maskAssets.set(key, entry)
      loadBrowserImageAsset(spec.imageId, spec.imageSource).then(asset => {
        if (this.disposed || this.maskAssets.get(key) !== entry) return
        entry.asset = asset
        this.refreshMasks(key)
      }, () => { /* Missing image coverage stays empty until explicit refresh. */ })
    }
    return entry.asset
  }

  report(id, message) {
    if (message) this.errors.set(id, String(message))
    else this.errors.delete(id)
    const errors = [...this.errors.values()]
    this.badge.style.display = errors.length ? '' : 'none'
    this.badge.textContent = errors.length ? t`动效加载失败（${errors.length}）` : ''
    this.badge.title = errors.join('\n')
    this.onStatus({ errors })
  }

  time() {
    return (this.snapshot?.time || 0) + (this.realtime && !this.host.ownerDocument.hidden ? Math.min(0.25, Math.max(0, (this.now() - this.observedAt) / 1000)) : 0)
  }

  sync(snapshot) {
    if (this.disposed) return
    const key = `${snapshot?.audio?.sessionId || 'editor'}:${snapshot?.viewPlayerIndex || 1}`
    if (key !== this.key) { this.reset(); this.key = key }
    this.snapshot = snapshot
    this.observedAt = this.now()
    this.realtime = snapshot?.running !== false && !snapshot?.paused && snapshot?.clockMode !== 'manual'
    const rows = snapshot?.running === false ? [] : snapshot?.effects || []
    const wanted = new Set(rows.map(row => String(row.id)))
    for (const id of this.entries.keys()) if (!wanted.has(id)) this.remove(id)
    for (const id of this.errors.keys()) if (!wanted.has(id)) this.report(id, '')
    let pixels = 0, count = 0
    for (const row of rows) {
      const id = String(row.id)
      const asset = uiVfxAsset(row.animationId, row.kind)
      const old = this.entries.get(id)
      if (old && (old.row.generation !== row.generation || old.asset !== asset)) this.remove(id)
      if (!asset) { this.report(id, `Unknown UI effect: ${row.animationId ?? ''}`); continue }
      if (uiVfxTime(asset, this.time() - row.startedAt) === null) { this.remove(id); this.report(id, ''); continue }
      const cost = asset.width * asset.height * 2
      if (pixels + cost > 24 * 1024 * 1024 || count >= 12) {
        this.remove(id); this.report(id, `UI effect ${asset.id}: preview budget exceeded`); continue
      }
      pixels += cost; count++
      let entry = this.entries.get(id)
      if (!entry) {
        try { this.report(id, ''); entry = this.create(id, row, asset) }
        catch (error) { this.report(id, `UI effect ${asset.id}: ${error.message}`); continue }
      }
      entry.row = row
      try { this.position(entry); this.advance(entry) }
      catch (error) { this.fail(entry, error) }
    }
    const used = new Set([...this.entries.values()].flatMap(entry => entry.row.masks || [])
      .filter(mask => mask.primitive === 'sprite').map(mask => imageAssetKey(mask.imageId, mask.imageSource)))
    for (const key of this.maskAssets.keys()) if (!used.has(key)) this.maskAssets.delete(key)
    this.schedule()
  }

  create(id, row, asset) {
    const doc = this.host.ownerDocument
    if (!globalThis.CSS?.supports('mix-blend-mode', 'plus-lighter')) throw new Error('C/T blending is unavailable')
    const video = doc.createElement('video')
    video.muted = true; video.playsInline = true; video.preload = 'auto'
    const scale = Math.min(1, 1536 / Math.max(asset.width, asset.height), Math.sqrt(1024 * 1024 / (asset.width * asset.height)))
    const planes = ['multiply', 'plus-lighter'].map(mode => {
      const canvas = doc.createElement('canvas')
      canvas.width = Math.max(1, Math.round(asset.width * scale))
      canvas.height = Math.max(1, Math.round(asset.height * scale))
      canvas.dataset.uiVfx = `${id}:${mode}`
      Object.assign(canvas.style, { position: 'absolute', pointerEvents: 'none', transformOrigin: 'center', mixBlendMode: mode, display: 'none' })
      return canvas
    })
    const entry = { id, row, asset, video, planes, failed: false, ready: false, playing: false, maskKey: '', mask: null }
    entry.fail = () => this.fail(entry, new Error(`media load/decode failed (${video.error?.code || 'unknown'})`))
    entry.loaded = () => {
      if (this.disposed || entry.failed || this.entries.get(id) !== entry) return
      try {
        if (video.videoWidth !== asset.width * 2 || video.videoHeight !== asset.height) throw new Error('Unexpected packed C/T dimensions')
        entry.ready = true
        clearTimeout(entry.timer)
        this.advance(entry)
      } catch (error) { this.fail(entry, error) }
    }
    entry.seeked = () => { if (!entry.failed && this.entries.get(id) === entry) { try { this.draw(entry) } catch (error) { this.fail(entry, error) } } }
    video.addEventListener('error', entry.fail)
    video.addEventListener('loadeddata', entry.loaded)
    video.addEventListener('seeked', entry.seeked)
    entry.timer = setTimeout(() => this.fail(entry, new Error('media loading timed out')), this.timeout)
    this.entries.set(id, entry)
    this.host.append(...planes)
    try { video.src = uiVfxUrl(asset.video) + (row.generation > 1 ? '?retry=1' : ''); video.load() }
    catch (error) { this.fail(entry, error) }
    return entry
  }

  position(entry, reorder = true) {
    const { asset, row, planes } = entry
    const cw = this.snapshot.canvasWidth, ch = this.snapshot.canvasHeight
    let m = row.matrix
    if (row.kind === 'fullscreen') {
      const scale = Math.max(cw / asset.width, ch / asset.height)
      m = { a: scale, b: 0, c: 0, d: scale, tx: cw / 2, ty: ch / 2 }
    }
    if (!m || ![cw, ch, m.a, m.b, m.c, m.d, m.tx, m.ty].every(Number.isFinite) || cw <= 0 || ch <= 0) throw new Error('Invalid effect geometry')
    for (const plane of planes) Object.assign(plane.style, {
      left: `${(m.tx - asset.width / 2) / cw * 100}%`, top: `${(ch - m.ty - asset.height / 2) / ch * 100}%`,
      width: `${asset.width / cw * 100}%`, height: `${asset.height / ch * 100}%`,
      transform: `matrix(${m.a},${-m.b},${-m.c},${m.d},0,0)`,
      zIndex: row.kind === 'fullscreen' || row.layer === 'BelowAllControls' ? '-1' : '1',
    })
    // Only snapshot painter order may reorder planes. Async mask completion
    // repaints in place, even when Map insertion order differs from the scene.
    if (reorder) this.host.append(...planes)
    const maskKey = JSON.stringify([row.masks, m])
    if (maskKey === entry.maskKey) return
    entry.maskKey = maskKey
    entry.mask = null
    if (!row.masks?.length) return
    const mask = this.host.ownerDocument.createElement('canvas')
    mask.width = planes[0].width; mask.height = planes[0].height
    const ctx = mask.getContext('2d'), image = ctx.createImageData(mask.width, mask.height)
    const createCanvas = (w, h) => {
      const canvas = this.host.ownerDocument.createElement('canvas')
      canvas.width = w; canvas.height = h
      return canvas
    }
    const masks = row.masks.map(spec => ({ spec, inverse: invertMatrix(spec.matrix),
      sample: createMaskSampler(spec, createCanvas, this.maskAsset(spec)) }))
    for (let y = 0; y < mask.height; y++) for (let x = 0; x < mask.width; x++) {
      const world = applyMatrix(m, (x + 0.5) * asset.width / mask.width - asset.width / 2, asset.height / 2 - (y + 0.5) * asset.height / mask.height)
      let coverage = 1
      for (const { spec, inverse, sample } of masks) {
        if (!inverse) { coverage *= spec.reverseMaskArea ? 1 : 0; continue }
        const local = applyMatrix(inverse, world.x, world.y)
        coverage *= sample(local.x, local.y)
      }
      image.data[(y * mask.width + x) * 4 + 3] = Math.round(255 * coverage)
    }
    ctx.putImageData(image, 0, 0)
    entry.mask = mask
  }

  advance(entry) {
    if (entry.failed || !entry.ready) return
    const target = uiVfxTime(entry.asset, this.time() - entry.row.startedAt)
    if (target === null) { entry.video.pause(); for (const plane of entry.planes) plane.style.display = 'none'; return }
    const video = entry.video
    const play = this.realtime && !this.host.ownerDocument.hidden
    if (!play) { video.pause(); entry.playing = false }
    if (!video.seeking && Math.abs(video.currentTime - target) > (play ? 0.18 : 1 / 60)) video.currentTime = target
    if (play && video.paused && !entry.playing) {
      entry.playing = true
      Promise.resolve(video.play()).then(() => { entry.playing = false }, error => {
        entry.playing = false
        // pause()/load() intentionally cancel a pending play promise.
        if (error.name !== 'AbortError') this.fail(entry, error)
      })
    }
    if (!video.seeking) this.draw(entry)
  }

  draw(entry) {
    if (!entry.ready || entry.failed || entry.video.readyState < 2) return
    const target = uiVfxTime(entry.asset, this.time() - entry.row.startedAt)
    if (target === null) return
    for (let i = 0; i < 2; i++) {
      const plane = entry.planes[i], ctx = plane.getContext('2d')
      ctx.globalCompositeOperation = 'source-over'
      ctx.clearRect(0, 0, plane.width, plane.height)
      ctx.drawImage(entry.video, i === 0 ? entry.asset.width : 0, 0, entry.asset.width, entry.asset.height, 0, 0, plane.width, plane.height)
      if (entry.mask) { ctx.globalCompositeOperation = 'destination-in'; ctx.drawImage(entry.mask, 0, 0); ctx.globalCompositeOperation = 'source-over' }
      plane.style.display = ''
    }
  }

  fail(entry, error) {
    if (this.disposed || entry.failed || this.entries.get(entry.id) !== entry) return
    entry.failed = true
    this.releaseMedia(entry)
    for (const plane of entry.planes) plane.style.display = 'none'
    this.report(entry.id, `UI effect ${entry.asset.id}: ${error.message}`)
  }

  schedule() {
    if (this.raf !== null || this.disposed || !this.entries.size) return
    this.raf = requestAnimationFrame(() => {
      this.raf = null
      if (this.now() - this.lastFrame >= 1000 / 30) {
        this.lastFrame = this.now()
        for (const entry of this.entries.values()) { try { this.advance(entry) } catch (error) { this.fail(entry, error) } }
      }
      if (this.realtime && [...this.entries.values()].some(entry => !entry.failed && uiVfxTime(entry.asset, this.time() - entry.row.startedAt) !== null)) this.schedule()
    })
  }

  releaseMedia(entry) {
    clearTimeout(entry.timer)
    const video = entry.video
    video.removeEventListener('error', entry.fail); video.removeEventListener('loadeddata', entry.loaded); video.removeEventListener('seeked', entry.seeked)
    video.pause(); video.removeAttribute('src'); video.load()
  }

  remove(id) {
    const entry = this.entries.get(id)
    if (!entry) return
    this.entries.delete(id)
    this.releaseMedia(entry)
    for (const plane of entry.planes) { plane.remove(); plane.width = plane.height = 1 }
    entry.mask = null
    this.report(id, '')
  }

  reset() {
    if (this.raf !== null) cancelAnimationFrame(this.raf)
    this.raf = null
    for (const id of this.entries.keys()) this.remove(id)
    this.errors.clear(); this.report('', '')
    this.snapshot = null
    this.maskAssets.clear()
  }
  destroy() { this.disposed = true; this.unsubscribeImages(); this.reset(); this.badge.remove() }
}
