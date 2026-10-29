import data from './ui-vfx-data.json' with { type: 'json' }

export const UI_VFX_SOURCE = 'https://oss.070077.xyz/uivfx/'
export const UI_VFX_VERSION = data.version
export const UI_VFX_PREFIX = '/qxqy-vfx/'
export const UI_VFX_CATALOG = Object.freeze(data.assets.map(Object.freeze))
const byId = new Map(UI_VFX_CATALOG.map(item => [item.id, item]))
export function uiVfxAsset(id, kind = 'animation') {
  const asset = byId.get(Number(id))
  return asset?.scope === (kind === 'fullscreen' ? 'screen' : 'ui') ? asset : null
}
export function uiVfxMedia(path) { return Object.hasOwn(data.files, path) ? data.files[path] : null }
export function uiVfxUrl(path) { return uiVfxMedia(path) ? `${UI_VFX_PREFIX}${UI_VFX_VERSION}/${path}` : null }

// Resource playback convention from ugc-tool, not a device timing contract.
export function uiVfxTime(asset, elapsed) {
  const time = Math.max(0, elapsed || 0)
  if (time < asset.duration) return time
  return asset.loop ? asset.duration / 2 + (time - asset.duration) % (asset.duration / 2) : null
}
