import { toJson } from '../json.js'
import { walk } from '../ui/authoring.js'

// Selection is authoring identity, never a name or an import-time GUID. Work on
// copies: exporting a child as a template must not reparent the live project.
export function clientExportChoices(project, scripts = []) {
  const rows = []
  const counts = new Map()
  const mounts = new Map()
  for (const script of scripts) mounts.set(script.controlId, (mounts.get(script.controlId) || 0) + 1)
  function count(node) {
    const children = (node.children || []).map(count)
    const value = { controlCount: 1 + children.reduce((sum, child) => sum + child.controlCount, 0),
      scriptCount: (mounts.get(node.id) || 0) + children.reduce((sum, child) => sum + child.scriptCount, 0) }
    counts.set(node.id, value)
    return value
  }
  count(project.root)
  function visit(node, parentId = '', ancestorIds = []) {
    rows.push({ id: node.id, name: node.name, kind: node.kind, guid: node.guid,
      parentId, ancestorIds, depth: ancestorIds.length, ...counts.get(node.id) })
    for (const child of node.children || []) visit(child, node.id, [...ancestorIds, node.id])
  }
  for (const node of project.root.children || []) visit(node)
  return rows
}

export function prepareClientExport(project, scripts, { controlIds, includeScripts = true } = {}) {
  if (!Array.isArray(controlIds) || !controlIds.length || controlIds.some(id => typeof id !== 'string' || !id)) {
    throw new Error('请选择至少一个客户端控件 controlIds')
  }
  if (typeof includeScripts !== 'boolean') throw new Error('includeScripts must be a boolean')
  const rows = clientExportChoices(project, scripts)
  const byId = new Map(rows.map(row => [row.id, row]))
  for (const id of controlIds) if (!byId.has(id)) throw new Error(`未知客户端控件：${id}`)
  const selected = new Set(controlIds)
  const roots = rows.filter(row => selected.has(row.id) && !row.ancestorIds.some(id => selected.has(id)))
  const copy = toJson(project)
  const nodes = new Map()
  walk(copy.root, node => nodes.set(node.id, node))
  copy.root.children = roots.map(row => nodes.get(row.id))
  copy.selectedId = roots[0].id
  const ids = new Set()
  walk(copy.root, node => { if (node.kind !== 'server-container') ids.add(node.id) })
  const warnings = []
  for (const row of roots) if (row.parentId) {
    warnings.push(`${row.name}：仅在导出副本中提升为独立模板，保留四平台局部变换；外部父级的缩放、旋转、遮罩及显隐不包含在内。`)
  }
  const includedGuids = new Set([...ids].map(id => nodes.get(id).guid))
  walk(copy.root, node => {
    for (const key of ['referencedPrefabId', 'itemPrefabId']) {
      const value = node[key]
      if (value && !includedGuids.has(Number(value))) warnings.push(`${node.name}：引用 ${value} 不在本次导出中，请同时导入对应模板。`)
    }
    if (node.giaRaw?.templateRefSlotBase64) warnings.push(`${node.name}：二进制模板引用原样保留，无法自动判断外部依赖。`)
    if (!includeScripts && node.scriptMappingIds?.length) node.scriptMappingIds = []
  })
  // Unmounted modules may be required dynamically. Do not guess dependencies by
  // searching Lua strings; include those registered modules, but no other mounts.
  const selectedScripts = includeScripts ? scripts.filter(script => !script.controlId || ids.has(script.controlId)) : []
  for (const script of selectedScripts) if (!script.source && script.path) warnings.push(`${script.path}：仅登记了路径，没有内联源码；请核对游戏内的脚本文件。`)
  if (includeScripts && selectedScripts.some(script => !script.controlId)) {
    warnings.push('已包含未挂载的 Lua 模块；Lua 动态引用无法自动判断，请核对外部模板和脚本依赖。')
  }
  if (!includeScripts && scripts.some(script => ids.has(script.controlId))) warnings.push('本次未包含挂载脚本，导入后需另行导入并挂载。')
  const knownScripts = new Set(selectedScripts.map(script => script.guid))
  if (includeScripts) walk(copy.root, node => {
    for (const guid of node.scriptMappingIds || []) if (!knownScripts.has(guid)) warnings.push(`${node.name}：脚本映射 ${guid} 的源码未登记，请另行导入。`)
  })
  return { project: copy, scripts: selectedScripts, warnings: [...new Set(warnings)],
    selection: { controlIds: roots.map(row => row.id), controlCount: ids.size,
      templateCount: roots.length, scriptCount: selectedScripts.length, includeScripts } }
}
