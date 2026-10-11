import { DiskAssetStore } from './asset-cache.js'
import { IMAGE_SOURCE, isRemoteImage } from '../assets/catalog.js'
import { normalizeImageMeta } from '../assets/image-stretch.js'

export class ImageMetadataStore extends DiskAssetStore {
  constructor({ cacheDir, source = IMAGE_SOURCE, fetch: fetcher = globalThis.fetch }) {
    super({ cacheDir, source, fetch: fetcher, version: 'border-v1', extension: 'json', accepts: id => isRemoteImage(id) })
  }
  decode(data) {
    const raw = JSON.parse(data.toString('utf8'))
    if (raw !== null && (typeof raw !== 'object' || Array.isArray(raw))) throw new Error('Invalid image metadata')
    const meta = normalizeImageMeta(raw)
    return { raw, meta }
  }
  async produce(id, signal, refresh) {
    try { return await this.download(`border/${id}.json`, 128 * 1024, signal, refresh) }
    catch (error) { if (error.status === 404) return Buffer.from('null'); throw error }
  }
}
