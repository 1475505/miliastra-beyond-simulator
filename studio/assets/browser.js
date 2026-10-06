import { imageAssetUrl, isRemoteImage } from './catalog.js'

const STORAGE_KEY = 'qxqy-image-refresh'
const entries = new Map()
const revisions = new Map()
const listeners = new Set()
const MAX_PIXELS = 16_777_216
let initialized = false

function notify(id, revision) {
  revisions.set(id, revision)
  entries.delete(id)
  for (const listener of listeners) listener(id)
}

function initialize() {
  if (initialized || typeof window === 'undefined') return
  initialized = true
  try {
    for (const [id, revision] of Object.entries(JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'))) revisions.set(Number(id), revision)
  } catch { /* Storage may be disabled by the carrier. */ }
  window.addEventListener('storage', event => {
    if (event.key !== STORAGE_KEY) return
    try {
      for (const [id, rev] of Object.entries(JSON.parse(event.newValue || '{}'))) {
        if (revisions.get(Number(id)) !== rev) notify(Number(id), rev)
      }
    } catch { /* Ignore unrelated/malformed stored data. */ }
  })
}

export function subscribeImageRefresh(listener) {
  initialize()
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function refreshBrowserImage(id) {
  initialize()
  notify(id, Date.now())
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(revisions))) } catch {}
}

export function loadBrowserImage(id) {
  initialize()
  if (!isRemoteImage(id)) return Promise.reject(new Error('Image ID is not in the preview allowlist'))
  const cached = entries.get(id)
  if (cached && (!cached.failed || Date.now() < cached.retryAt)) {
    entries.delete(id); entries.set(id, cached)
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
        if (key === id) continue
        if (!row.pixels && !row.failed) continue
        entries.delete(key); pixels -= row.pixels
      }
      resolve(image)
    }
    image.onload = () => finish()
    image.onerror = () => finish(new Error(`图片 ${id} 加载失败，可在属性面板刷新素材`))
    image.src = imageAssetUrl(id, revisions.get(id))
  })
  entries.set(id, entry)
  return entry.promise
}
