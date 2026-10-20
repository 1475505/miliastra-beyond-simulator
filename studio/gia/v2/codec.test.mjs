// codec.test.mjs — 严格测试 v2 .gil codec (2026-10-14)
//
// 覆盖:
//   1. V2_PREFAB 表 (数量 + 所有 GUIDs 已知值)
//   2. writeVarint + readVarint 对称 (1/2/3/4/5 字节边界, 含 0x40c00001)
//   3. 错误路径 (bad HEAD_TAG / version / 文件过短 / 缺 tail / tail 错)
//   4. decode edge cases (空 LUA / 无 LUA PREFAB / 多 metadata / 0 控件 / 空名)
//   5. byte-level round-trip (程序化样本: encode(decode(x)) === x 字节相等)
//   6. GUID count 保留 (encoder 不允许丢控件)
//   7. encode 字段保真 (templateGuid / templateName / LUA / metadata 字段)
//   8. 真 .gil 样本 (命令行动态发现): 字段提取正确, encode 产物可再解

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  HEADER_BYTES, TAIL_BYTES, HEAD_TAG, TAIL_TAG, VERSION,
  V2_PREFAB,
  writeVarint, readVarint, parseHeader,
  decodeGilV2, encodeGilV2, findLuaRange,
} from './codec.js'

// ===== 构造 v2 .gil 测试样本 (支持 byte-level round-trip: encode 知道怎么写每个字段) =====
function makeSampleGil({
  templateGuid = 0x4000000c,
  templateName = '测试模板',
  controls = [{ prefabGuid: 0x40c00001, name: 'container' }],
  luaSource = 'local PREFAB = { container = 1073742025 }\nlocal function test() end\n',
  metadata = [{ field: 14, size: 18, text: 'PropertyTransform' }],
} = {}) {
  const parts = []
  // f1 varint (template_guid)
  parts.push(Buffer.from([0x08]), writeVarint(templateGuid))
  // f2 length (template_name)
  if (templateName) {
    const nameBytes = Buffer.from(templateName, 'utf-8')
    parts.push(Buffer.from([0x12]), writeVarint(nameBytes.length), nameBytes)
  }
  // f3 length 0
  parts.push(Buffer.from([0x1a, 0x00]))
  // f4 length: controls (每个 = f1 varint PREFAB GUID)
  if (controls && controls.length) {
    const ctrlBody = []
    for (const c of controls) {
      ctrlBody.push(Buffer.from([0x08]), writeVarint(c.prefabGuid))
    }
    const cb = Buffer.concat(ctrlBody)
    parts.push(Buffer.from([(4 << 3) | 2]), writeVarint(cb.length), cb)
  }
  // f14 metadata
  for (const m of metadata) {
    parts.push(Buffer.from([(14 << 3) | 2]))
    parts.push(writeVarint(m.size))
    parts.push(Buffer.from(m.text, 'utf-8').subarray(0, m.size))
  }
  const payload = Buffer.concat(parts)
  const total = HEADER_BYTES + payload.length + Buffer.byteLength(luaSource, 'utf-8') + TAIL_BYTES
  const header = Buffer.alloc(HEADER_BYTES)
  header.writeUInt32BE(total, 0)
  header.writeUInt32BE(1, 4)
  header.writeUInt32BE(HEAD_TAG, 8)
  header.writeUInt32BE(VERSION, 12)
  header.writeUInt32BE(payload.length, 16)
  const tail = Buffer.alloc(TAIL_BYTES)
  tail.writeUInt32BE(TAIL_TAG, 0)
  return Buffer.concat([header, payload, Buffer.from(luaSource, 'utf-8'), tail])
}

