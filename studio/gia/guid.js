// Export/new-ID range adopted from PR #23's device report. Its bit-field
// interpretation is provided_unverified, not an independently verified contract.
export const GUID_MIN = 0x40000000 // 1073741824
export const GUID_MAX = 0x403fffff // 1077936127
// 普通控件 / ScriptAsset 从 1073741850 起按已用最大值递增。
export const GUID_BASE = 1073741850
// 模拟器给新服务端容器优先使用的空闲编号，不是合法范围的下界。
export const SERVER_CONTAINER_GUID = 1073741847

export function isValidGuid(value) {
  const guid = Number(value)
  return Number.isSafeInteger(guid) && guid >= GUID_MIN && guid <= GUID_MAX
}

// Legacy authoring IDs and ledger endpoints must survive reads so explicit
// calibration can preserve references and record the pending Lua mapping.
export function isStoredGuid(value) {
  const guid = Number(value)
  return Number.isSafeInteger(guid) && guid > 0 && guid <= 0x7fffffff
}

export function assertExportGuid(value, name) {
  if (isStoredGuid(value) && !isValidGuid(value)) {
    throw new Error(`${name || '资产'}: 索引 ${value} 超出 ${GUID_MIN}–${GUID_MAX}；请先校准索引并核对 Lua 引用，导出不会自动重编号。`)
  }
}

function walk(node, fn) {
  if (!node) return
  fn(node)
  for (const child of node.children || []) walk(child, fn)
}

export function collectUsedGuids(root, used = new Set(), { skipServerContainer = false } = {}) {
  walk(root, (node) => {
    if (skipServerContainer && node.kind === 'server-container') return
    if (isValidGuid(node.guid)) used.add(Number(node.guid))
  })
  return used
}

export function nextFreeGuid(used, start = GUID_BASE) {
  let next = Number.isSafeInteger(start) && start > 0 ? start : GUID_BASE
  if (next < GUID_BASE) next = GUID_BASE
  for (const guid of used) {
    if (isValidGuid(guid) && guid >= next) next = Number(guid) + 1
  }
  while (used.has(next)) next += 1
  if (next > GUID_MAX) throw new Error('GUID space exhausted')
  return next
}

export function nextControlGuid(kind, used) {
  if (kind === 'server-container' && !used.has(SERVER_CONTAINER_GUID)) return SERVER_CONTAINER_GUID
  return nextFreeGuid(used)
}

export function stampMissingGuids(root, used = new Set(), { skipServerContainer = false } = {}) {
  const pending = []
  walk(root, (node) => {
    if (skipServerContainer && node.kind === 'server-container') return
    const guid = Number(node.guid)
    if (isValidGuid(guid) && !used.has(guid)) {
      used.add(guid)
      node.guid = guid
      return
    }
    pending.push(node)
  })
  for (const node of pending) {
    const guid = nextControlGuid(node.kind, used)
    node.guid = guid
    used.add(guid)
  }
  return used
}
