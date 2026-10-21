import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createStudio, importGia } from '../index.js'
import { GUID_MAX, GUID_MIN, isValidGuid } from '../gia/guid.js'

test('isValidGuid 只接受真机控件索引区间 0x40000000–0x403FFFFF', () => {
  assert.equal(GUID_MIN, 1073741824)
  assert.equal(GUID_MAX, 1077936127)
  for (const value of [GUID_MIN, GUID_MIN + 1, 1073741860, GUID_MAX]) {
    assert.equal(isValidGuid(value), true, String(value))
  }
  for (const value of [0, 1, 303, 1001, GUID_MIN - 1, GUID_MAX + 1, 0x7fffffff, 1.5, '1001', NaN, Infinity]) {
    assert.equal(isValidGuid(value), false, String(value))
  }
})

test('导出会把旧存档里低于基址的控件索引重编号到真机区间', () => {
  const save = createStudio().archiveData()
  // 模拟历史存档：服务端与客户端模板控件都使用 1001 起的小索引
  let next = 1001
  const stamp = (node) => {
    node.guid = next++
    for (const child of node.children || []) stamp(child)
  }
  stamp(save.assets.server.root)
  for (const child of save.assets.client.root.children || []) stamp(child)

  const loaded = createStudio(save)
  const packed = loaded.exportData('gia-combined')
  const project = importGia(Buffer.from(packed.data, 'base64')).project
  const guids = []
  const collect = (node) => {
    if (!node) return
    const guid = Number(node.guid)
    if (guid > 0) guids.push(guid)
    for (const child of node.children || []) collect(child)
  }
  collect(project.server?.root)
  collect(project.root)
  assert.ok(guids.length > 0)
  for (const guid of guids) assert.ok(isValidGuid(guid), `重编号后仍非法：${guid}`)
})

test('setControlGuid 拒绝区间外的控件索引', () => {
  const studio = createStudio()
  studio.patch({ op: 'selectAsset', assetType: 'client-control-template' })
  for (const guid of [1, 1001, GUID_MIN - 1, GUID_MAX + 1, 2147483647]) {
    assert.throws(() => studio.patch({ op: 'setControlGuid', id: 'n1', guid }), /控件索引必须是/)
  }
})
