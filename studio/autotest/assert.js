import { createRuntime } from 'qxqy-lua-runtime'

function same(actual, expected) {
  return JSON.stringify(actual) === JSON.stringify(expected)
}

function walkTree(nodes, visit) {
  for (const node of nodes || []) {
    visit(node)
    if (node.children?.length) walkTree(node.children, visit)
  }
}

function findControl(tree, { id, name }) {
  let hit = null
  walkTree(tree, (node) => {
    if (hit) return
    if (id && String(node.id) === String(id)) hit = node
    else if (!id && name && node.name === name) hit = node
  })
  return hit
}

function readField(control, field) {
  if (!control) return undefined
  if (Object.prototype.hasOwnProperty.call(control, field)) return control[field]
  if (control.box && Object.prototype.hasOwnProperty.call(control.box, field)) return control.box[field]
  return undefined
}

function makeQuery(snap) {
  return {
    var(entityType, name) {
      return snap.server?.vars?.[entityType]?.[name]?.value ?? null
    },
    logs() {
      return (snap.logs || []).map((row) => row.text)
    },
    logContains(text) {
      return (snap.logs || []).some((row) => String(row.text || '').includes(String(text)))
    },
    serverLogs() {
      return (snap.server?.logs || snap.serverLogs || []).map((row) => row.text)
    },
    serverLogContains(text) {
      return (snap.server?.logs || snap.serverLogs || []).some((row) => String(row.text || '').includes(String(text)))
    },
    control(name) {
      const node = findControl(snap.tree, { name: String(name) })
      if (!node) return null
      return {
        id: node.id,
        name: node.name,
        kind: node.kind,
        active: node.active,
        visible: node.visible,
        pressed: node.pressed,
        text: node.text,
        interactable: node.interactable,
      }
    },
    signals(direction) {
      const key = direction === 'outbound' ? 'outbound' : 'inbound'
      return (snap.server?.[key] || []).map((row) => ({ name: row.name, values: row.values }))
    },
  }
}

function evalJsonAssert(assert, snap) {
  if (assert.kind === 'log') {
    const logs = assert.source === 'server'
      ? (snap.server?.logs || snap.serverLogs || [])
      : (snap.logs || [])
    const hit = logs.some((row) => {
      if (assert.level && row.level !== assert.level) return false
      return String(row.text || '').includes(assert.contains)
    })
    return hit
      ? { ok: true, actual: assert.contains }
      : { ok: false, actual: logs.map((row) => row.text).slice(-8), expected: assert.contains }
  }
  if (assert.kind === 'control') {
    const control = findControl(snap.tree, assert)
    if (!control) {
      return { ok: false, actual: null, expected: assert.equals, message: `control not found: ${assert.id || assert.name}` }
    }
    const actual = readField(control, assert.field)
    return same(actual, assert.equals)
      ? { ok: true, actual }
      : { ok: false, actual, expected: assert.equals }
  }
  if (assert.kind === 'var') {
    const bag = snap.server?.vars?.[assert.entityType]
    const missing = !bag || !Object.prototype.hasOwnProperty.call(bag, assert.name)
    const actual = missing ? null : bag[assert.name].value
    return same(actual, assert.equals)
      ? { ok: true, actual }
      : { ok: false, actual, expected: assert.equals }
  }
  if (assert.kind === 'signal') {
    const list = assert.direction === 'outbound' ? (snap.server?.outbound || []) : (snap.server?.inbound || [])
    const hit = list.find((row) => row.name === assert.name && (assert.values === undefined || same(row.values, assert.values)))
    return hit
      ? { ok: true, actual: hit.values }
      : { ok: false, actual: list.map((row) => ({ name: row.name, values: row.values })), expected: { name: assert.name, values: assert.values ?? null } }
  }
  if (assert.kind === 'tree') {
    const exists = Boolean(findControl(snap.tree, { name: assert.name }))
    return exists === assert.exists
      ? { ok: true, actual: exists }
      : { ok: false, actual: exists, expected: assert.exists }
  }
  return { ok: false, message: `unsupported assert kind ${assert.kind}` }
}

function evalLuaAssert(source, snap) {
  const rt = createRuntime()
  try {
    rt.evalQueryScript(source, makeQuery(snap))
    return { ok: true, actual: true }
  } catch (err) {
    return { ok: false, message: err?.message || String(err) }
  } finally {
    rt.destroy()
  }
}

export function evaluateAssert(assert, snap) {
  if (assert.kind === 'lua') return evalLuaAssert(assert.source, snap)
  return evalJsonAssert(assert, snap)
}
