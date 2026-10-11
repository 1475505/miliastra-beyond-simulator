// https://oss.070077.xyz/prefabs/data.json, checked 2026-10-11.
// schemaVersion 2 / dataVersion 7.1.0 / rendering.imageSource Prefab.
// 2,720 non-empty sprite/<id>.png entries; seven null images excluded.
export const PREFAB_SOURCE = 'https://oss.070077.xyz/prefabs/'
export const PREFAB_CACHE_VERSION = 'prefab-v1'
const RANGES = [
  [10003004, 10003004], [10005001, 10005142], [10006001, 10006002],
  [10007002, 10007002], [10008001, 10008001], [10009001, 10009011],
  [20001001, 20001074], [20001076, 20001121], [20001123, 20001156],
  [20001158, 20001302], [20001304, 20001568], [20001570, 20001999],
  [20002001, 20002755], [20002757, 20002999], [20003001, 20003455],
  [30001001, 30001016], [30002001, 30002017], [30003001, 30003011],
  [30004001, 30004001], [30005001, 30005020], [30006001, 30006026],
  [30007001, 30007013], [30008001, 30008011],
]

export function prefabImageSize(id) {
  if (!Number.isSafeInteger(id) || !RANGES.some(([min, max]) => id >= min && id <= max)) return null
  // The supplied PNGs are complete square icons, not trimmed atlas regions.
  return id === 10003004 || id === 10008001 ? 128 : 256
}
