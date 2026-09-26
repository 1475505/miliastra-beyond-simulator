import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createStudio, importGia } from '../index.js'
import { findNode } from '../ui/authoring.js'

const SERVER = 'server-control-template'
const CLIENT = 'client-control-template'
const node = (studio, id, asset = 'server') => findNode(studio.archiveData().assets[asset].root, id)
const base64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64')

test('control GUID edit preserves internal ids, selection, parent and script/button mounts', () => {
  const seed = createStudio().archiveData()
  const target = findNode(seed.assets.server.root, 'n2')
  const oldGuid = target.guid
  target.id = String(oldGuid)
  seed.assets.server.selectedId = target.id
  const button = findNode(seed.assets.server.root, 'n6')
  const parent = seed.assets.server.root.children[0]
  parent.children = parent.children.filter((child) => child !== target)
  button.children.push(target)
  button.pressedChildId = target.id
  findNode(seed.assets.server.root, 'n9').imageId = oldGuid
  const studio = createStudio(seed)
  studio.patch({ op: 'addScript', path: 'main.lua', source: `local unrelated = ${oldGuid}`, controlId: target.id, controlAsset: SERVER })
  const before = studio.get()
  const result = studio.patch({ op: 'setControlGuid', guid: '19001', expectedRevision: before.version })
  assert.equal(result.version, before.version + 1)
  assert.equal(result.selectedId, target.id)
  assert.equal(node(studio, target.id).guid, 19001)
  assert.equal(node(studio, 'n6').pressedChildId, target.id)
  assert.equal(node(studio, 'n6').children[0].id, target.id)
  assert.equal(node(studio, 'n9').imageId, oldGuid)
  assert.deepEqual(result.scripts, before.scripts)
  assert.deepEqual(result.controlGuidChanges.map(({ id, ...entry }) => entry), [{
    controlAsset: SERVER, controlId: target.id, controlName: target.name, oldGuid, newGuid: 19001,
  }])
  assert.equal(typeof result.controlGuidChanges[0].id, 'string')
})

test('invalid, occupied and stale GUID edits are atomic; unchanged index is a no-op', () => {
  const studio = createStudio()
  const script = studio.patch({ op: 'addScript', path: 'main.lua', source: '-- script' }).scripts[0]
  const before = studio.archiveData()
  const revision = studio.get().version
  for (const value of ['', ' ', true, false, null, undefined, 0, -1, 1.5, '1.5', '1e3', '0x10', NaN, Infinity, 2147483648]) {
    assert.throws(() => studio.patch({ op: 'setControlGuid', id: 'n2', guid: value }), /整数/)
    assert.deepEqual(studio.archiveData(), before)
  }
  for (const value of [node(studio, 'n3').guid, node(studio, 'n1', 'client').guid, script.guid]) {
    assert.throws(() => studio.patch({ op: 'setControlGuid', id: 'n2', guid: value }), /占用/)
    assert.deepEqual(studio.archiveData(), before)
  }
  for (const id of ['sc1', 'missing']) assert.throws(() => studio.patch({ op: 'setControlGuid', id, guid: 19001 }), /仅客户端/)
  assert.throws(() => studio.patch({ op: 'setControlGuid', id: 'n2', guid: 19001, expectedRevision: revision - 1 }), /revision conflict/)
  assert.deepEqual(studio.archiveData(), before)
  assert.equal(studio.patch({ op: 'setControlGuid', id: 'n2', guid: node(studio, 'n2').guid }).version, revision)
  assert.deepEqual(studio.archiveData(), before)
  studio.patch({ op: 'setControlGuid', id: 'n2', guid: 1 })
  studio.patch({ op: 'setControlGuid', id: 'n2', guid: 2147483647 })
  assert.equal(node(studio, 'n2').guid, 2147483647)
})

test('explicit numeric template references follow GUID edits across both assets', () => {
  const seed = createStudio().archiveData()
  const oldGuid = findNode(seed.assets.client.root, 'n1').guid
  const reference = findNode(seed.assets.server.root, 'n4')
  reference.referencedPrefabId = oldGuid
  reference.giaRaw.templateRefSlot = String(oldGuid)
  findNode(seed.assets.server.root, 'n5').itemPrefabId = String(oldGuid)
  findNode(seed.assets.server.root, 'n10').animationId = String(oldGuid)
  const studio = createStudio(seed)
  const serverVersion = studio.get().version
  studio.patch({ op: 'selectAsset', assetType: CLIENT })
  studio.patch({ op: 'setControlGuid', id: 'n1', guid: 19002 })
  assert.equal(node(studio, 'n4').referencedPrefabId, 19002)
  assert.equal(node(studio, 'n4').giaRaw.templateRefSlot, '19002')
  assert.equal(node(studio, 'n5').itemPrefabId, '19002')
  assert.equal(node(studio, 'n10').animationId, String(oldGuid))
  assert.equal(studio.patch({ op: 'selectAsset', assetType: SERVER }).version, serverVersion + 1)
})

