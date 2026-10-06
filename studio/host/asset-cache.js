import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const hash = data => createHash('sha256').update(data).digest('hex')

export function defaultAssetCacheDir(kind) {
  return join(process.platform === 'win32' ? (process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'))
    : process.platform === 'darwin' ? join(homedir(), 'Library', 'Caches')
      : (process.env.XDG_CACHE_HOME || join(homedir(), '.cache')), 'beyond-simulator', kind)
}

// Shared by images and audio. Derived stores own validation/conversion, while
// persistence, cold-load locks, request coalescing and failure cooldown stay here.
export class DiskAssetStore {
  constructor({ cacheDir, source, version, extension, accepts, fetch: fetcher = globalThis.fetch, timeout = 12_000 }) {
    this.directory = join(resolve(cacheDir), version, hash(source).slice(0, 12))
    Object.assign(this, { source, extension, accepts, fetcher, timeout })
    this.pending = new Map()
    this.failures = new Map()
    this.active = 0
    this.waiters = []
  }

  async limited(task) {
    if (this.active >= 4) await new Promise(resolve => this.waiters.push(resolve))
    else this.active++
    try { return await task() } finally {
      const next = this.waiters.shift()
      if (next) next()
      else this.active--
    }
  }

  async download(path, limit, signal, refresh) {
    const response = await this.fetcher(new URL(path, this.source), { signal, redirect: 'error', cache: refresh ? 'no-cache' : 'default' })
    if (!response.ok) throw new Error(`Asset source returned HTTP ${response.status}`)
    if (Number(response.headers.get('content-length')) > limit) throw new Error('Asset response too large')
    const chunks = []
    let size = 0
    for await (const chunk of response.body) {
      size += chunk.length
      if (size > limit) throw new Error('Asset response too large')
      chunks.push(chunk)
    }
    return Buffer.concat(chunks)
  }

  async cached(path) {
    try {
      const data = await readFile(path)
      return { data, ...await this.decode(data), etag: `"${hash(data)}"` }
    } catch (error) {
      if (error.code === 'ENOENT') return null
      if (error.code === 'EACCES' || error.code === 'EPERM') throw error
      return null
    }
  }

  async load(id, refresh = false) {
    const path = join(this.directory, `${id}.${this.extension}`)
    const hit = !refresh && await this.cached(path)
    if (hit) return hit
    await mkdir(this.directory, { recursive: true })
    const lockPath = `${path}.lock`
    const deadline = Date.now() + 30_000
    let lock
    while (!lock) {
      try { lock = await open(lockPath, 'wx') } catch (error) {
        if (error.code !== 'EEXIST') throw error
        const ready = !refresh && await this.cached(path)
        if (ready) return ready
        try { if (Date.now() - (await stat(lockPath)).mtimeMs > 60_000) await rm(lockPath, { force: true }) }
        catch (error) { if (error.code !== 'ENOENT') throw error }
        if (Date.now() > deadline) throw new Error('Timed out waiting for asset cache writer')
        await delay(80)
      }
    }
    const temp = `${path}.${randomUUID()}.tmp`
    try {
      const ready = !refresh && await this.cached(path)
      if (ready) return ready
      const abort = new AbortController()
      const timer = setTimeout(() => abort.abort(), this.timeout)
      let data
      try { data = await this.produce(id, abort.signal, refresh) }
      finally { clearTimeout(timer); abort.abort() }
      const decoded = await this.decode(data)
      await writeFile(temp, data, { flag: 'wx' })
      await rename(temp, path)
      return { data, ...decoded, etag: `"${hash(data)}"` }
    } finally {
      try { await rm(temp, { force: true }) }
      finally { await lock.close(); await rm(lockPath, { force: true }) }
    }
  }

  get(id, { refresh = false } = {}) {
    if (!this.accepts(id)) return Promise.reject(Object.assign(new Error('Asset ID is not in the preview allowlist'), { status: 404 }))
    if (this.pending.has(id)) return this.pending.get(id)
    const failure = this.failures.get(id)
    if (!refresh && failure && failure.until > Date.now()) return Promise.reject(failure.error)
    const promise = this.limited(() => this.load(id, refresh)).then(value => {
      this.failures.delete(id)
      return value
    }, error => {
      if (!refresh) this.failures.set(id, { until: Date.now() + 60_000, error })
      throw error
    }).finally(() => this.pending.delete(id))
    this.pending.set(id, promise)
    return promise
  }

  async refresh(id) {
    if (!this.accepts(id)) throw Object.assign(new Error('Asset ID is not in the preview allowlist'), { status: 404 })
    await this.pending.get(id)?.catch(() => {})
    this.failures.delete(id)
    // Failed refresh preserves the previous offline copy.
    return this.get(id, { refresh: true })
  }
}