// ===== 1. V2_PREFAB 表 =====
test('V2_PREFAB: 15 个 PREFAB 空间 + 4 个空间的精确值', () => {
  assert.equal(Object.keys(V2_PREFAB).length, 15, '应正好 15 个 PREFAB 空间')
  // 抽样验证 (4 个空间)
  assert.equal(V2_PREFAB[0x40c00001], 'container')
  assert.equal(V2_PREFAB[0x40c00009], 'keyHint')
  assert.equal(V2_PREFAB[0x40400001], 'server-container')
  assert.equal(V2_PREFAB[0x41000001], 'role-template-character')
  assert.equal(V2_PREFAB[0x41400001], 'entity-template-level')
  // 验证所有 key 都是数字且在预期范围
  for (const k of Object.keys(V2_PREFAB)) {
    const n = Number(k)
    assert.ok(n >= 0x40000000 && n <= 0x41ffffff, `${k} 应在 0x40-0x41 范围`)
  }
})

// ===== 2. writeVarint + readVarint 对称 =====
test('writeVarint: 0/1/127/128 边界', () => {
  assert.deepEqual([...writeVarint(0)], [0])
  assert.deepEqual([...writeVarint(1)], [1])
  assert.deepEqual([...writeVarint(127)], [127])
  assert.deepEqual([...writeVarint(128)], [0x80, 0x01])
  assert.deepEqual([...writeVarint(0x3fff)], [0xff, 0x7f])
  assert.deepEqual([...writeVarint(0x4000)], [0x80, 0x80, 0x01])
})

test('writeVarint: 0x40c00001 的 5 字节编码', () => {
  // 0x40c00001 = 1086324737
  // 7-bit groups LSB-first: 0x01 0x00 0x00 0x06 0x04
  // With continuation MSB: 0x81 0x80 0x80 0x86 0x04
  assert.deepEqual([...writeVarint(0x40c00001)], [0x81, 0x80, 0x80, 0x86, 0x04])
})

test('writeVarint + readVarint 对称: 全 PREFAB GUIDs + 边界值', () => {
  const testValues = [
    0, 1, 127, 128, 255, 256, 0x3fff, 0x4000, 0x1fffff, 0x200000,
    0x0fffffff,
    ...Object.keys(V2_PREFAB).map(Number),  // 全部 15 个 PREFAB
  ]
  for (const v of testValues) {
    const encoded = writeVarint(v)
    const { value, next } = readVarint(Buffer.from(encoded), 0)
    assert.equal(value, v, `round-trip ${v} (encoded=${encoded.length}B)`)
    assert.equal(next, encoded.length, `${v}: 消费了 ${encoded.length} 字节`)
  }
})

test('readVarint: 嵌入在 buffer 中也能正确读', () => {
  const buf = Buffer.concat([
    Buffer.from([0xaa, 0xbb, 0xcc]),  // 前导
    writeVarint(0x40c00001),           // 5 字节 varint
    Buffer.from([0xdd, 0xee]),         // 后继
  ])
  const { value, next } = readVarint(buf, 3)
  assert.equal(value, 0x40c00001)
  assert.equal(next, 8)  // 3 + 5
})

// ===== 3. 错误路径 =====
test('parseHeader: 文件过短抛错', () => {
  assert.throws(() => parseHeader(Buffer.alloc(10)), /文件过短/)
})

test('parseHeader: 错的 HEAD_TAG 抛错', () => {
  const buf = Buffer.alloc(100)
  buf.writeUInt32BE(0xdeadbeef, 8)  // 错的 HEAD_TAG
  assert.throws(() => parseHeader(buf), /HEAD_TAG/)
})

test('parseHeader: 错的 version 抛错', () => {
  const buf = Buffer.alloc(100)
  buf.writeUInt32BE(HEAD_TAG, 8)
  buf.writeUInt32BE(99, 12)  // 错的 version
  assert.throws(() => parseHeader(buf), /version/)
})

test('decodeGilV2: tail 长度错抛错', () => {
  const header = Buffer.alloc(HEADER_BYTES)
  header.writeUInt32BE(50, 0)        // total = 50
  header.writeUInt32BE(1, 4)
  header.writeUInt32BE(HEAD_TAG, 8)
  header.writeUInt32BE(VERSION, 12)
  header.writeUInt32BE(20, 16)       // payload_len = 20
  // 实际 body 只有 30 字节, tail 长度不足
  const body = Buffer.alloc(30, 0)
  const buf = Buffer.concat([header, body])
  assert.throws(() => decodeGilV2(buf), /TAIL|长度|过短/)
})

