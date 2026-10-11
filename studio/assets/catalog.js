import { PREFAB_CACHE_VERSION, prefabImageSize } from './prefab-catalog.js'

// Pinned from https://oss.070077.xyz/images/data.json (2026-10-02).
// 1,522 non-empty entries; all paths verified as sprite/<id>.png and
// border/<id>.json. Empty/missing entries are deliberately not admitted.
// Refreshing image bytes does not expand this allowlist.
export const IMAGE_SOURCE = 'https://oss.070077.xyz/images/'
export const IMAGE_CACHE_VERSION = 'sprite-v1'
export const IMAGE_ASSET_PREFIX = '/qxqy-assets/'
const RANGES = [
  [100001, 100006], [100101, 100213], [101001, 101018], [101020, 101028],
  [101030, 101046], [101048, 101048], [101050, 101054], [101056, 101080],
  [102001, 102052], [103001, 103148], [104001, 104010], [105001, 105140],
  [105142, 105219], [105221, 105317], [106001, 106047], [106049, 106096],
  [107001, 107007], [107010, 107020], [107031, 107092], [107094, 107180],
  [107183, 107201], [107203, 107205], [107207, 107228], [107231, 107278],
  [107280, 107402], [108001, 108017], [108019, 108020], [109001, 109031],
  [109033, 109034], [109036, 109075], [110001, 110053], [111001, 111139],
  [112001, 112042],
]

export function imageSourceName(source) {
  // Legacy/synthetic image specs omitted the source. Only that omission defaults
  // to StaticReference; unsupported explicit sources must not borrow its IDs.
  if (source == null || source === '') return 'StaticReference'
  return typeof source === 'string' ? source : (typeof source.Name === 'string' ? source.Name : 'Unknown')
}

export function imageAssetKey(id, source) { return `${imageSourceName(source)}:${id}` }

export function canSelectImageType(id, source) {
  return imageSourceName(source) === 'StaticReference' && isRemoteImage(id, source)
}

export function isRemoteImage(id, source) {
  const name = imageSourceName(source)
  if (name === 'Prefab') return prefabImageSize(id) !== null
  return name === 'StaticReference' && Number.isSafeInteger(id) && id > 100006 && RANGES.some(([min, max]) => id >= min && id <= max)
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
