# v2 .gil codec (千星 .gil 字节 version=2)

## 跟 v1 codec.js 的区别

| 项目 | v1 (`../codec.js`) | v2 (本目录) |
|---|---|---|
| 协议 | 字节 version=3 | 字节 version=2 |
| 结构 | 单一 protobuf (GraphUnit 列表) | **2 段式**: 20B 头 + protobuf payload + 末尾 raw LUA + 4B tail |
| LUA | 嵌入在 protobuf 里 (`ScriptMapping.source`) | 文件末尾追加的 UTF-8 段 (regex `local PREFAB = {` 定位) |
| 控件 GUID | protobufjs + GIA_PROTO schema | 字节搜索 PREFAB GUID 的 varint 编码 |
| PREFAB 空间 | 多种 (按 GraphUnit 解析) | 15 个已知: 0x40c00001-0x40c0000b (11 client) + 0x40400001-0x40400002 (2 server) + 0x41000001 + 0x41400001 |

## 文件

- `codec.js` — decode + encode 主模块
- `codec.test.mjs` — node:test 单元 + round-trip 测试

## 用法

```js
import { decodeGilV2, encodeGilV2 } from './studio/gia/v2/codec.js'
import { readFileSync } from 'node:fs'

const buf = readFileSync('xxx.gil')
const decoded = decodeGilV2(buf)
console.log(decoded.templateGuid)    // '0x4000000c'
console.log(decoded.templateName)    // '纯2D游戏模板(客户端脚本版)'
console.log(decoded.controls)        // [{ prefabGuid, name, offset }]
console.log(decoded.metadata)        // [{ field, size, text }]
console.log(decoded.luaSegment)      // 完整 LUA 源码
console.log(decoded.luaFuncNames)    // ['rect', 'container', ...]

// round-trip
const reEncoded = encodeGilV2(decoded)
const reDecoded = decodeGilV2(reEncoded)
// 13 unique GUIDs + LUA 完全一致
```

## 测试

```bash
node --test studio/gia/v2/codec.test.mjs
```

## 逆向依据

`simulator-workspace/纯2D游戏模板.gil` (159553 字节, 1 个 v2 .gil 样本)

实测:
- 38 控件 (13 unique PREFAB)
- 2 metadata 段
- 28 LUA 函数 (rect/container/image/text/button/...)
- round-trip 13 unique GUIDs + 14760 字符 LUA 全一致