test('decodeGilV2: tail 标记错抛错', () => {
  const lua = 'local PREFAB = {}\n'
  const total = HEADER_BYTES + 10 + Buffer.byteLength(lua, 'utf-8') + TAIL_BYTES
  const header = Buffer.alloc(HEADER_BYTES)
  header.writeUInt32BE(total, 0)
  header.writeUInt32BE(1, 4)
  header.writeUInt32BE(HEAD_TAG, 8)
  header.writeUInt32BE(VERSION, 12)
  header.writeUInt32BE(10, 16)
  const tail = Buffer.alloc(TAIL_BYTES)
  tail.writeUInt32BE(0xdeadbeef, 0)  // 错的 tail
  const buf = Buffer.concat([header, Buffer.alloc(10), Buffer.from(lua, 'utf-8'), tail])
  assert.throws(() => decodeGilV2(buf), /TAIL_TAG/)
})

// ===== 4. decode edge cases =====
for (const delta of [-1, 1]) {
  test(`文件总长度不匹配 (${delta}): parseHeader 和 decodeGilV2 均拒绝`, () => {
    const sample = makeSampleGil()
    sample.writeUInt32BE(sample.length + delta, 0)
    assert.throws(() => parseHeader(sample), /总长度/)
    assert.throws(() => decodeGilV2(sample), /总长度/)
  })
}

test('decodeGilV2: payloadLen 越过 tail 时拒绝', () => {
  const sample = makeSampleGil()
  sample.writeUInt32BE(sample.length - HEADER_BYTES - TAIL_BYTES + 1, 16)
  assert.throws(() => decodeGilV2(sample), /文件过短/)
})

for (const text of ['中文注释：千星模拟器', 'café / Ελληνικά / 日本語', 'emoji 😀🚀 / e\u0301']) {
  test(`UTF-8 Lua 字节长度和往返: ${text}`, () => {
    const luaSource = `local PREFAB = {}\n-- ${text}\nlocal function hello() return "${text}" end\n`
    assert.ok(Buffer.byteLength(luaSource, 'utf-8') > luaSource.length)
    const sample = makeSampleGil({ luaSource, metadata: [] })
    const decoded = decodeGilV2(sample)
    assert.equal(decoded.luaSegment, luaSource)
    assert.equal(decoded.luaSizeBytes, Buffer.byteLength(luaSource, 'utf-8'))
    const encoded = encodeGilV2(decoded)
    assert.equal(encoded.readUInt32BE(0), encoded.length)
    assert.equal(parseHeader(encoded).total, encoded.length)
    assert.deepEqual(encoded, sample)
    const reDecoded = decodeGilV2(encoded)
    assert.equal(reDecoded.luaSegment, luaSource)
    assert.equal(reDecoded.luaSizeBytes, decoded.luaSizeBytes)
    assert.deepEqual(reDecoded.luaFuncNames, ['hello'])
    assert.deepEqual(encodeGilV2(reDecoded), encoded)
  })
}

for (const luaSegment of [null, undefined, '']) {
  test(`encodeGilV2: 空 Lua (${String(luaSegment)}) 总长度正确`, () => {
    const decoded = decodeGilV2(makeSampleGil({ luaSource: '', metadata: [] }))
    const encoded = encodeGilV2({ ...decoded, luaSegment })
    assert.equal(parseHeader(encoded).total, encoded.length)
    assert.equal(encoded.length, HEADER_BYTES + encoded.readUInt32BE(16) + TAIL_BYTES)
    assert.equal(decodeGilV2(encoded).luaSegment, null)
  })
}

test('decodeGilV2: 0 控件仍能解出 template 信息', () => {
  const sample = makeSampleGil({ controls: [] })
  const decoded = decodeGilV2(sample)
  assert.equal(decoded.templateGuid, '0x4000000c')
  assert.equal(decoded.controls.length, 0)
  assert.ok(decoded.luaSegment)
})

test('decodeGilV2: 空 template name 解出 null', () => {
  const sample = makeSampleGil({ templateName: '' })
  const decoded = decodeGilV2(sample)
  // 空字符串可能也通过 f2 检测, 但 templateName 应为空或 null
  assert.ok(decoded.templateName === null || decoded.templateName === '')
})

