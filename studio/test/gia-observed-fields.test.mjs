import { test } from 'node:test'
import assert from 'node:assert/strict'
import { importGia, exportGia } from '../gia/codec.js'
import { createStudio } from '../index.js'
import { PLATFORMS } from '../constants.js'

// Independent synthetic wire fixture. Relevant leaf bytes observed in official
// gameVersion 7.1.0 tmp.gia, SHA256 ccd5f81789872760a28c272ee754a49667a606aeb89ea02a64193ecc174a79b5.
// No external files or the production protobuf schema are used by these tests.
const cat = (...xs) => Buffer.concat(xs)
const vi = n => { const a = []; do { a.push((n & 127) | (n > 127 ? 128 : 0)); n = Math.floor(n / 128) } while (n); return Buffer.from(a) }
const msg = (n, b) => cat(vi(n * 8 + 2), vi(b.length), b)
const num = (n, v) => cat(vi(n * 8), vi(v))
const str = (n, v) => msg(n, Buffer.from(v))
const hex = s => Buffer.from(s, 'hex')
function envelope(payload) {
  const head = Buffer.alloc(20), tail = Buffer.alloc(4)
  ;[payload.length + 20, 1, 0x326, 3, payload.length].forEach((v, i) => head.writeUInt32BE(v, i * 4))
  tail.writeUInt32BE(0x679)
  return cat(head, payload, tail)
}
function fields(b) {
  let i = 0
  const read = () => { let v = 0, s = 0, x; do { x = b[i++]; v += (x & 127) * 2 ** s; s += 7 } while (x & 128); return v }
  const out = []
  while (i < b.length) {
    const tag = read(), wire = tag & 7
    let v
    if (wire === 0) v = read()
    else { const len = wire === 2 ? read() : wire === 5 ? 4 : 8; v = b.subarray(i, i + len); i += len }
    out.push([Math.floor(tag / 8), v])
  }
  return out
}
const all = (b, n) => fields(b).filter(([k]) => k === n).map(([, v]) => v)
const first = (b, n) => all(b, n)[0] ?? Buffer.alloc(0)
const details = u => all(first(first(u, 19), 1), 505).map(d => first(d, 503))
const slot = (n, value) => msg(505, msg(503, msg(n, value)))
function unit(id, name, rotation, hidden, vertical) {
  const rt = msg(508, hex(rotation))
  const platforms = PLATFORMS.map((_, i) => msg(501, cat(num(501, i), msg(502, rt))))
  const content = cat(num(501, id), slot(13, msg(12, cat(...platforms))),
    slot(14, cat(msg(17, hex(hidden ? 'b81f01' : '')), num(501, 7))),
    vertical === undefined ? slot(84, num(503, 100002)) : slot(75, cat(str(510, ''), hex(vertical))))
  return cat(msg(1, num(4, id)), str(3, name), num(5, 70), msg(19, msg(1, content)))
}
function fixture() {
  return envelope(cat(
    msg(1, unit(1073744900, 'angle30', '1d0100f041', false)),
    msg(1, unit(1073744901, 'angle90-hidden', '1d0000b442', true)),
    msg(1, unit(1073744902, 'bottom', '', false, 'e81f02')),
    msg(1, unit(1073744903, 'top', '', false, '')),
  ))
}

test('imports independently observed rotation, hidden state and bottom alignment wire bytes', () => {
  const { project } = importGia(fixture())
  const [a, b, bottom, top] = project.root.children
  for (const p of PLATFORMS) {
    assert.equal(a.transformByPlatform[p].rotation.z, 30.000001907348633)
    assert.equal(b.transformByPlatform[p].rotation.z, 90)
  }
  assert.equal(a.visible, true)
  assert.equal(b.visible, false)
  assert.equal(bottom.verticalAlignment, 'Bottom')
  assert.equal(top.verticalAlignment, 'Top')
})

test('exports observed leaf bytes into the proper nested fields, across all platforms', () => {
  const { project } = importGia(fixture())
  const result = exportGia(project)
  const bytes = result.buffer ?? Buffer.from(result.data, 'base64')
  const units = all(bytes.subarray(20, -4), 1)
  for (const [i, u] of units.entries()) {
    const ds = details(u)
    const transform = ds.map(d => first(d, 13)).find(b => b.length)
    const platforms = all(first(transform, 12), 501)
    assert.equal(platforms.length, 4)
    for (const p of platforms) assert.equal(first(first(p, 502), 508).toString('hex'), ['1d0100f041', '1d0000b442', '', ''][i])
    const state = ds.map(d => first(d, 14)).find(b => b.length)
    assert.equal(first(state, 17).toString('hex'), i === 1 ? 'b81f01' : '')
    if (i === 2) assert.equal(all(ds.map(d => first(d, 75)).find(b => b.length), 509)[0], 2)
  }
})

test('inferred Middle=1 is explicit in warnings', () => {
  const source = createStudio(importGia(fixture()).project)
  source.patch({ op: 'set', id: source.get().root.children[2].id, key: 'verticalAlignment', value: 'Middle' })
  const result = source.exportData('gia')
  assert.ok(result.warnings.some(w => /垂直居中.*推定/.test(w)))
  const restored = importGia(Buffer.from(result.data, 'base64')).project
  assert.equal(restored.root.children[2].verticalAlignment, 'Middle')
})

test('semantic vertical alignment edits replace an imported unknown enum', () => {
  const bytes = envelope(msg(1, unit(1073744900, 'unknown-align', '', false, 'e81f09')))
  const imported = importGia(bytes)
  assert.equal(imported.project.root.children[0].giaRaw.textVerticalAlign, 9)
  assert.ok(imported.warnings.some(w => /垂直对齐枚举 9/.test(w)))
  const studio = createStudio(imported.project)
  studio.patch({ op: 'set', id: imported.project.root.children[0].id, key: 'verticalAlignment', value: 'Bottom' })
  const exported = studio.exportData('gia')
  const node = importGia(Buffer.from(exported.data, 'base64')).project.root.children[0]
  assert.equal(node.verticalAlignment, 'Bottom')
  assert.equal(node.giaRaw.textVerticalAlign, undefined)
})
