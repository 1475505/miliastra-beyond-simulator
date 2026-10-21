// 真机控件 / 脚本索引是 32 位类型 ID：0x40000000 为基址，bit22~28 为类型
// （UI 控件与客户端脚本为 0），bit16~21 为协作位，bit0~15 为递增位。
// 因此合法区间是 0x40000000~0x403FFFFF；低于基址的值（如 1001）在真机会被判为
// 「控件值索引非法」，高于上界的值会落到其他类型。
export const GUID_MIN = 0x40000000 // 1073741824
export const GUID_MAX = 0x403fffff // 1077936127
// 新分配的 GraphUnit / ScriptAsset id.id 从 1073741850 起递增；已有合法编号原样保留。
export const GUID_BASE = 1073741850

export function isValidGuid(value) {
  const guid = Number(value)
  return Number.isSafeInteger(guid) && guid >= GUID_MIN && guid <= GUID_MAX
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
    const guid = nextFreeGuid(used)
    node.guid = guid
    used.add(guid)
  }
  return used
}