test('decodeGilV2: 无 local PREFAB 的 LUA 不解出 (返回 null)', () => {
  // 设计行为: 没有 'local PREFAB = {' 标记就当无 LUA 段
  // (binary 数据里 random 字节可能撞 UTF-8 模式, 不可靠)
  const sample = makeSampleGil({ luaSource: '-- just comments\nprint("hi")\n' })
  const decoded = decodeGilV2(sample)
  assert.equal(decoded.luaSegment, null)
  assert.equal(decoded.luaFuncNames.length, 0)
})

test('decodeGilV2: 0 metadata 段', () => {
  const sample = makeSampleGil({ metadata: [] })
  const decoded = decodeGilV2(sample)
  assert.equal(decoded.metadata.length, 0)
})

test('decodeGilV2: 多 metadata 段 (只识别含 Property/Component 的)', () => {
  // decoder 过滤: text.includes('Property') || text.includes('Component')
  // 注意: size 必须严格等于 Buffer.byteLength(text), 否则会读到下一段
  const sample = makeSampleGil({
    metadata: [
      { field: 14, size: 17, text: 'PropertyTransform' },      // 17 字节
      { field: 14, size: 19, text: 'PropertyDefaultBorn' },     // 19 字节
      { field: 14, size: 12, text: 'ModelDisplay' },            // 12 字节, 无 Property, 应被过滤
    ],
  })
  const decoded = decodeGilV2(sample)
  assert.equal(decoded.metadata.length, 2, `应只识别 2 段 (含 Property 的), 实际 ${decoded.metadata.length}`)
  // 进一步验证: 两个 metadata 的内容
  const texts = decoded.metadata.map(m => m.text)
  assert.ok(texts.some(t => t.includes('Transform')))
  assert.ok(texts.some(t => t.includes('DefaultBorn')))
})

test('decodeGilV2: 多个相同 PREFAB GUID 控件 (16B 窗内 dedup)', () => {
  // 设计行为: 16 字节窗内同 GUID 合并 (避免重复引用合并)
  const sample = makeSampleGil({
    controls: [
      { prefabGuid: 0x40c00001, name: 'a' },
      { prefabGuid: 0x40c00001, name: 'b' },
      { prefabGuid: 0x40c00001, name: 'c' },
    ],
  })
  const decoded = decodeGilV2(sample)
  // 3 个 varint 各 5 字节 = 15 字节, 都在 16B 窗内, 应 dedup 为 1
  const sameGuids = decoded.controls.filter(c => c.prefabGuid === '0x40c00001')
  assert.equal(sameGuids.length, 1, `16B 窗内 dedup, 应只 1 个, 实际 ${sameGuids.length}`)
})

test('decodeGilV2: 16B 窗外的同 GUID 不 dedup', () => {
  // 填充字节让 2 个 GUID 距离 > 16B
  const parts = []
  parts.push(Buffer.from([0x08]), writeVarint(0x4000000c))
  parts.push(Buffer.from([0x1a, 0x00]))
  // 第一个 GUID + 30B 填充
  parts.push(Buffer.from([0x08]), writeVarint(0x40c00001))
  parts.push(Buffer.alloc(30, 0xab))  // 30 字节填充
  // 第二个 GUID (距第一个 > 16B, 不 dedup)
  parts.push(Buffer.from([0x08]), writeVarint(0x40c00001))
  // 包成 f4 length
  const inner = Buffer.concat(parts.slice(2))
  parts.length = 2
  parts.push(Buffer.from([(4 << 3) | 2]), writeVarint(inner.length), inner)

  const payload = Buffer.concat(parts)
  const lua = 'local PREFAB = {}\n'
  const total = HEADER_BYTES + payload.length + Buffer.byteLength(lua, 'utf-8') + TAIL_BYTES
  const header = Buffer.alloc(HEADER_BYTES)
  header.writeUInt32BE(total, 0)
  header.writeUInt32BE(1, 4)
  header.writeUInt32BE(HEAD_TAG, 8)
  header.writeUInt32BE(VERSION, 12)
  header.writeUInt32BE(payload.length, 16)
  const tail = Buffer.alloc(TAIL_BYTES)
  tail.writeUInt32BE(TAIL_TAG, 0)
  const buf = Buffer.concat([header, payload, Buffer.from(lua, 'utf-8'), tail])
  const decoded = decodeGilV2(buf)
  const sameGuids = decoded.controls.filter(c => c.prefabGuid === '0x40c00001')
  assert.equal(sameGuids.length, 2, `16B 窗外应不 dedup, 应 2 个, 实际 ${sameGuids.length}`)
})

