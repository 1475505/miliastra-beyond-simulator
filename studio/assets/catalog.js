import { PREFAB_CACHE_VERSION, prefabImageSize } from './prefab-catalog.js'

// Pinned from https://oss.070077.xyz/images/data.json (2026-11-21).
// 1,543 non-empty entries; all paths verified as sprite/<id>.png and
// border/<id>.json. Empty/missing entries are deliberately not admitted.
// Refreshing image bytes does not expand this allowlist.
export const IMAGE_SOURCE = 'https://oss.070077.xyz/images/'
export const IMAGE_CACHE_VERSION = 'sprite-v1'
export const IMAGE_ASSET_PREFIX = '/qxqy-assets/'
const RANGES = [
  [100001, 100006], [100101, 100213], [101001, 101080], [102001, 102052],
  [103001, 103148], [104001, 104010], [105001, 105317], [106001, 106096],
  [107001, 107020], [107031, 107402], [108001, 108020], [109001, 109075],
  [110001, 110053], [111001, 111139], [112001, 112042],
]

export function imageSourceName(source) {
  // Legacy/synthetic image specs omitted the source. Only that omission defaults
  // to StaticReference; unsupported explicit sources must not borrow its IDs.
  if (source == null || source === '') return 'StaticReference'
  return typeof source === 'string' ? source : (typeof source.Name === 'string' ? source.Name : 'Unknown')
}

export function imageAssetKey(id, source) { return `${imageSourceName(source)}:${id}` }

function isStaticImage(id) {
  return Number.isSafeInteger(id) && RANGES.some(([min, max]) => id >= min && id <= max)
}

// Lua field eligibility is not the download list or the editor's slice control.
export function imageTypeAccess(id, source, fromTemplate) {
  if (imageSourceName(source) !== 'StaticReference' || !isStaticImage(id)) return null
  if (id > 100006) return 'rw' // existing simulator policy for other known static images
  if (fromTemplate) return null // IMGGEOM only tested preplaced controls
  if (id === 100001) return 'rw'
  if (id === 100002) return 'ro' // observed initial read, but not a write to the circle itself
  return null
}

export function isRemoteImage(id, source) {
  const name = imageSourceName(source)
  if (name === 'Prefab') return prefabImageSize(id) !== null
  return name === 'StaticReference' && isStaticImage(id) && id > 100006
}

export function imageAssetUrl(id, revision = 0, source) {
  const name = imageSourceName(source)
  if (!['StaticReference', 'Prefab'].includes(name)) throw new Error(`Unsupported image source: ${name}`)
  const version = name === 'Prefab' ? PREFAB_CACHE_VERSION : IMAGE_CACHE_VERSION
  return `${IMAGE_ASSET_PREFIX}${version}/${id}.png${revision ? `?refresh=${revision}` : ''}`
}

export function imageMetadataUrl(id, revision = 0, source) {
  return imageAssetUrl(id, revision, source).replace('.png', '.json')
}
