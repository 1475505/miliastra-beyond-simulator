// importGia_v2.mjs — 千星 .gil 字节 version=2 协议 Node 端 codec (2026-10-14)
//
// 跟 v1 codec.js 比:
//   - v1 用 protobufjs + GIA_PROTO 解析 (字节 version=3, GraphUnit 列表)
//   - v2 是 2 段式: 20B 头 + protobuf payload + 末尾 raw LUA + 4B tail
//   - LUA 段不是 protobuf 字段, 需用 regex 'local PREFAB = {' 定位
//   - 控件通过搜索 PREFAB GUIDs 的 varint 编码识别 (不在 protobufjs schema 里建模)
//
// 用法:
//   import { decodeGilV2, encodeGilV2 } from './importGia_v2.mjs'
//   const result = decodeGilV2(buffer)
//   console.log(result.controls, result.luaSegment)

import { Buffer } from 'node:buffer'

// ===== 协议常量 =====
export const HEADER_BYTES = 20
export const TAIL_BYTES = 4
export const HEAD_TAG = 0x00000326
export const TAIL_TAG = 0x00000679
export const VERSION = 2

// ===== v2 PREFAB 空间 (15 个, 跟 decoder_v2.py 同步) =====
export const V2_PREFAB = {
  0x40c00001: 'container',
  0x40c00002: 'text',
  0x40c00003: 'image',
  0x40c00004: 'cursor',
  0x40c00005: 'textWindow',
  0x40c00006: 'animation',
  0x40c00007: 'fullscreenAnimation',
  0x40c00008: 'presetButton',
  0x40c00009: 'keyHint',
  0x40c0000a: 'gridScroller',
  0x40c0000b: 'reference',
  0x40400001: 'server-container',
  0x40400002: 'server-container-2',
  0x41000001: 'role-template-character',
  0x41400001: 'entity-template-level',
}

// ===== Varint 编码 (protobuf wire format) =====
export function writeVarint(value) {
  const bytes = []
  while (value > 0x7f) {
    bytes.push((value & 0x7f) | 0x80)
    value >>>= 7
  }
  bytes.push(value & 0x7f)
  return Buffer.from(bytes)
}

export function readVarint(buf, i) {
  let val = 0
  let shift = 0
  const start = i
  while (i < buf.length) {
    const b = buf[i]
    val |= (b & 0x7f) << shift
    i++
    if ((b & 0x80) === 0) {
      return { value: val >>> 0, next: i }
    }
    shift += 7
    if (shift > 63) return { value: null, next: start }
  }
  return { value: null, next: start }
}

// ===== 头部解析 =====
export function parseHeader(buf) {
  if (buf.length < HEADER_BYTES + TAIL_BYTES) {
    throw new Error(`文件过短 (${buf.length} 字节)`)
  }
  const total = buf.readUInt32BE(0)
  const segs = buf.readUInt32BE(4)
  const headTag = buf.readUInt32BE(8)
  const version = buf.readUInt32BE(12)
  const payloadLen = buf.readUInt32BE(16)
  if (headTag !== HEAD_TAG) {
    throw new Error(`HEAD_TAG 不匹配: 0x${headTag.toString(16)}`)
  }
  if (version !== VERSION) {
    throw new Error(`不是 v2 协议: version=${version}`)
  }
  // header.total 接受两种约定:
  //   - 真实 .gil: total = HEADER (20) + payloadLen (TAIL 隐式追加 4 字节)
  //   - 合成样本 (GPT patch 风格): total = 整个文件大小 (含 LUA + TAIL)
  // 任何一种都通过, 都不符合则抛错
  if (total !== buf.length && total + TAIL_BYTES !== buf.length) {
    throw new Error(`文件总长度不匹配: header.total=${total} (期望 ${buf.length} 或 ${buf.length - TAIL_BYTES}), 实际 ${buf.length}`)
  }
  return { total, segs, headTag, version, payloadLen, headerBytes: HEADER_BYTES }
}