test('duplicate previous GUID with references refuses ambiguous remapping', () => {
  const seed = createStudio().archiveData()
  const duplicate = findNode(seed.assets.client.root, 'n1').guid
  findNode(seed.assets.server.root, 'n2').guid = duplicate
  const reference = findNode(seed.assets.server.root, 'n4')
  reference.referencedPrefabId = duplicate
  reference.giaRaw.templateRefSlot = String(duplicate)
  const studio = createStudio(seed)
  studio.get()
  const before = studio.archiveData()
  assert.throws(() => studio.patch({ op: 'setControlGuid', id: 'n2', guid: 19003 }), /歧义/)
  assert.deepEqual(studio.archiveData(), before)
  studio.patch({ op: 'set', id: 'n4', key: 'referencedPrefabId', value: '' })
  studio.patch({ op: 'setControlGuid', id: 'n2', guid: 19003 })
  assert.equal(node(studio, 'n1', 'client').guid, duplicate)
})

test('ordered pending mappings survive archive, constructor and full import; acknowledgement is explicit', () => {
  const studio = createStudio(createStudio().archiveData())
  const first = studio.patch({ op: 'setControlGuid', id: 'n2', guid: 19004 }).controlGuidChanges[0]
  const second = studio.patch({ op: 'setControlGuid', id: 'n2', guid: 19005 }).controlGuidChanges[1]
  assert.equal(second.oldGuid, 19004)
  assert.notEqual(second.id, first.id)
  const archive = studio.archiveData()
  assert.deepEqual(createStudio(archive).archiveData(), archive)
  const loaded = createStudio()
  loaded.importData('json', studio.exportData('save').data)
  assert.deepEqual(loaded.archiveData(), archive)
  const version = loaded.get().version
  for (const changeIds of [undefined, [], ['missing'], [first.id, 'missing']]) {
    assert.throws(() => loaded.patch({ op: 'acknowledgeControlGuidChanges', changeIds, expectedRevision: version }), /changeIds/)
    assert.deepEqual(loaded.archiveData(), archive)
  }
  assert.throws(() => loaded.patch({ op: 'acknowledgeControlGuidChanges', changeIds: [first.id], expectedRevision: version - 1 }), /revision conflict/)
  loaded.patch({ op: 'acknowledgeControlGuidChanges', changeIds: [first.id], expectedRevision: version })
  assert.deepEqual(loaded.get().controlGuidChanges, [second])
  const final = loaded.patch({ op: 'acknowledgeControlGuidChanges', changeIds: [second.id], expectedRevision: version + 1 })
  assert.deepEqual(final.controlGuidChanges, [])
})

test('invalid change ledger or script allocation cannot partially import a full archive', () => {
  const studio = createStudio()
  studio.patch({ op: 'setControlGuid', id: 'n2', guid: 19006 })
  const before = studio.archiveData()
  const invalid = structuredClone(before)
  invalid.assets.server.meta.name = 'must not import'
  invalid.controlGuidChanges.push({ ...invalid.controlGuidChanges[0] })
  assert.throws(() => studio.importData('json', base64(invalid)), /变更记录/)
  assert.deepEqual(studio.archiveData(), before)
  const exhausted = structuredClone(before)
  findNode(exhausted.assets.server.root, 'n2').guid = 2147483647
  exhausted.assets.scripts.push({ id: 'unassigned', path: 'overflow.lua', source: '-- test' })
  assert.throws(() => studio.importData('json', base64(exhausted)), /GUID space exhausted/)
  assert.deepEqual(studio.archiveData(), before)
})

test('full archive preparation restores script mounts encoded only in generic slots', () => {
  const archive = createStudio().archiveData()
  findNode(archive.assets.server.root, 'n1').scriptMappingIds = [1500000000]
  archive.assets.scripts = [{ guid: 1500000000, path: 'generic.lua', source: '-- mount', controlId: '' }]
  const constructed = createStudio(archive)
  assert.equal(constructed.get().scripts[0].controlId, 'n1')
  assert.equal(constructed.get().scripts[0].controlAsset, SERVER)
  const imported = createStudio().importData('json', base64(archive)).snapshot
  assert.equal(imported.scripts[0].mounted, true)
  assert.equal(imported.scripts[0].controlId, 'n1')
})

