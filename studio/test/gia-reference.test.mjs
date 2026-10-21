import test from 'node:test'
import assert from 'node:assert/strict'
import { createStudio } from '../index.js'
import { importGia, exportGia, inspectGia, validateScriptGiaCompatibility } from '../gia/codec.js'

// Synthetic wire cases, not a claimed native non-empty reference schema.
// Field 77 is only known to be length-delimited; arbitrary bytes must survive
// without being validated as UTF-8 or guessed to be a particular target GUID.
const cat = (...parts) => Buffer.concat(parts)
const vi = value => {
  const out = []
  do { out.push((value % 128) | (value >= 128 ? 128 : 0)); value = Math.floor(value / 128) } while (value)
  return Buffer.from(out)
}
const msg = (field, bytes) => cat(vi(field * 8 + 2), vi(bytes.length), bytes)
const num = (field, value) => cat(vi(field * 8), vi(value))
const str = (field, value) => msg(field, Buffer.from(value))
const slot = (field, bytes) => msg(505, msg(503, msg(field, bytes)))
const REF_GUID = 1073744900, SCRIPT_GUID = 1500000000
function envelope(payload) {
  const head = Buffer.alloc(20), tail = Buffer.alloc(4)
  ;[payload.length + 20, 1, 0x326, 3, payload.length].forEach((value, i) => head.writeUInt32BE(value, i * 4))
  tail.writeUInt32BE(0x679)
  return cat(head, payload, tail)
}
function reference({ inner = Buffer.alloc(0), outer = Buffer.alloc(0), mount = false, transform = true } = {}) {
  const rect = slot(13, msg(12, msg(501, msg(502, msg(508, Buffer.alloc(0))))))
  const content = cat(num(501, REF_GUID), transform ? rect : Buffer.alloc(0),
    msg(505, cat(msg(76, outer), num(501, 66), num(502, 89), msg(503, msg(77, inner)))),
    mount ? slot(74, msg(502, msg(1, num(1, SCRIPT_GUID)))) : Buffer.alloc(0))
  return cat(msg(1, cat(num(2, 1), num(3, 8), num(4, REF_GUID))), str(3, 'Reference'), num(5, 70), msg(19, msg(1, content)))
}
function fields(buffer) {
  let offset = 0
  const read = () => {
    let value = 0, scale = 1, byte
    do { byte = buffer[offset++]; value += (byte & 127) * scale; scale *= 128 } while (byte & 128)
    return value
  }
  const out = []
  while (offset < buffer.length) {
    const tag = read(), wire = tag & 7
    let value
    if (wire === 0) value = read()
    else { const length = wire === 2 ? read() : wire === 5 ? 4 : 8; value = buffer.subarray(offset, offset + length); offset += length }
    out.push([Math.floor(tag / 8), value])
  }
  return out
}
const all = (bytes, field) => fields(bytes).filter(([key]) => key === field).map(([, value]) => value)
const first = (bytes, field) => all(bytes, field)[0] ?? Buffer.alloc(0)
function referenceSlot(bytes) {
  const unit = first(bytes.subarray(20, -4), 1)
  const data = all(first(first(unit, 19), 1), 505).find(row => first(row, 501) === 66)
  return { outer: first(data, 76), inner: first(first(data, 503), 77) }
}
function scriptUnit(guid = SCRIPT_GUID) {
  return cat(msg(1, cat(num(2, 30), num(4, guid))), str(3, 'dependency'), num(5, 69),
    msg(35, msg(1, cat(num(1, guid), str(2, 'dependency'), str(3, 'dependency.lua'), str(5, 'return {}')))))
}

test('opaque reference bytes survive import, JSON reload, ordinary edits and GIA export', () => {
  const inner = Buffer.from('a81f9482808004', 'hex')
  const outer = Buffer.from('ff0080', 'hex')
  const input = envelope(msg(1, reference({ inner, outer })))
  assert.equal(inspectGia(input).templateCount, 1)
  const imported = importGia(input)
  const node = imported.project.root.children[0]
  assert.equal(node.kind, 'reference')
  assert.equal(node.referencedPrefabId, '', 'do not invent a target from opaque bytes')
  assert.equal(node.giaRaw.templateRefSlotBase64, inner.toString('base64'))
  assert.ok(imported.warnings.some(line => line.includes('二进制')))
  let studio = createStudio(imported.project)
  studio.patch({ op: 'set', id: node.id, key: 'name', value: 'Renamed' })
  studio.patch({ op: 'set', id: node.id, key: 'width', value: 160 })
  studio = createStudio(JSON.parse(Buffer.from(studio.exportData('save').data, 'base64')))
  const before = studio.archiveData()
  assert.throws(() => studio.patch({ op: 'set', id: node.id, key: 'referencedPrefabId', value: '1073742100' }), /原始配置/)
  assert.throws(() => studio.patch({ op: 'set', id: node.id, key: 'giaRaw.templateRefSlot', value: '1073742100' }), /原始配置/)
  assert.deepEqual(studio.archiveData(), before, 'unsupported binding edits must be atomic')
  const output = Buffer.from(studio.exportData('gia').data, 'base64')
  assert.deepEqual(referenceSlot(output), { inner, outer })
  const restored = importGia(output).project.root.children[0]
  assert.equal(restored.name, 'Renamed')
  assert.equal(restored.transformByPlatform.KEYBOARD.size.x, 160)
})

test('empty and legacy textual reference slots retain their existing behavior', () => {
  for (const text of ['', '1073742100', 'template-index-2008']) {
    const inner = Buffer.from(text)
    const imported = importGia(envelope(msg(1, reference({ inner }))))
    assert.equal(imported.project.root.children[0].referencedPrefabId, text)
    assert.deepEqual(referenceSlot(exportGia(imported.project).buffer).inner, inner)
  }
})

test('non-UI dependencies do not become controls, and attached scripts retain client mounts', () => {
  assert.equal(validateScriptGiaCompatibility(envelope(msg(1, scriptUnit(1073744901)))).valid, true)
  assert.equal(validateScriptGiaCompatibility(envelope(msg(1, scriptUnit()))).valid, false, 'legacy IDs remain readable but are not valid exports')
  const dependency = cat(msg(1, num(4, 1500000001)), str(3, 'unsupported resource'), num(5, 123))
  for (const scriptLocation of [1, 2]) {
    const input = envelope(cat(msg(1, reference({ mount: true })), msg(scriptLocation, scriptUnit()), msg(2, dependency)))
    const imported = importGia(input)
    assert.equal(imported.project.root.children.length, 1)
    assert.equal(imported.scripts.length, 1)
    assert.ok(imported.warnings.some(line => line.includes('跳过 1 个非 UI')))
    const target = createStudio()
    const result = target.importData('gia', input.toString('base64'), 'reference.gia')
    const script = result.snapshot.scripts.find(row => row.path === 'dependency.lua')
    assert.equal(script.controlAsset, 'client-control-template')
    assert.equal(script.controlName, 'Reference')
    assert.equal(script.mounted, true)
    assert.equal(script.guid, SCRIPT_GUID, 'keep original script identity and mount for explicit repair')
  }
})

test('invalid UI transforms still reject import without changing the existing save', () => {
  const target = createStudio()
  const before = target.archiveData()
  const input = envelope(cat(msg(1, reference({ transform: false, mount: true })), msg(2, scriptUnit())))
  assert.throws(() => target.importData('gia', input.toString('base64'), 'invalid.gia'), /缺少多平台变换/)
  assert.deepEqual(target.archiveData(), before)
})
