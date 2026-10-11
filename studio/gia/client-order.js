// Authoring lists foreground siblings first; native GIA lists them bottom first.
// Independent template roots retain their list order. Keep export and calibration
// on this same traversal; this is not a sort by the old numeric GUID.
export function collectClientNodes(project, reverseSiblings = false) {
  const nodes = []
  const visit = (node, parent) => {
    if (node.kind !== 'server-container') nodes.push({ node, parent })
    const children = reverseSiblings && node.kind !== 'server-container'
      ? [...(node.children || [])].reverse() : (node.children || [])
    for (const child of children) visit(child, node)
  }
  visit(project.root, null)
  return nodes
}
