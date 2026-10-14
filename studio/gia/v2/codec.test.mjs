// test-roundtrip.mjs — 验 v2 .gil codec decode -> encode -> decode 一致性 (2026-10-14)
//
// 用法:
//   node studio/gia/v2/test-roundtrip.mjs
//   node studio/gia/v2/test-roundtrip.mjs <file.gil>
//
// 不传文件时跑程序化构造的样本 (不依赖外部 .gil), 传文件则用真实样本验证.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  HEADER_BYTES, TAIL_BYTES, HEAD_TAG, TAIL_TAG, VERSION,
  V2_PREFAB,
  writeVarint, decodeGilV2, encodeGilV2,
} from './codec.js'

// ===== 构造最小 v2 .gil 测试样本 =====
function makeSampleGil({
  templateGuid = 0x4000000c,
  templateName = '测试模板',
  controls = [{ prefabGuid: 0x40c00001, name: 'container' }],
  luaSource = 'local PREFAB = { container = 1073742025 }\nlocal function test() end\n',
  metadata = [{ field: 14, size: 18, text: 'PropertyTransform' }],
} = {}) {
  const parts = []
  // f1 varint
  parts.push(Buffer.from([0x08]), writeVarint(templateGuid))
  // f2 length
  if (templateName) {
    const nameBytes = Buffer.from(templateName, 'utf-8')
    parts.push(Buffer.from([0x12]), writeVarint(nameBytes.length), nameBytes)
  }
  // f3 length 0
  parts.push(Buffer.from([0x1a, 0x00]))
  // f4 length with controls (each control = f1 varint PREFAB GUID)
  const ctrlBody = []
  for (const c of controls) {
    ctrlBody.push(Buffer.from([0x08]), writeVarint(c.prefabGuid))
  }
  if (ctrlBody.length) {
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

test('V2_PREFAB 表有 15 个 PREFAB 空间', () => {
  assert.equal(Object.keys(V2_PREFAB).length, 15)
  assert.equal(V2_PREFAB[0x40c00001], 'container')
  assert.equal(V2_PREFAB[0x40c00009], 'keyHint')
  assert.equal(V2_PREFAB[0x40400001], 'server-container')
  assert.equal(V2_PREFAB[0x41000001], 'role-template-character')
  assert.equal(V2_PREFAB[0x41400001], 'entity-template-level')
})

test('writeVarint 编码小数字', () => {
  assert.deepEqual([...writeVarint(0)], [0])
  assert.deepEqual([...writeVarint(1)], [1])
  assert.deepEqual([...writeVarint(127)], [127])
  assert.deepEqual([...writeVarint(128)], [0x80, 0x01])
  // 0x40c00001 = 1086324737
  // 7-bit groups LSB-first: 0x01 0x00 0x00 0x06 0x04
  assert.deepEqual([...writeVarint(0x40c00001)], [0x81, 0x80, 0x80, 0x86, 0x04])
})

test('程序化样本 round-trip 全字段一致', () => {
  const sample = makeSampleGil({
    templateGuid: 0x4000000c,
    templateName: '测试模板',
    controls: [
      { prefabGuid: 0x40c00001, name: 'container' },
      { prefabGuid: 0x40c00002, name: 'text' },
      { prefabGuid: 0x40400001, name: 'server-container' },
    ],
    luaSource: 'local PREFAB = { container = 1073742025, text = 1073742026 }\nlocal function hello() end\n',
    metadata: [{ field: 14, size: 18, text: 'PropertyTransform' }],
  })
  const decoded = decodeGilV2(sample)
  assert.equal(decoded.templateGuid, '0x4000000c')
  assert.equal(decoded.templateName, '测试模板')
  assert.equal(decoded.controls.length, 3)
  assert.equal(decoded.metadata.length, 1)
  assert.equal(decoded.luaFuncNames.length, 1)
  assert.equal(decoded.luaFuncNames[0], 'hello')
  assert.equal(decoded.luaSegment.includes('local PREFAB'), true)

  const reEncoded = encodeGilV2(decoded)
  const reDecoded = decodeGilV2(reEncoded)
  assert.equal(reDecoded.templateGuid, decoded.templateGuid)
  assert.equal(reDecoded.templateName, decoded.templateName)
  const origGuids = new Set(decoded.controls.map(c => c.prefabGuid))
  const reGuids = new Set(reDecoded.controls.map(c => c.prefabGuid))
  assert.deepEqual([...reGuids].sort(), [...origGuids].sort())
  assert.equal(reDecoded.luaSegment, decoded.luaSegment)
  assert.deepEqual(reDecoded.luaFuncNames, decoded.luaFuncNames)
})

// ===== 真实文件测试 (如果有命令行参数) =====
const here = dirname(fileURLToPath(import.meta.url))
const candidatePaths = [
  process.argv[2],
  join(here, '..', '..', '..', '..', 'simulator-workspace', '纯2D游戏模板.gil'),
  join(here, '..', '..', '..', '..', '..', 'simulator-workspace', '纯2D游戏模板.gil'),
]
for (const p of candidatePaths) {
  if (!p) continue
  try {
    const buf = readFileSync(p)
    console.log(`\n=== 真实样本: ${p} (${buf.length} 字节) ===`)
    const decoded = decodeGilV2(buf)
    console.log(`  templateGuid: ${decoded.templateGuid}`)
    console.log(`  templateName: ${decoded.templateName}`)
    console.log(`  controls: ${decoded.controls.length} (${new Set(decoded.controls.map(c => c.prefabGuid)).size} unique)`)
    console.log(`  metadata: ${decoded.metadata.length} 段`)
    console.log(`  luaSegment: ${decoded.luaSegment.length} 字符 / ${decoded.luaFuncNames.length} 函数`)
    const reEncoded = encodeGilV2(decoded)
    const reDecoded = decodeGilV2(reEncoded)
    const origGuids = new Set(decoded.controls.map(c => c.prefabGuid))
    const reGuids = new Set(reDecoded.controls.map(c => c.prefabGuid))
    console.log(`  round-trip: ${[...origGuids].every(g => reGuids.has(g)) ? '✓' : '✗'} unique GUIDs 一致`)
    console.log(`  round-trip: ${reDecoded.luaSegment === decoded.luaSegment ? '✓' : '✗'} LUA 一致`)
    break
  } catch (e) {
    continue
  }
}