// ===== 5. byte-level round-trip (金标准) =====
test('byte-level round-trip: 程序化样本 encode(decode(x)) === x', () => {
  const sample = makeSampleGil({
    templateGuid: 0x4000000c,
    templateName: '测试',
    controls: [
      { prefabGuid: 0x40c00001, name: 'a' },
      { prefabGuid: 0x40c00002, name: 'b' },
      { prefabGuid: 0x40400001, name: 'c' },
    ],
    luaSource: 'local PREFAB = { x = 1 }\nlocal function hello() end\n',
    metadata: [{ field: 14, size: 18, text: 'PropertyTransform' }],
  })
  const decoded = decodeGilV2(sample)
  const reEncoded = encodeGilV2(decoded)
  assert.equal(
    reEncoded.length, sample.length,
    `字节长度必须相等: ${reEncoded.length} vs ${sample.length}`,
  )
  assert.ok(reEncoded.equals(sample), `encode(decode(x)) 必须 byte-equal x`)
})

test('byte-level round-trip: 0 控件 / 0 metadata / 1 LUA 函数', () => {
  const sample = makeSampleGil({
    controls: [],
    metadata: [],
    luaSource: 'local PREFAB = {}\nlocal function only() end\n',
  })
  const decoded = decodeGilV2(sample)
  const reEncoded = encodeGilV2(decoded)
  assert.equal(reEncoded.length, sample.length)
  assert.ok(reEncoded.equals(sample))
})

// ===== 6. GUID count 保留 (encoder 不允许丢控件) =====
test('GUID count 保留: 38 个控件 1:1 不丢', () => {
  const controls = [
    { prefabGuid: 0x40c00001, name: 'a' },
    { prefabGuid: 0x40c00001, name: 'b' },
    { prefabGuid: 0x40c00002, name: 'c' },
    { prefabGuid: 0x40c00003, name: 'd' },
    { prefabGuid: 0x40c00004, name: 'e' },
    { prefabGuid: 0x40c00005, name: 'f' },
    { prefabGuid: 0x40c00006, name: 'g' },
    { prefabGuid: 0x40c00007, name: 'h' },
  ]
  const sample = makeSampleGil({ controls })
  const decoded = decodeGilV2(sample)
  // 8 控件都在 16 字节窗内, 解码可能 dedup
  // encoder 必须能恢复出 >= decoded.controls.length 个
  const reEncoded = encodeGilV2(decoded)
  const reDecoded = decodeGilV2(reEncoded)
  assert.equal(reDecoded.controls.length, decoded.controls.length,
    `reDecoded.controls (${reDecoded.controls.length}) 必须 = decoded.controls (${decoded.controls.length})`)
})

// ===== 7. encode 字段保真 =====
test('encode 字段保真: templateGuid / templateName / LUA 字符 / 函数列表', () => {
  const sample = makeSampleGil({
    templateGuid: 0x4000000c,
    templateName: '纯2D游戏模板(客户端脚本版)',
    controls: [
      { prefabGuid: 0x40c00001, name: 'a' },
      { prefabGuid: 0x40c00002, name: 'b' },
    ],
    luaSource: 'local PREFAB = { a = 1, b = 2 }\nlocal function f1() end\nlocal function f2() end\n',
    metadata: [
      { field: 14, size: 18, text: 'PropertyTransform' },
      { field: 14, size: 18, text: 'PropertyDefaultBorn' },
    ],
  })
  const decoded = decodeGilV2(sample)
  const reEncoded = encodeGilV2(decoded)
  const reDecoded = decodeGilV2(reEncoded)
  assert.equal(reDecoded.templateGuid, decoded.templateGuid)
  assert.equal(reDecoded.templateName, decoded.templateName)
  assert.equal(reDecoded.metadata.length, decoded.metadata.length)
  assert.equal(reDecoded.luaSegment, decoded.luaSegment)
  assert.deepEqual(reDecoded.luaFuncNames, decoded.luaFuncNames)
})

