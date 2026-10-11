import { DiskAssetStore, defaultAssetCacheDir } from './asset-cache.js'
import { createHash } from 'node:crypto'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { IMAGE_ASSET_PREFIX, IMAGE_CACHE_VERSION, IMAGE_SOURCE, isRemoteImage, imageAssetKey, imageSourceName } from '../assets/catalog.js'
import { PREFAB_SOURCE, PREFAB_CACHE_VERSION, prefabImageSize } from '../assets/prefab-catalog.js'
import { restoreSprite } from '../assets/raster.js'
import { ImageMetadataStore } from './image-metadata.js'

const MAX_BYTES = 20 * 1024 * 1024
const signature = Buffer.from('89504e470d0a1a0a', 'hex')

function waitForAsset(promise, signal) {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason)
    signal.addEventListener('abort', abort, { once: true })
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}

export function defaultImageCacheDir() {
  return process.env.QXQY_IMAGE_CACHE_DIR || defaultAssetCacheDir('images')
}

function validatePng(data) {
  if (data.length < 24 || data.length > MAX_BYTES || !data.subarray(0, 8).equals(signature)) throw new Error('Invalid sprite PNG')
  const w = data.readUInt32BE(16), h = data.readUInt32BE(20)
  if (!w || !h || w > 8192 || h > 8192 || w * h > 16_777_216) throw new Error('Sprite PNG exceeds pixel limit')
}

export class ImageAssetStore extends DiskAssetStore {
  constructor({ cacheDir = defaultImageCacheDir(), fetch: fetcher = globalThis.fetch, source,
    imageSource = 'StaticReference' } = {}) {
    const name = imageSourceName(imageSource)
    if (!['StaticReference', 'Prefab'].includes(name)) throw new Error(`Unsupported image source: ${name}`)
    super({ cacheDir, fetch: fetcher, source: source || (name === 'Prefab' ? PREFAB_SOURCE : IMAGE_SOURCE),
      version: name === 'Prefab' ? PREFAB_CACHE_VERSION : IMAGE_CACHE_VERSION, extension: 'png', accepts: id => isRemoteImage(id, name) })
    this.imageSource = name
    this.cacheDir = cacheDir
    this.prefabStore = null
    this.metadataStore = null
  }

  forSource(source) {
    const name = imageSourceName(source)
    if (name === this.imageSource) return this
    if (name === 'Prefab' && this.imageSource === 'StaticReference') {
      return this.prefabStore ||= new ImageAssetStore({ cacheDir: this.cacheDir, imageSource: 'Prefab', fetch: (...args) => this.fetcher(...args) })
    }
    throw Object.assign(new Error(`Unsupported image source: ${name}`), { status: 404 })
  }

  get(id, { imageSource = this.imageSource, ...options } = {}) {
    try {
      const store = this.forSource(imageSource)
      return store === this ? super.get(id, options) : store.get(id, options)
    } catch (error) { return Promise.reject(error) }
  }

  refresh(id, { imageSource = this.imageSource } = {}) {
    try {
      const store = this.forSource(imageSource)
      return store === this ? super.refresh(id) : store.refresh(id)
    } catch (error) { return Promise.reject(error) }
  }

  async decode(data) {
    validatePng(data)
    return { image: await loadImage(data) }
  }

  metadata(id, { imageSource = this.imageSource, refresh = false } = {}) {
    try {
      const store = this.forSource(imageSource)
      if (store !== this) return store.metadata(id, { refresh })
      if (!this.accepts(id)) throw Object.assign(new Error('Image ID is not in the preview allowlist'), { status: 404 })
      if (this.imageSource === 'Prefab') return Promise.resolve({ meta: null, raw: null })
      this.metadataStore ||= new ImageMetadataStore({ cacheDir: this.cacheDir, source: this.source, fetch: (...args) => this.fetcher(...args) })
      return refresh ? this.metadataStore.refresh(id) : this.metadataStore.get(id)
    } catch (error) { return Promise.reject(error) }
  }