// ===== 主解码 =====
export function decodeGilV2(buf) {
  const header = parseHeader(buf)
  // 校验 payload 边界 (总长度已由 parseHeader 校验, 中间可含 LUA 段)
  if (buf.length < HEADER_BYTES + header.payloadLen + TAIL_BYTES) {
    throw new Error(`文件过短: ${buf.length} 字节 < 最小 ${HEADER_BYTES + header.payloadLen + TAIL_BYTES}`)
  }
  const payload = buf.subarray(HEADER_BYTES, HEADER_BYTES + header.payloadLen)

  const result = {
    header,
    templateGuid: null,
    templateName: null,
    controls: [],
    metadata: [],
    luaSegment: null,
    luaSizeBytes: 0,
    luaTextOffset: 0,
    luaFuncNames: [],
  }

  // 1. 解 protobuf 段 (宽松 walker: 跳过未识别的 wire type)
  const fieldCount = {}
  let i = 0
  while (i < payload.length) {
    if (i >= payload.length) break
    const tag = payload[i]
    i++
    const f = tag >> 3
    const w = tag & 7
    fieldCount[`${f},${w}`] = (fieldCount[`${f},${w}`] || 0) + 1
    if (w === 0) {
      const { value, next } = readVarint(payload, i)
      if (value === null) break
      i = next
      if (f === 1 && value >= 0x40000000 && value <= 0x41ffffff && result.templateGuid === null) {
        result.templateGuid = `0x${value.toString(16).padStart(8, '0')}`
      }
    } else if (w === 2) {
      const { value: l, next: j } = readVarint(payload, i)
      if (l === null) break
      i = j
      const c2 = payload.subarray(i, i + l)
      i += l
      if (f === 2 && l >= 1 && l <= 100 && c2.length) {
        const s = c2.toString('utf-8')
        if (/[\u4e00-\u9fff]/.test(s) || /[a-zA-Z]/.test(s)) {
          if (result.templateName === null) result.templateName = s
        }
      } else if (f === 14 && l >= 5 && l <= 500 && c2.length) {
        const text = c2.toString('utf-8', 0, Math.min(200, l))
        if (text.includes('Property') || text.includes('Component')) {
          result.metadata.push({ field: f, size: l, text })
        }
      }
    } else if (w === 1) i += 8
    else if (w === 5) i += 4
    else break
  }
  result.allFieldSummary = fieldCount

  // 2. 控件识别: 在 payload 里搜 V2_PREFAB GUIDs 的 varint 编码 (前置 0x08 标记 f1 varint)
  const controls = []
  for (const [guidInt, name] of Object.entries(V2_PREFAB)) {
    const encoded = writeVarint(Number(guidInt))
    let from = 0
    while (from < payload.length) {
      const idx = payload.indexOf(encoded, from)
      if (idx === -1) break
      from = idx + encoded.length
      if (idx > 0 && payload[idx - 1] === 0x08) {
        controls.push({
          name,
          prefabGuid: `0x${Number(guidInt).toString(16).padStart(8, '0')}`,
          offset: idx,
        })
      }
    }
  }
  controls.sort((a, b) => a.offset - b.offset)
  // 16 字节窗内同 GUID 合并
  const deduped = []
  for (const c of controls) {
    const last = deduped[deduped.length - 1]
    if (last && c.offset - last.offset < 16 && c.prefabGuid === last.prefabGuid) continue
    deduped.push(c)
  }
  result.controls = deduped

  // 3. LUA 段: regex 'local PREFAB = {' 定位, 到 4B tail 前
  //    关键: tail 在文件最后 4B, 不是 payload 末尾 4B (payload 和 tail 之间还有 LUA 段)
  const tailOffset = buf.length - TAIL_BYTES
  const tailTag = buf.readUInt32BE(tailOffset)
  if (tailTag !== TAIL_TAG) {
    throw new Error(`TAIL_TAG 不匹配: 0x${tailTag.toString(16)} (期望 0x${TAIL_TAG.toString(16)})`)
  }
  const luaStart = buf.indexOf('local PREFAB = {')
  if (luaStart >= 0 && luaStart < tailOffset) {
    const luaBytes = buf.subarray(luaStart, tailOffset)
    const luaText = luaBytes.toString('utf-8')
    const funcMatches = luaText.matchAll(/local\s+function\s+(\w+)/g)
    result.luaSegment = luaText
    result.luaSizeBytes = tailOffset - luaStart
    result.luaTextOffset = luaStart
    result.luaFuncNames = [...funcMatches].map(m => m[1])
  }

  return result
}