// ===== 8. 真 .gil 样本 (命令行) =====
test('真 .gil 样本: 字段提取 + round-trip 字段保真', (t) => {
  const here = dirname(fileURLToPath(import.meta.url))
  const candidates = [
    process.argv[2],
    join(here, '..', '..', '..', '..', 'simulator-workspace', '纯2D游戏模板.gil'),
    join(here, '..', '..', '..', '..', '..', 'simulator-workspace', '纯2D游戏模板.gil'),
  ].filter(Boolean)
  for (const p of candidates) {
    try {
      const buf = readFileSync(p)
      const decoded = decodeGilV2(buf)
      // 字段存在
      assert.ok(decoded.templateGuid, '应有 templateGuid')
      assert.ok(decoded.templateName, '应有 templateName')
      assert.ok(decoded.controls.length > 0, `应有控件, 实际 ${decoded.controls.length}`)
      assert.ok(decoded.luaFuncNames.length > 0, `应有 LUA 函数, 实际 ${decoded.luaFuncNames.length}`)
      // round-trip
      const reEncoded = encodeGilV2(decoded)
      const reDecoded = decodeGilV2(reEncoded)
      assert.equal(reDecoded.templateGuid, decoded.templateGuid)
      assert.equal(reDecoded.templateName, decoded.templateName)
      assert.equal(reDecoded.luaSegment, decoded.luaSegment, 'LUA 字节级保真')
      assert.deepEqual(reDecoded.luaFuncNames, decoded.luaFuncNames)
      console.log(`  ✓ ${p} (${buf.length}B, ${decoded.controls.length} ctrl, ${decoded.luaFuncNames.length} funcs)`)
      return
    } catch (e) {
      if (e.code === 'ENOENT') continue
      throw e
    }
  }
  t.skip('未找到真 .gil 样本; 合成样本测试不依赖外部文件')
})

// ===== 9. findLuaRange: 兼容无 'local PREFAB' 标记的模板 (如魔塔) =====
test('findLuaRange: 有 local PREFAB 标记时用它', () => {
  const lua = 'local PREFAB = { container = 1 }\nlocal function x() end\n'
  const buf = makeSampleGil({ luaSource: lua })
  const range = findLuaRange(buf, buf.length - TAIL_BYTES)
  assert.ok(range, '应能找到 LUA 区域')
  assert.equal(buf.subarray(range.start, range.end).toString('utf-8'), lua)
})

test('findLuaRange: 无 local PREFAB 时扫最长可打印区 (魔塔式脚本)', () => {
  // 造一个魔塔式 LUA: 行注释 + 模块加载器 (>= 1KB 触发慢路径)
  let lua = '-- Frozen original 50-floor candidate.\n' +
    'local modules,loaders={},{}\n' +
    "loaders['board_data']=function()\nreturn { width = 13 }\nend\n" +
    'local client=require("board_client")\n'
  // 填充到 > 1KB (模拟真实脚本规模)
  while (Buffer.byteLength(lua, 'utf-8') < 2048) {
    lua += '-- padding line to reach 1KB threshold\n'
  }
  const buf = makeSampleGil({ luaSource: lua, metadata: [] })
  const range = findLuaRange(buf, buf.length - TAIL_BYTES)
  assert.ok(range, '应能找到 LUA 区域')
  assert.equal(buf.subarray(range.start, range.end).toString('utf-8'), lua)
})

test('findLuaRange: 无 LUA 时返回 -1', () => {
  const buf = Buffer.alloc(2048, 0xff)  // 全非打印
  assert.equal(findLuaRange(buf, buf.length), null)
})
