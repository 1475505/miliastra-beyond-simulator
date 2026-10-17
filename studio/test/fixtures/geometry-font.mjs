// Original test-only TrueType font: A is a wide rectangle, B a narrow one.
// No glyphs or bytes are copied from a third-party font.
const u16 = (...values) => { const b = Buffer.alloc(values.length * 2); values.forEach((v, i) => b.writeUInt16BE(v & 0xffff, i * 2)); return b }
const u32 = (...values) => { const b = Buffer.alloc(values.length * 4); values.forEach((v, i) => b.writeUInt32BE(v >>> 0, i * 4)); return b }
const join = (...parts) => Buffer.concat(parts)
const padded = data => join(data, Buffer.alloc((4 - data.length % 4) % 4))
const checksum = data => { const b = padded(data); let sum = 0; for (let i = 0; i < b.length; i += 4) sum = (sum + b.readUInt32BE(i)) >>> 0; return sum }
const rectangle = width => join(u16(1, 100, 0, 100 + width, 700, 3, 0), Buffer.from([1, 1, 1, 1]), u16(100, width, 0, -width, 0, 0, 700, 0))

export function geometryFont() {
  const glyphs = [Buffer.alloc(12), padded(rectangle(600)), padded(rectangle(200))]
  const head = Buffer.alloc(54)
  head.writeUInt32BE(0x00010000, 0); head.writeUInt32BE(0x00010000, 4)
  head.writeUInt32BE(0x5f0f3cf5, 12); head.writeUInt16BE(3, 16); head.writeUInt16BE(1000, 18)
  head.writeUInt16BE(700, 40); head.writeUInt16BE(700, 42); head.writeUInt16BE(8, 46); head.writeInt16BE(2, 48)
  const hhea = join(u32(0x00010000), u16(800, -200, 0, 1000, 0, 100, 700, 1, 0, 0, 0, 0, 0, 0, 0, 3))
  const maxp = join(u32(0x00010000), u16(3, 4, 1, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0))
  const os2 = Buffer.alloc(78)
  os2.writeInt16BE(633, 2); os2.writeUInt16BE(400, 4); os2.writeUInt16BE(5, 6)
  os2.writeUInt32BE(1, 42); os2.write('TEST', 58, 'ascii'); os2.writeUInt16BE(0x40, 62)
  os2.writeUInt16BE(65, 64); os2.writeUInt16BE(66, 66)
  os2.writeInt16BE(800, 68); os2.writeInt16BE(-200, 70); os2.writeUInt16BE(800, 74); os2.writeUInt16BE(200, 76)
  const names = [[1, 'Qxqy Geometry Test'], [2, 'Regular'], [4, 'Qxqy Geometry Test Regular'], [5, 'Version 1.0'], [6, 'QxqyGeometryTest-Regular']]
  const strings = [], records = []; let offset = 0
  for (const [id, value] of names) {
    const bytes = Buffer.from(value, 'utf16le').swap16()
    records.push(u16(3, 1, 0x0409, id, bytes.length, offset)); strings.push(bytes); offset += bytes.length
  }
  const tables = {
    'OS/2': os2,
    cmap: join(u16(0, 1, 3, 1), u32(12), u16(4, 32, 0, 4, 4, 1, 0, 66, 0xffff, 0, 65, 0xffff, -64, 1, 0, 0)),
    glyf: join(...glyphs), head, hhea,
    hmtx: u16(500, 0, 1000, 100, 400, 100),
    loca: u16(0, glyphs[0].length / 2, (glyphs[0].length + glyphs[1].length) / 2, glyphs.reduce((n, b) => n + b.length, 0) / 2),
    maxp,
    name: join(u16(0, names.length, 6 + names.length * 12), ...records, ...strings),
    post: join(u32(0x00030000), Buffer.alloc(28)),
  }
  const tags = Object.keys(tables).sort(), count = tags.length, power = 2 ** Math.floor(Math.log2(count))
  const directory = [], contents = []; let cursor = 12 + count * 16, headOffset
  for (const tag of tags) {
    const bytes = tables[tag]
    directory.push(join(Buffer.from(tag), u32(checksum(bytes), cursor, bytes.length)))
    if (tag === 'head') headOffset = cursor
    contents.push(padded(bytes)); cursor += padded(bytes).length
  }
  const font = join(u32(0x00010000), u16(count, power * 16, Math.log2(power), count * 16 - power * 16), ...directory, ...contents)
  font.writeUInt32BE((0xb1b0afba - checksum(font)) >>> 0, headOffset + 8)
  return font
}
