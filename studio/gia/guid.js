// 新分配的 GraphUnit / ScriptAsset id.id 从 1073741850 起递增；已有合法编号原样保留。
export const GUID_BASE = 1073741850

export function isValidGuid(value) {
  const guid = Number(value)
  return Number.isSafeInteger(guid) && guid > 0 && guid <= 0x7fffffff
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
  if (next > 0x7fffffff) throw new Error('GUID space exhausted')
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
