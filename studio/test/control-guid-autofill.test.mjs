import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createStudio, importGia } from '../index.js'
import { createNode, findNode } from '../ui/authoring.js'

const CLIENT = 'client-control-template'
const n = (id, guid, children = []) => createNode('container', { id, name: id, guid, children })
function fixture() {
  const seed = createStudio().archiveData()
  // Deliberately non-sorted GUIDs and two nested siblings. Expected native order
  // is A, back, rig, right, left, B, C; independent roots must not reverse.
  seed.assets.client.root.children = [n('A', 100, [n('rig', 105, [n('left', 102), n('right', 104)]), n('back', 101)]), n('B', 103), n('C', 106)]
  seed.assets.client.selectedId = 'right'
  seed.activeAssetType = CLIENT
  return seed
}
const ids = ['A', 'back', 'rig', 'right', 'left', 'B', 'C']
const values = studio => ids.map(id => findNode(studio.archiveData().assets.client.root, id).guid)

test('any nested anchor fills native preorder across templates, preserves artwork and records one batch', () => {
  const studio = createStudio(fixture())
  const before = studio.archiveData()
  assert.deepEqual(studio.get().clientGuidAutofill, { count: 7, templateCount: 3, selectedOffset: 3 })
  const result = studio.patch({ op: 'setControlGuid', guid: 203, autoFillClientGuids: true, expectedRevision: studio.get().version })
  assert.deepEqual(values(studio), [200, 201, 202, 203, 204, 205, 206])
  assert.equal(result.controlGuidChanges.length, 7)
  assert.equal(new Set(result.controlGuidChanges.map(c => c.batchId)).size, 1)
  assert.ok(result.controlGuidChanges[0].batchId)
  assert.deepEqual(result.controlGuidChanges.map(c => c.controlId), ids)
  const after = studio.archiveData()
  assert.deepEqual(after.assets.server, before.assets.server)
  assert.deepEqual(after.assets.scripts, before.assets.scripts)
  for (const id of ids) findNode(after.assets.client.root, id).guid = findNode(before.assets.client.root, id).guid
  assert.deepEqual(after.assets.client.root, before.assets.client.root)
  const loaded = createStudio(studio.archiveData())
  assert.deepEqual(loaded.get().controlGuidChanges, result.controlGuidChanges)
  assert.deepEqual(values(loaded), values(studio))
  const imported = importGia(Buffer.from(studio.exportData('gia', CLIENT).data, 'base64')).project
  assert.deepEqual(imported.root.children.map(n => n.guid), [200, 205, 206])
})

test('overlapping permutation updates explicit references once; Lua and image IDs stay unchanged', () => {
  const seed = fixture()
  const ref = findNode(seed.assets.server.root, 'n4')
  ref.referencedPrefabId = '105'
  ref.giaRaw.templateRefSlot = 102
  findNode(seed.assets.server.root, 'n5').itemPrefabId = 104
  findNode(seed.assets.server.root, 'n9').imageId = 105
  seed.assets.scripts = [{ guid: 99999, id: '99999', path: 'test.lua', source: 'return {105,102,104}', controlId: 'A', controlAsset: CLIENT }]
  const studio = createStudio(seed)
  studio.patch({ op: 'setControlGuid', id: 'A', guid: 100, autoFillClientGuids: true })
  assert.deepEqual(values(studio), [100, 101, 102, 103, 104, 105, 106])
  const after = studio.archiveData()
  assert.equal(findNode(after.assets.server.root, 'n4').referencedPrefabId, '102')
  assert.equal(findNode(after.assets.server.root, 'n4').giaRaw.templateRefSlot, '104')
  assert.equal(findNode(after.assets.server.root, 'n5').itemPrefabId, 103)
  assert.equal(findNode(after.assets.server.root, 'n9').imageId, 105)
  assert.deepEqual(after.assets.scripts, createStudio(seed).archiveData().assets.scripts)
  const revision = studio.get().version
  studio.patch({ op: 'setControlGuid', id: 'A', guid: 100, autoFillClientGuids: true })
  assert.equal(studio.get().version, revision, 'fully calibrated batch is a no-op')
})

test('invalid interval, occupied external GUID, wrong asset and stale revision cannot partially fill', () => {
  const seed = fixture()
  seed.assets.scripts = [{ guid: 305, id: '305', path: 'collision.lua', source: '-- keep' }]
  const studio = createStudio(seed)
  const before = studio.archiveData(), revision = studio.get().version
  for (const guid of [1, 2147483647, 303, seed.assets.server.root.guid + 3]) {
    assert.throws(() => studio.patch({ op: 'setControlGuid', id: 'right', guid, autoFillClientGuids: true }), /整数|占用/)
    assert.deepEqual(studio.archiveData(), before)
  }
  assert.throws(() => studio.patch({ op: 'setControlGuid', id: 'A', guid: 200, autoFillClientGuids: 'true' }), /布尔/)
  assert.throws(() => studio.patch({ op: 'setControlGuid', id: 'A', guid: 200, autoFillClientGuids: true, expectedRevision: revision - 1 }), /revision conflict/)
  assert.deepEqual(studio.archiveData(), before)
  studio.patch({ op: 'selectAsset', assetType: 'server-control-template' })
  assert.equal(studio.get().clientGuidAutofill, undefined)
  assert.throws(() => studio.patch({ op: 'setControlGuid', id: 'n1', guid: 200, autoFillClientGuids: true }), /仅支持客户端模板/)
})
