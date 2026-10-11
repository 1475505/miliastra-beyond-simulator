import { imageAssetUrl, imageMetadataUrl, imageAssetKey, imageSourceName, isRemoteImage } from './catalog.js'

const STORAGE_KEY = 'qxqy-image-refresh'
const entries = new Map()
const metadataEntries = new Map()
const revisions = new Map()
const listeners = new Set()
const MAX_PIXELS = 16_777_216
let initialized = false

function notify(key, revision) {
  revisions.set(key, revision)
  entries.delete(key)
  metadataEntries.delete(key)
  for (const listener of listeners) listener(key)
}

const storedKey = key => /^\d+$/.test(key) ? imageAssetKey(Number(key)) : key

function initialize() {
  if (initialized || typeof window === 'undefined') return
  initialized = true
  try {
    for (const [key, revision] of Object.entries(JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'))) revisions.set(storedKey(key), revision)
  } catch { /* Storage may be disabled by the carrier. */ }
  window.addEventListener('storage', event => {
    if (event.key !== STORAGE_KEY) return
    try {
      for (const [rawKey, rev] of Object.entries(JSON.parse(event.newValue || '{}'))) {
        const key = storedKey(rawKey)
        if (revisions.get(key) !== rev) notify(key, rev)
      }
    } catch { /* Ignore unrelated/malformed stored data. */ }
  })
}

export function subscribeImageRefresh(listener) {
  initialize()
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function refreshBrowserImage(id, source) {
  initialize()
  notify(imageAssetKey(id, source), Date.now())
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(revisions))) } catch {}
}

export function loadBrowserImageMetadata(id, source) {
  initialize()
  if (imageSourceName(source) !== 'StaticReference' || !isRemoteImage(id, source)) return Promise.resolve(null)
  const key = imageAssetKey(id, source)
  const entry = metadataEntries.get(key)
  if (entry) return entry
  const promise = fetch(imageMetadataUrl(id, revisions.get(key), source), { signal: AbortSignal.timeout(30_000) }).then(async response => {
    if (!response.ok) throw new Error(`图片 ${id} 元数据加载失败：HTTP ${response.status}`)
    return response.json()
  }).catch(error => { if (metadataEntries.get(key) === promise) metadataEntries.delete(key); throw error })
  metadataEntries.set(key, promise)
  return promise
}

export async function loadBrowserImageAsset(id, source) {
  const [image, metadata] = await Promise.all([loadBrowserImage(id, source),
    loadBrowserImageMetadata(id, source).then(meta => ({ meta, error: '' }), error => ({ meta: undefined, error: error.message }))])
  // Old offline caches contain PNG only. Keep the image visible in Basic mode
  // while explicitly reporting unresolved metadata, not "zero-border" support.
  return { image, ...metadata }
}

export function loadBrowserImage(id, source) {
  initialize()
  if (!isRemoteImage(id, source)) return Promise.reject(new Error('Image source/ID is not in the preview allowlist'))
  const assetKey = imageAssetKey(id, source)
  const cached = entries.get(assetKey)
  if (cached && (!cached.failed || Date.now() < cached.retryAt)) {
    entries.delete(assetKey); entries.set(assetKey, cached)
    return cached.promise
  }
  const entry = { pixels: 0, failed: false }
  entry.promise = new Promise((resolve, reject) => {
    const image = new Image()
    const timer = setTimeout(() => { image.src = ''; finish(new Error('图片加载超时')) }, 45_000)
    function finish(error) {
      clearTimeout(timer)
      image.onload = image.onerror = null
      if (error) { entry.failed = true; entry.retryAt = Date.now() + 60_000; reject(error); return }
      entry.pixels = image.width * image.height
      // This LRU only retains decoded DOM images. Active controls/textures hold
      // their own references; the browser owns durable HTTP caching.
      let pixels = [...entries.values()].reduce((n, row) => n + row.pixels, 0)
      for (const [key, row] of entries) {
        if (pixels <= MAX_PIXELS && entries.size <= 128) break
        if (key === assetKey) continue
        if (!row.pixels && !row.failed) continue
        entries.delete(key); pixels -= row.pixels
      }
      resolve(image)
    }
    image.onload = () => finish()
    image.onerror = () => finish(new Error(`图片 ${id} 加载失败，可在属性面板刷新素材`))
    image.src = imageAssetUrl(id, revisions.get(assetKey), source)
  })
  entries.set(assetKey, entry)
  return entry.promise
}