// ===== 主编码 (用于 round-trip 测试) =====
export function encodeGilV2(decoded) {
  // 1. 重建 protobuf payload
  //    a) f1 varint (template_guid)
  //    b) f2 length (template_name)
  //    c) f3 length 0
  //    d) f4..f15 length (控件 PREFAB GUIDs, 用 f1 varint 写每个控件)
  //    e) f14 metadata (每段一个)
  const parts = []
  // a) f1 varint (template_guid)
  const guidNum = parseInt(decoded.templateGuid, 16)
  parts.push(Buffer.from([0x08]))  // tag f1 w0
  parts.push(writeVarint(guidNum))
  // b) f2 length (template_name)
  if (decoded.templateName) {
    const nameBytes = Buffer.from(decoded.templateName, 'utf-8')
    parts.push(Buffer.from([0x12]))  // tag f2 w2
    parts.push(writeVarint(nameBytes.length))
    parts.push(nameBytes)
  }
  // c) f3 length 0
  parts.push(Buffer.from([0x1a, 0x00]))
  // d) 控件: 把每个控件的 PREFAB GUID 包装在 f4 length 子消息里 (内含 f1 varint)
  //    简化做法: 把所有 controls 拼成一个大 f4 length 段, 每个控件是 f1 varint
  if (decoded.controls && decoded.controls.length) {
    const ctrlBody = []
    for (const c of decoded.controls) {
      ctrlBody.push(Buffer.from([0x08]))  // tag f1 w0
      ctrlBody.push(writeVarint(parseInt(c.prefabGuid, 16)))
    }
    const ctrlBuf = Buffer.concat(ctrlBody)
    parts.push(Buffer.from([(4 << 3) | 2]))  // tag f4 w2
    parts.push(writeVarint(ctrlBuf.length))
    parts.push(ctrlBuf)
  }
  // e) f14 metadata (每段一个)
  for (const m of decoded.metadata) {
    parts.push(Buffer.from([(14 << 3) | 2]))
    parts.push(writeVarint(m.size))
    parts.push(Buffer.from(m.text, 'utf-8').subarray(0, m.size))
  }
  const payload = Buffer.concat(parts)
  // UTF-8 字节数可能不同于字符串长度; 计算头部和写入时复用同一份字节
  const luaBytes = decoded.luaSegment ? Buffer.from(decoded.luaSegment, 'utf-8') : Buffer.alloc(0)
  // 2. 头
  const totalSize = HEADER_BYTES + payload.length + luaBytes.length + TAIL_BYTES
  const header = Buffer.alloc(HEADER_BYTES)
  header.writeUInt32BE(totalSize, 0)
  header.writeUInt32BE(1, 4)            // segs
  header.writeUInt32BE(HEAD_TAG, 8)
  header.writeUInt32BE(VERSION, 12)
  header.writeUInt32BE(payload.length, 16)
  // 3. tail
  const tail = Buffer.alloc(TAIL_BYTES)
  tail.writeUInt32BE(TAIL_TAG, 0)
  // 4. 拼接文件 (LUA 在 payload 和 tail 之间)
  return Buffer.concat([header, payload, luaBytes, tail])
}

// ===== CLI (only when invoked as main script) =====
if (process.argv[1] && import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`) {
  import('node:fs').then(fs => {
    const path = process.argv[2]
    if (!path) {
      console.error('usage: node importGia_v2.mjs <file.gil>')
      process.exit(1)
    }
    const buf = fs.readFileSync(path)
    const result = decodeGilV2(buf)
    console.log(`=== ${path} 字节 version=2 解码 ===`)
    console.log(`Header: ${JSON.stringify(result.header)}`)
    console.log(`\n模板 GUID: ${result.templateGuid}`)
    console.log(`模板名: ${JSON.stringify(result.templateName)}`)
    console.log(`\n控件数: ${result.controls.length}`)
    for (const c of result.controls) {
      console.log(`  PREFAB=${c.prefabGuid} (${c.name})  offset=${c.offset}`)
    }
    console.log(`\n元数据: ${result.metadata.length} 段`)
    for (const m of result.metadata) {
      console.log(`  field ${m.field} (${m.size}B): ${JSON.stringify(m.text.slice(0, 80))}`)
    }
    if (result.luaSegment) {
      console.log(`\nLUA 源码段: ${result.luaSegment.length} 字符 (offset ${result.luaTextOffset}, ${result.luaSizeBytes}B), ${result.luaFuncNames.length} 个 local function`)
      for (const fn of result.luaFuncNames) {
        console.log(`  - ${fn}`)
      }
    }
  })
}
