import { createHash } from 'node:crypto'
import { basename } from 'node:path'
import { DiskAssetStore, defaultAssetCacheDir } from './asset-cache.js'
import { UI_VFX_SOURCE, UI_VFX_VERSION, UI_VFX_PREFIX, uiVfxMedia } from '../assets/ui-vfx-catalog.js'

const types = { webm: 'video/webm', png: 'image/png', mp3: 'audio/mpeg' }
class MediaStore extends DiskAssetStore {
  constructor(kind, options, media) {
    const extension = { video: 'webm', icon: 'png', audio: 'mp3' }[kind]
    super({ ...options, version: `${UI_VFX_VERSION}/${kind}`, extension,
      accepts: id => /^[0-9]+(?:_[0-9]+)?$/.test(String(id)) && !!media(`${kind}/${id}.${extension}`) })
    this.kind = kind
    this.media = media
  }
  // Both disk hits and remote bytes are checked against the pinned inventory.
  async cached(path) {
    const value = await super.cached(path)
    if (!value) return null
    try { this.validate(basename(path, `.${this.extension}`), value.data); return value }
    catch { return null }
  }
  validate(id, bytes) {
    const meta = this.media(`${this.kind}/${id}.${this.extension}`)
    if (bytes.length !== meta.bytes || createHash('sha256').update(bytes).digest('hex') !== meta.sha256) throw new Error('UI effect media failed integrity check')
  }
  decode() { return {} }
  async produce(id, signal, refresh) {
    const data = await this.download(`${this.kind}/${id}.${this.extension}`, 8 * 1024 * 1024, signal, refresh)
    this.validate(id, data)
    return data
  }
}

export class UIVfxAssetStore {
  constructor({ cacheDir = process.env.QXQY_UI_VFX_CACHE_DIR || defaultAssetCacheDir('ui-vfx'),
    source = process.env.QXQY_UI_VFX_SOURCE || UI_VFX_SOURCE, fetch: fetcher = globalThis.fetch, timeout = 12_000, media = uiVfxMedia } = {}) {
    this.stores = Object.fromEntries(['video', 'icon', 'audio'].map(kind => [kind, new MediaStore(kind, { cacheDir, source, fetch: fetcher, timeout }, media)]))
  }
  get(path, { retry = false } = {}) {
    const match = /^(video|icon|audio)\/([0-9]+(?:_[0-9]+)?)\.(webm|png|mp3)$/.exec(path)
    if (!match || !uiVfxMedia(path)) return Promise.reject(Object.assign(new Error('Unknown UI effect resource'), { status: 404 }))
    const store = this.stores[match[1]]
    // An explicit replay can bypass a previous failure, while retaining a
    // validated offline copy and coalescing any download already in flight.
    if (retry) store.failures.delete(match[2])
    return store.get(match[2])
  }
}
let shared
export function sharedUIVfxAssets() { return shared ||= new UIVfxAssetStore() }

export async function serveUIVfxAsset(request, response, store = sharedUIVfxAssets()) {
  const url = new URL(request.url, 'http://localhost')
  if (url.pathname !== UI_VFX_PREFIX.slice(0, -1) && !url.pathname.startsWith(UI_VFX_PREFIX)) return false
  try {
    if (!['GET', 'HEAD'].includes(request.method)) throw Object.assign(new Error('GET or HEAD required'), { status: 405 })
    const prefix = `${UI_VFX_PREFIX}${UI_VFX_VERSION}/`
    const path = url.pathname.startsWith(prefix) ? url.pathname.slice(prefix.length) : ''
    if (!uiVfxMedia(path)) throw Object.assign(new Error('Unknown UI effect resource'), { status: 404 })
    const asset = await store.get(path, { retry: url.searchParams.get('retry') === '1' }), size = asset.data.length
    if (response.destroyed) return true
    const headers = { 'content-type': types[path.split('.').at(-1)], 'cache-control': 'private, max-age=43200',
      etag: asset.etag, 'accept-ranges': 'bytes', 'x-content-type-options': 'nosniff' }
    if (request.headers['if-none-match'] === asset.etag) { response.writeHead(304, headers); response.end(); return true }
    let start = 0, end = size - 1, status = 200
    if (request.headers.range && (!request.headers['if-range'] || request.headers['if-range'] === asset.etag)) {
      const parts = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range)
      if (!parts || (!parts[1] && !parts[2])) throw Object.assign(new Error('Invalid byte range'), { status: 416, size })
      if (!parts[1]) start = Math.max(0, size - Number(parts[2]))
      else { start = Number(parts[1]); end = parts[2] ? Math.min(size - 1, Number(parts[2])) : end }
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || end < start) throw Object.assign(new Error('Unsatisfiable byte range'), { status: 416, size })
      headers['content-range'] = `bytes ${start}-${end}/${size}`
      status = 206
    }
    response.writeHead(status, { ...headers, 'content-length': end - start + 1 })
    response.end(request.method === 'HEAD' ? undefined : asset.data.subarray(start, end + 1))
  } catch (error) {
    if (!response.destroyed && !response.headersSent) {
      response.writeHead([404, 405, 416].includes(error.status) ? error.status : 502, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store',
        ...(error.status === 416 ? { 'content-range': `bytes */${error.size}` } : {}) })
      response.end(request.method === 'HEAD' ? undefined : 'UI effect resource unavailable')
    }
  }
  return true
}
