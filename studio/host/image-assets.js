import { DiskAssetStore, defaultAssetCacheDir } from './asset-cache.js'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { IMAGE_ASSET_PREFIX, IMAGE_CACHE_VERSION, IMAGE_SOURCE, isRemoteImage } from '../assets/catalog.js'
import { restoreSprite } from '../assets/raster.js'

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
  constructor({ cacheDir = defaultImageCacheDir(), fetch: fetcher = globalThis.fetch, source = IMAGE_SOURCE } = {}) {
    super({ cacheDir, fetch: fetcher, source, version: IMAGE_CACHE_VERSION, extension: 'png', accepts: isRemoteImage })
  }

  async decode(data) {
    validatePng(data)
    return { image: await loadImage(data) }
  }

  async produce(id, signal, refresh) {
    const [png, metadata] = await Promise.all([
      this.download(`sprite/${id}.png`, MAX_BYTES, signal, refresh),
      this.download(`border/${id}.json`, 128 * 1024, signal, refresh),
    ])
    validatePng(png)
    const original = await loadImage(png)
    const image = restoreSprite(original, JSON.parse(metadata.toString('utf8')), createCanvas)
    return Buffer.from(image.toBuffer('image/png'))
  }

  async prepare(items, signal) {
    const images = new Map(), warnings = []
    const ids = [...new Set((items || []).filter(item => item.kind === 'image' && item.visible !== false && isRemoteImage(item.imageId)).map(item => item.imageId))]
    signal?.throwIfAborted()
    const deadline = AbortSignal.timeout(45_000)
    const combined = signal ? AbortSignal.any([signal, deadline]) : deadline
    let cursor = 0
    // Bound both screenshot latency and outstanding downloads. Already shared
    // downloads finish into cache; cancellation does not abort other consumers.
    await Promise.all(Array.from({ length: Math.min(4, ids.length) }, async () => {
      while (cursor < ids.length && !combined.aborted) {
        const id = ids[cursor++]
        try { images.set(id, (await waitForAsset(this.get(id), combined)).image) }
        catch (error) { warnings.push({ imageId: id, error: error.message }) }
      }
    }))
    for (const id of ids.slice(cursor)) warnings.push({ imageId: id, error: 'Image preparation timed out' })
    signal?.throwIfAborted()
    return { images, warnings }
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
    const match = url.pathname.match(new RegExp(`^${IMAGE_ASSET_PREFIX}${IMAGE_CACHE_VERSION}/([0-9]+)\\.png$`))
    if (!match) throw Object.assign(new Error('Unknown image resource'), { status: 404 })
    const image = await store.get(Number(match[1]))
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