test('GUID-only template edits are included in a GIA package after acknowledgement', () => {
  const studio = createStudio()
  studio.patch({ op: 'selectAsset', assetType: CLIENT })
  const changed = studio.patch({ op: 'setControlGuid', id: 'n1', guid: 19013 })
  studio.patch({ op: 'acknowledgeControlGuidChanges', changeIds: changed.controlGuidChanges.map((entry) => entry.id) })
  studio.patch({ op: 'selectAsset', assetType: SERVER })
  const packed = studio.exportData('save-gia')
  const templateFile = packed.files.find((entry) => entry.filename.includes('客户端控件模板'))
  assert.ok(templateFile)
  assert.equal(importGia(Buffer.from(templateFile.data, 'base64')).project.root.children[0].guid, 19013)
})

test('replacing one asset scopes pending changes; single-asset JSON carries its own mappings', () => {
  const studio = createStudio()
  studio.patch({ op: 'setControlGuid', id: 'n2', guid: 19007 })
  const serverChange = studio.get().controlGuidChanges[0]
  const serverJson = studio.exportData('json', SERVER)
  studio.patch({ op: 'selectAsset', assetType: CLIENT })
  studio.patch({ op: 'setControlGuid', id: 'n2', guid: 19008 })
  const clientChange = studio.get().controlGuidChanges[1]
  studio.patch({ op: 'newAsset', assetType: SERVER })
  assert.deepEqual(studio.get().controlGuidChanges, [clientChange])
  studio.importData('json', serverJson.data)
  assert.deepEqual(studio.get().controlGuidChanges, [clientChange, serverChange])
  studio.importData('gia', createStudio().exportData('gia', CLIENT).data)
  assert.deepEqual(studio.get().controlGuidChanges, [serverChange])
})

test('GIA, Lua and script exports warn until semantic acknowledgement; GIA encodes the new GUID', () => {
  const studio = createStudio()
  const oldGuid = node(studio, 'n2').guid
  const source = `local target = ${oldGuid}\nlocal unchanged = ${oldGuid}`
  const script = studio.patch({ op: 'addScript', path: 'main.lua', source, controlId: 'n1', controlAsset: SERVER }).scripts[0]
  const result = studio.patch({ op: 'setControlGuid', id: 'n2', guid: 19009 })
  for (const format of ['gia', 'gia-combined', 'save-gia', 'scripts-gia', 'scripts', 'lua']) {
    const exported = studio.exportData(format, format === 'lua' ? script.id : '')
    assert.ok(exported.warnings.some((warning) => warning.includes('控件索引待核对 Lua 引用：') && warning.includes(`${oldGuid} → 19009`)), format)
  }
  assert.equal(Buffer.from(studio.exportData('lua', script.id).data, 'base64').toString(), source)
  const decoded = importGia(Buffer.from(studio.exportData('gia').data, 'base64')).project
  assert.equal(decoded.root.children[0].children.find((entry) => entry.name === '文本框').guid, 19009)
  studio.patch({ op: 'acknowledgeControlGuidChanges', changeIds: result.controlGuidChanges.map((change) => change.id) })
  assert.equal(studio.exportData('lua', script.id).warnings.length, 0)
  assert.ok(!studio.exportData('gia').warnings.some((warning) => warning.includes('控件索引待核对')))
})

test('play uses the changed prefab indexes and template script mounts', () => {
  const studio = createStudio()
  studio.patch({ op: 'setControlGuid', id: 'n1', guid: 19010 })
  studio.patch({ op: 'selectAsset', assetType: CLIENT })
  studio.patch({ op: 'setControlGuid', id: 'n1', guid: 19011 })
  studio.patch({ op: 'setControlGuid', id: 'n2', guid: 19012 })
  studio.patch({ op: 'addScript', path: 'template.lua', controlId: 'n2', controlAsset: CLIENT, source: 'function OnStart() print("child-index", script.object.prefabIndex) end' })
  studio.patch({ op: 'addScript', path: 'main.lua', controlId: 'n1', controlAsset: SERVER, source: 'function OnStart()\n print("root-index", script.object.prefabIndex)\n local created = game.InstantiateClientUIControl(19011, script.object)\n print("template-index", created.prefabIndex)\nend' })
  try {
    const play = studio.playStart()
    const output = play.logs.map((entry) => entry.text).join('\n')
    assert.match(output, /root-index\t19010/)
    assert.match(output, /template-index\t19011/)
    assert.match(output, /child-index\t19012/)
  } finally {
    studio.playStop()
  }
})
