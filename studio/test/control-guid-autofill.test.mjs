import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createStudio, importGia } from '../index.js'
import { createNode, findNode } from '../ui/authoring.js'

const CLIENT = 'client-control-template'
const O = 1073741900
const N = 1073741920
const n = (id, guid, children = []) => createNode('container', { id, name: id, guid, children })
function fixture() {
  const seed = createStudio().archiveData()
  // Deliberately non-sorted GUIDs and two nested siblings. Expected native order
  // is A, back, rig, right, left, B, C; independent roots must not reverse.
  seed.assets.client.root.children = [n('A', O, [n('rig', O + 5, [n('left', O + 2), n('right', O + 4)]), n('back', O + 1)]), n('B', O + 3), n('C', O + 6)]
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
  const result = studio.patch({ op: 'setControlGuid', guid: N + 3, autoFillClientGuids: true, expectedRevision: studio.get().version })
  assert.deepEqual(values(studio), [N, N + 1, N + 2, N + 3, N + 4, N + 5, N + 6])
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
  assert.deepEqual(imported.root.children.map(n => n.guid), [N, N + 5, N + 6])
})

test('overlapping permutation updates explicit references once; Lua and image IDs stay unchanged', () => {
  const seed = fixture()
  const ref = findNode(seed.assets.server.root, 'n4')
  ref.referencedPrefabId = String(O + 5)
  ref.giaRaw.templateRefSlot = O + 2
  findNode(seed.assets.server.root, 'n5').itemPrefabId = O + 4
  findNode(seed.assets.server.root, 'n9').imageId = O + 5
  seed.assets.scripts = [{ guid: O + 7, id: String(O + 7), path: 'test.lua', source: `return {${O + 5},${O + 2},${O + 4}}`, controlId: 'A', controlAsset: CLIENT }]
  const studio = createStudio(seed)
  studio.patch({ op: 'setControlGuid', id: 'A', guid: O, autoFillClientGuids: true })
  assert.deepEqual(values(studio), [O, O + 1, O + 2, O + 3, O + 4, O + 5, O + 6])
  const after = studio.archiveData()
  assert.equal(findNode(after.assets.server.root, 'n4').referencedPrefabId, String(O + 2))
  assert.equal(findNode(after.assets.server.root, 'n4').giaRaw.templateRefSlot, String(O + 4))
  assert.equal(findNode(after.assets.server.root, 'n5').itemPrefabId, O + 3)
  assert.equal(findNode(after.assets.server.root, 'n9').imageId, O + 5)
  assert.deepEqual(after.assets.scripts, createStudio(seed).archiveData().assets.scripts)
  const revision = studio.get().version
  studio.patch({ op: 'setControlGuid', id: 'A', guid: O, autoFillClientGuids: true })
  assert.equal(studio.get().version, revision, 'fully calibrated batch is a no-op')
})

test('invalid interval, occupied external GUID, wrong asset and stale revision cannot partially fill', () => {
  const seed = fixture()
  seed.assets.scripts = [{ guid: N + 5, id: String(N + 5), path: 'collision.lua', source: '-- keep' }]
  const studio = createStudio(seed)
  const before = studio.archiveData(), revision = studio.get().version
  for (const guid of [1073741824, 1077936127, N + 3, seed.assets.server.root.guid + 3]) {
    assert.throws(() => studio.patch({ op: 'setControlGuid', id: 'right', guid, autoFillClientGuids: true }), /整数|占用/)
    assert.deepEqual(studio.archiveData(), before)
  }
  assert.throws(() => studio.patch({ op: 'setControlGuid', id: 'A', guid: N + 3, autoFillClientGuids: 'true' }), /布尔/)
  assert.throws(() => studio.patch({ op: 'setControlGuid', id: 'A', guid: N + 3, autoFillClientGuids: true, expectedRevision: revision - 1 }), /revision conflict/)
  assert.deepEqual(studio.archiveData(), before)
  studio.patch({ op: 'selectAsset', assetType: 'server-control-template' })
  assert.equal(studio.get().clientGuidAutofill, undefined)
  assert.throws(() => studio.patch({ op: 'setControlGuid', id: 'n1', guid: N + 3, autoFillClientGuids: true }), /仅支持客户端模板/)
})
