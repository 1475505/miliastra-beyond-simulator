// Info.index identifies a registered UI asset, not its control kind or GUID.
// New assets get persistent numbers; imported template/instance aliases remain
// shared. Evidence: native layers GIA and the device-confirmed 17-byte fix.
export const MAX_ASSET_INDEX = 0x7fffffff
export const ASSET_INDEX_SCHEMA_VERSION = 1

export function isValidAssetIndex(value) {
  return Number.isSafeInteger(value) && value > 0 && value <= MAX_ASSET_INDEX
}

export function ensureClientAssetIndices(project, { warnings = [] } = {}) {
  if (project.meta?.assetType !== 'client-control-template') return
  if (project.meta.giaAssetIndexSchemaVersion > ASSET_INDEX_SCHEMA_VERSION) {
    throw new Error(`不支持客户端资产编号版本 ${project.meta.giaAssetIndexSchemaVersion}`)
  }
  const nodes = []
  const visit = node => {
    if (node.kind !== 'server-container') nodes.push(node)
    for (const child of node.children || []) visit(child)
  }
  visit(project.root)

  // Old saves (including GIA re-imports) can already contain the faulty numbers.
  // Identify the full legacy pattern, not merely a shared template/child number:
  // independent roots collide, every kind uses only one index, index groups are
  // kind-consistent, and there are no newly registered authoring identities.
  const groups = new Map()
  const indicesByKind = new Map()
  for (const node of nodes) {
    if (!isValidAssetIndex(node.giaInfoIndex)) continue
    const group = groups.get(node.giaInfoIndex) || []
    group.push(node)
    groups.set(node.giaInfoIndex, group)
    const indices = indicesByKind.get(node.kind) || new Set()
    indices.add(node.giaInfoIndex)
    indicesByKind.set(node.kind, indices)
  }
  const roots = (project.root.children || []).filter(node => node.kind !== 'server-container')
  const rootSet = new Set(roots)
  const duplicatedRootIndex = roots.some((node, i) => isValidAssetIndex(node.giaInfoIndex)
    && roots.slice(0, i).some(previous => previous.giaInfoIndex === node.giaInfoIndex))
  const legacyTypeAliases = !project.meta.giaAssetIndexSchemaVersion
    && duplicatedRootIndex
    && nodes.every(node => node.giaInfoIndexSource !== 'authoring')
    && [...indicesByKind.values()].every(indices => indices.size === 1)
    && [...groups.values()].every(group => group.every(node => node.kind === group[0].kind))
  const migrate = new Set()
  if (legacyTypeAliases) {
    for (const group of groups.values()) {
      // Keep the first existing template identity if present. Its incorrectly
      // reused descendants and additional roots are registered as new assets.
      const retained = group.find(node => rootSet.has(node)) || group[0]
      for (const node of group) if (node !== retained) migrate.add(node)
    }
  }

  const owners = new Map()
  let next = Number.isSafeInteger(project.meta.giaNextAssetIndex)
    && project.meta.giaNextAssetIndex >= 2
    ? project.meta.giaNextAssetIndex : 2
  for (const node of nodes) {
    if (!isValidAssetIndex(node.giaInfoIndex)) continue
    next = Math.max(next, node.giaInfoIndex + 1)
    if (migrate.has(node)) continue
    const previous = owners.get(node.giaInfoIndex)
    if (previous && (previous.giaInfoIndexSource === 'authoring' || node.giaInfoIndexSource === 'authoring')) {
      throw new Error(`新建资产编号 ${node.giaInfoIndex} 重复：${previous.name} / ${node.name}`)
    }
    owners.set(node.giaInfoIndex, node)
  }

  // Match the device-confirmed correction: keep the old identities, register
  // distinct additional roots first, then children. Reserve old built-ins 1..12
  // during this specific migration only; normal new projects start at 2.
  if (legacyTypeAliases) next = Math.max(next, 13)
  const missing = legacyTypeAliases
    ? [...roots, ...nodes.filter(node => !rootSet.has(node))]
      .filter(node => migrate.has(node) || !isValidAssetIndex(node.giaInfoIndex))
    : nodes.filter(node => !isValidAssetIndex(node.giaInfoIndex))
  if (missing.length && next + missing.length - 1 > MAX_ASSET_INDEX) {
    throw new Error('客户端资产编号空间已耗尽')
  }
  // Normally only the newly added node is missing. Legacy JSON without indices
  // is registered once in its saved tree order; later reordering never renumbers.
  for (const node of missing) {
    node.giaInfoIndex = next++
    node.giaInfoIndexSource = 'authoring'
  }
  project.meta.giaNextAssetIndex = next
  project.meta.giaAssetIndexSchemaVersion = ASSET_INDEX_SCHEMA_VERSION
  if (migrate.size) warnings.push(`旧客户端资产编号自动迁移：修复 ${migrate.size} 条按控件类型复用的编号；GUID、Lua 引用和控件属性保持不变。`)
}