  async produce(id, signal, refresh) {
    if (this.imageSource === 'Prefab') {
      const png = await this.download(`sprite/${id}.png`, MAX_BYTES, signal, refresh)
      validatePng(png)
      const size = prefabImageSize(id)
      if (png.readUInt32BE(16) !== size || png.readUInt32BE(20) !== size) throw new Error('Prefab PNG does not match catalog dimensions')
      return png
    }
    const [png, metadata] = await Promise.all([
      this.download(`sprite/${id}.png`, MAX_BYTES, signal, refresh),
      this.metadata(id, { refresh }),
    ])
    validatePng(png)
    const original = await loadImage(png)
    const image = metadata.raw ? restoreSprite(original, metadata.raw, createCanvas) : original
    if (!metadata.raw) return png
    return Buffer.from(image.toBuffer('image/png'))
  }

  async prepare(items, signal) {
    const images = new Map(), imageMetadata = new Map(), warnings = []
    const assets = [...new Map((items || []).filter(item => item.kind === 'image' && item.visible !== false && isRemoteImage(item.imageId, item.imageSource))
      .map(item => [imageAssetKey(item.imageId, item.imageSource), { imageId: item.imageId, imageSource: imageSourceName(item.imageSource) }])).entries()]
    signal?.throwIfAborted()
    const deadline = AbortSignal.timeout(45_000)
    const combined = signal ? AbortSignal.any([signal, deadline]) : deadline
    let cursor = 0
    // Bound both screenshot latency and outstanding downloads. Already shared
    // downloads finish into cache; cancellation does not abort other consumers.
    await Promise.all(Array.from({ length: Math.min(4, assets.length) }, async () => {
      while (cursor < assets.length && !combined.aborted) {
        const [key, asset] = assets[cursor++]
        try {
          const image = await waitForAsset(this.get(asset.imageId, asset), combined)
          images.set(key, image.image)
          const metadata = await waitForAsset(this.metadata(asset.imageId, asset), combined)
          imageMetadata.set(key, metadata.meta)
        }
        catch (error) { warnings.push({ ...asset, error: error.message }) }
      }
    }))
    for (const [, asset] of assets.slice(cursor)) warnings.push({ ...asset, error: 'Image preparation timed out' })
    signal?.throwIfAborted()
    return { images, imageMetadata, warnings }
  }
}

let shared
export function sharedImageAssets() { return shared ||= new ImageAssetStore() }

// Both carriers register the same route; no arbitrary URL or filesystem input.
export async function serveImageAsset(request, response, store = sharedImageAssets()) {
  const url = new URL(request.url, 'http://localhost')
  if (url.pathname !== IMAGE_ASSET_PREFIX.slice(0, -1) && !url.pathname.startsWith(IMAGE_ASSET_PREFIX)) return false
  try {
    if (!['GET', 'HEAD'].includes(request.method)) throw Object.assign(new Error('GET or HEAD required'), { status: 405 })
    const match = url.pathname.match(new RegExp(`^${IMAGE_ASSET_PREFIX}(${IMAGE_CACHE_VERSION}|${PREFAB_CACHE_VERSION})/([0-9]+)\\.(png|json)$`))
    if (!match) throw Object.assign(new Error('Unknown image resource'), { status: 404 })
    const asset = { imageSource: match[1] === PREFAB_CACHE_VERSION ? 'Prefab' : 'StaticReference' }
    if (match[3] === 'json') {
      const { meta } = await store.metadata(Number(match[2]), asset)
      const body = JSON.stringify(meta), etag = `"${createHash('sha256').update(body).digest('hex')}"`
      const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, max-age=43200', etag, 'x-content-type-options': 'nosniff' }
      if (request.headers['if-none-match'] === etag) { response.writeHead(304, headers); response.end() }
      else { response.writeHead(200, headers); response.end(request.method === 'HEAD' ? undefined : body) }
      return true
    }
    const image = await store.get(Number(match[2]), asset)
    const headers = { 'content-type': 'image/png', 'cache-control': 'private, max-age=43200',
      etag: image.etag, 'x-content-type-options': 'nosniff' }
    if (request.headers['if-none-match'] === image.etag) { response.writeHead(304, headers); response.end() }
    else { response.writeHead(200, { ...headers, 'content-length': image.data.length }); response.end(request.method === 'HEAD' ? undefined : image.data) }
  } catch (error) {
    response.writeHead(error.status || 502, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
    response.end(request.method === 'HEAD' ? undefined : error.message)
  }
  return true
}
