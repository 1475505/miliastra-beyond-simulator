import { DiskAssetStore, defaultAssetCacheDir } from './asset-cache.js'
import { AUDIO_SOURCE, AUDIO_CACHE_VERSION, AUDIO_ASSET_PREFIX, audioDuration } from '../assets/audio-catalog.js'

const MAX_BYTES = 32 * 1024 * 1024

// Validate MPEG Layer III framing, including ID3v2 and an optional ID3v1 tail.
// Browser decodeAudioData remains the decoder; HTML/error pages never enter cache.
export function validateMp3(data) {
  if (data.length < 8 || data.length > MAX_BYTES) throw new Error('Invalid MP3 size')
  let offset = 0, frames = 0
  if (data.subarray(0, 3).toString() === 'ID3') {
    if (data.length < 10 || data[3] < 2 || data[3] > 4 || data.subarray(6, 10).some(v => v > 127)) throw new Error('Invalid MP3 ID3 header')
    offset = 10 + ((data[6] << 21) | (data[7] << 14) | (data[8] << 7) | data[9]) + ((data[5] & 16) && data[3] === 4 ? 10 : 0)
  }
  while (offset + 4 <= data.length) {
    if (data.length - offset === 128 && data.subarray(offset, offset + 3).toString() === 'TAG') { offset = data.length; break }
    const b1 = data[offset + 1], b2 = data[offset + 2]
    const version = (b1 >> 3) & 3, rate = (b2 >> 2) & 3, bitrate = b2 >> 4
    if (data[offset] !== 255 || (b1 & 224) !== 224 || (b1 & 6) !== 2 || version === 1 || rate === 3 || bitrate === 0 || bitrate === 15) throw new Error('Invalid MP3 frame')
    const kbps = (version === 3 ? [0,32,40,48,56,64,80,96,112,128,160,192,224,256,320] : [0,8,16,24,32,40,48,56,64,80,96,112,128,144,160])[bitrate]
    const hz = [44100,48000,32000][rate] / (version === 3 ? 1 : version === 2 ? 2 : 4)
    const length = Math.floor((version === 3 ? 144000 : 72000) * kbps / hz) + ((b2 >> 1) & 1)
    offset += length
    frames++
  }
  if (frames < 2 || offset !== data.length) throw new Error('Truncated or invalid MP3')
}

export class AudioAssetStore extends DiskAssetStore {
  constructor({ cacheDir = process.env.QXQY_AUDIO_CACHE_DIR || defaultAssetCacheDir('audio'), fetch: fetcher = globalThis.fetch, source = AUDIO_SOURCE } = {}) {
    super({ cacheDir, fetch: fetcher, source, version: AUDIO_CACHE_VERSION, extension: 'mp3', accepts: id => audioDuration(id) !== null, timeout: 20_000 })
  }
  decode(data) { validateMp3(data); return {} }
  produce(id, signal, refresh) { return this.download(`audio/${id}.mp3`, MAX_BYTES, signal, refresh) }
}

let shared
export function sharedAudioAssets() { return shared ||= new AudioAssetStore() }

export async function serveAudioAsset(request, response, store = sharedAudioAssets()) {
  const url = new URL(request.url, 'http://localhost')
  if (url.pathname !== AUDIO_ASSET_PREFIX.slice(0, -1) && !url.pathname.startsWith(AUDIO_ASSET_PREFIX)) return false
  try {
    if (!['GET', 'HEAD'].includes(request.method)) throw Object.assign(new Error('GET or HEAD required'), { status: 405 })
    const match = url.pathname.match(new RegExp(`^${AUDIO_ASSET_PREFIX}${AUDIO_CACHE_VERSION}/([0-9]+)\\.mp3$`))
    if (!match) throw Object.assign(new Error('Unknown audio resource'), { status: 404 })
    const audio = await store.get(Number(match[1])), size = audio.data.length
    const headers = { 'content-type': 'audio/mpeg', 'cache-control': 'private, max-age=43200', etag: audio.etag, 'accept-ranges': 'bytes', 'x-content-type-options': 'nosniff' }
    if (request.headers['if-none-match'] === audio.etag) { response.writeHead(304, headers); response.end(); return true }
    const range = request.headers.range
    let start = 0, end = size - 1, status = 200
    if (range && (!request.headers['if-range'] || request.headers['if-range'] === audio.etag)) {
      const parts = range.match(/^bytes=(\d*)-(\d*)$/)
      if (!parts || (!parts[1] && !parts[2])) throw Object.assign(new Error('Invalid byte range'), { status: 416, size })
      if (!parts[1]) start = Math.max(0, size - Number(parts[2]))
      else { start = Number(parts[1]); end = parts[2] ? Math.min(size - 1, Number(parts[2])) : end }
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || end < start) throw Object.assign(new Error('Unsatisfiable byte range'), { status: 416, size })
      status = 206
      headers['content-range'] = `bytes ${start}-${end}/${size}`
    }
    response.writeHead(status, { ...headers, 'content-length': end - start + 1 })
    response.end(request.method === 'HEAD' ? undefined : audio.data.subarray(start, end + 1))
  } catch (error) {
    response.writeHead(error.status || 502, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store',
      ...(error.status === 416 ? { 'content-range': `bytes */${error.size}` } : {}) })
    response.end(request.method === 'HEAD' ? undefined : error.message)
  }
  return true
}
