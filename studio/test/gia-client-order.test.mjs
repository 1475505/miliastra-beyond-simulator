import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createStudio } from '../index.js'
import { createNode } from '../ui/authoring.js'
import { exportGia, importGia } from '../gia/codec.js'

// Independent native direction evidence, 2026-10-12: the WOO tree showed
// Rig_ArmLeft (last wire child) above Rig_Hat (first wire child). Reversing
// children + relatedIds + accessory DFS restored the face/highlights on device.
// Accepted patch SHA256: a3f11438b75f2018d62209cbf7fae90f952c9eaa79f629cb861040bfe9813173.
// Synthetic wire below requires neither that external file nor the codec schema.
const cat = (...bs) => Buffer.concat(bs)
function vi(n) {
  const bytes = []
  do { bytes.push(n % 128 | (n >= 128 ? 128 : 0)); n = Math.floor(n / 128) } while (n)
  return Buffer.from(bytes)
}
const msg = (n, b) => cat(vi(n * 8 + 2), vi(b.length), b)
const num = (n, value) => cat(vi(n * 8), vi(value))
const str = (n, value) => msg(n, Buffer.from(value))
function envelope(payload) {
  const head = Buffer.alloc(20), tail = Buffer.alloc(4)
  ;[payload.length + 20, 1, 0x326, 3, payload.length].forEach((n, i) => head.writeUInt32BE(n, i * 4))
  tail.writeUInt32BE(0x679)
  return cat(head, payload, tail)
}
function varints(bytes) {
  const values = []; let n = 0, factor = 1
  for (const byte of bytes) {
    n += (byte & 127) * factor
    if (byte & 128) factor *= 128
    else { values.push(n); n = 0; factor = 1 }
  }
  return values
}
function fields(bytes) {
  let i = 0
  const read = () => { let n = 0, f = 1, b; do { b = bytes[i++]; n += (b & 127) * f; f *= 128 } while (b & 128); return n }
  const rows = []
  while (i < bytes.length) {
    const tag = read(), wire = tag & 7
    let value
    if (wire === 0) value = read()
    else { const length = wire === 2 ? read() : wire === 5 ? 4 : 8; value = bytes.subarray(i, i + length); i += length }
    rows.push({ field: Math.floor(tag / 8), value })
  }
  return rows
}
const all = (b, n) => fields(b).filter(r => r.field === n).map(r => r.value)
const first = (b, n) => all(b, n)[0] ?? Buffer.alloc(0)
const ids = { Root: 1073741850, Hat: 1073741851, Shine: 1073741852, Leaf: 1073741853, Body: 1073741854, Other: 1073741855 }
function unit(name, children = [], parent = '', kind = 'image') {
  const guid = ids[name], ref = id => cat(num(2, 1), num(3, 8), num(4, id))
  const info = cat(
    msg(502, cat(msg(11, num(501, guid)), num(501, 1), num(502, 5))),
    msg(502, cat(msg(12, num(501, guid - ids.Root + 2)), num(501, 2), num(502, 6))),
    parent ? Buffer.alloc(0) : msg(502, cat(msg(14, msg(501, Buffer.alloc(0))), num(501, 4), num(502, 4))))
  const transforms = msg(13, msg(12, cat(...[0, 1, 2, 3].map(p => msg(501, cat(num(501, p), msg(502, msg(508, Buffer.alloc(0)))))))))
  const content = cat(num(501, guid), info, msg(503, cat(...children.map(n => vi(ids[n])))),
    parent ? num(504, ids[parent]) : Buffer.alloc(0),
    msg(505, msg(503, transforms)), msg(505, msg(503, msg(kind === 'image' ? 84 : 79, Buffer.alloc(0)))))
  return cat(msg(1, ref(guid)), ...children.map(n => msg(2, ref(ids[n]))),
    str(3, name), num(5, parent ? 15 : 70), msg(19, msg(1, content)))
}
function nativeFixture() {
  return envelope(cat(
    msg(1, unit('Root', ['Body', 'Hat'], '', 'container')), msg(1, unit('Other')),
    msg(2, unit('Body', [], 'Root')), msg(2, unit('Hat', ['Leaf', 'Shine'], 'Root', 'container')),
    msg(2, unit('Leaf', [], 'Hat')), msg(2, unit('Shine', [], 'Hat')),
    str(3, '1-1-1-\\native-direction.gia'), str(5, '7.1.0')))
}
function readWire(buffer) {
  const payload = buffer.subarray(20, -4)
  const parse = bytes => ({ name: first(bytes, 3).toString(), which: first(bytes, 5), guid: first(first(bytes, 1), 4),
    children: varints(first(first(first(bytes, 19), 1), 503)), related: all(bytes, 2).map(b => first(b, 4)) })
  return { graph: all(payload, 1).map(parse), accessories: all(payload, 2).map(parse) }
}
function authoring() {
  const node = (name, kind = 'image') => createNode(kind, { id: name, name, guid: ids[name], giaInfoIndex: ids[name] - ids.Root + 2 })
  const holder = createNode('server-container', { id: 'holder' }), root = node('Root', 'container'), hat = node('Hat', 'container')
  // UI tree is foreground first. The template list itself is not a paint stack.
  hat.children = [node('Shine'), node('Leaf')]
  root.children = [hat, node('Body')]
  holder.children = [root, node('Other')]
  return { version: 1, layoutSchemaVersion: 2, meta: { assetType: 'client-control-template' }, root: holder, selectedId: 'Root' }
}
function assertWire(wire) {
  assert.deepEqual(wire.graph.filter(n => n.which === 70).map(n => n.name), ['Root', 'Other'])
  const nodes = new Map([...wire.graph, ...wire.accessories].map(n => [n.name, n]))
  for (const [name, childNames] of [['Root', ['Body', 'Hat']], ['Hat', ['Leaf', 'Shine']]]) {
    const children = childNames.map(n => nodes.get(n).guid)
    assert.deepEqual(nodes.get(name).children, children, name + ': native wire order')
    assert.deepEqual(nodes.get(name).related, children, name + ': dependency order')
  }
  assert.deepEqual(wire.accessories.filter(n => ['Body', 'Hat', 'Leaf', 'Shine'].includes(n.name)).map(n => n.name), ['Body', 'Hat', 'Leaf', 'Shine'])
}
test('imports independently encoded native client siblings as foreground-first, including nested groups', () => {
  const { project } = importGia(nativeFixture())
  assert.deepEqual(project.root.children.map(n => n.name), ['Root', 'Other'])
  const root = project.root.children[0]
  assert.deepEqual(root.children.map(n => n.name), ['Hat', 'Body'])
  assert.deepEqual(root.children[0].children.map(n => n.name), ['Shine', 'Leaf'])
})
test('exports authoring client siblings to explicit native wire order without mutating the tree', () => {
  const project = authoring(), order = project.root.children[0].children.map(n => n.name)
  assertWire(readWire(exportGia(project).buffer))
  assert.deepEqual(project.root.children[0].children.map(n => n.name), order)
})
test('combined export applies native direction inside templates and preserves the template list', () => {
  const studio = createStudio(authoring())
  const exported = studio.exportData('gia-combined')
  assertWire(readWire(Buffer.from(exported.data, exported.encoding)))
})
test('importing and exporting independent native fixture preserves its sibling and accessory direction', () => {
  assertWire(readWire(exportGia(importGia(nativeFixture()).project).buffer))
})
