import test from 'node:test'
import assert from 'node:assert/strict'
import { createStudio } from '../index.js'
import { importGia, inspectGia, validateGiaCompatibility } from '../gia/codec.js'
import { exportFixture } from './fixtures/partial-export.js'

test('partial GIA exports the selected forest once, keeps order/identity/platforms and restores script mounts', () => {
  const studio = exportFixture(), before = studio.archiveData()
  const choices = studio.exportChoices()
  assert.deepEqual(choices.rows.map(row => row.id), ['a', 'image', 'text', 'b'])
  assert.equal(choices.rows[0].controlCount, 3)
  const result = studio.exportData('gia-partial', '', { controlIds: ['text', 'b', 'a', 'a'] })
  assert.deepEqual(result.selection.controlIds, ['a', 'b'])
  assert.equal(result.selection.controlCount, 4)
  const data = Buffer.from(result.data, 'base64')
  assert.equal(validateGiaCompatibility(data).valid, true)
  const imported = importGia(data)
  assert.deepEqual(imported.project.root.children.map(node => node.name), ['Card', 'Other'])
  assert.deepEqual(imported.project.root.children[0].children.map(node => node.name), ['Badge', 'Title'])
  assert.equal(imported.project.root.children[0].guid, 1073744000)
  assert.equal(imported.project.root.children[0].giaInfoIndex, before.assets.client.root.children[0].giaInfoIndex)
  assert.equal(imported.project.root.children[0].children[0].giaInfoIndex, before.assets.client.root.children[0].children[0].giaInfoIndex)
  assert.deepEqual(imported.project.root.children[0].children[0].transformByPlatform, before.assets.client.root.children[0].children[0].transformByPlatform)
  assert.equal(imported.scripts.length, 4)
  const target = createStudio()
  const restored = target.importData('gia', result.data, result.filename).snapshot
  assert.equal(restored.scripts.find(script => script.path === 'badge.lua').controlName, 'Badge')
  assert.equal(restored.scripts.find(script => script.path === 'badge.lua').mounted, true)
  assert.deepEqual(studio.archiveData(), before)
})

test('single child export uses a detached copy and includes only its own mount plus unmounted modules', () => {
  const studio = exportFixture(), before = studio.archiveData()
  const options = { controlIds: ['image'], expectedRevision: studio.exportChoices().revision }
  const preview = studio.exportPreview(options)
  assert.equal(preview.snapshot.tree[0].depth, 0)
  assert.equal(preview.snapshot.selectedId, 'image')
  assert.equal(preview.snapshot.boxes.find(box => box.id === 'image').width, 80)
  assert.equal(preview.snapshot.boxes.find(box => box.id === 'image').rotationZ, 15)
  const result = studio.exportData('gia-partial', '', options)
  assert.equal(inspectGia(Buffer.from(result.data, 'base64')).templateCount, 1)
  const imported = importGia(Buffer.from(result.data, 'base64'))
  assert.deepEqual(imported.project.root.children.map(node => node.name), ['Badge'])
  assert.deepEqual(imported.scripts.map(script => script.path).sort(), ['badge.lua', 'module.lua'])
  assert.ok(result.warnings.some(line => line.includes('局部变换')))
  assert.deepEqual(studio.archiveData(), before, 'preview and export must not change the selection, revision or hierarchy')
  const noScripts = importGia(Buffer.from(studio.exportData('gia-partial', '', { ...options, includeScripts: false }).data, 'base64'))
  assert.equal(noScripts.scripts.length, 0)
  assert.deepEqual(noScripts.project.root.children[0].scriptMappingIds, [])
})

test('invalid/empty/stale selections reject atomically and old whole-asset exports still work', () => {
  const studio = exportFixture(), before = studio.archiveData()
  for (const options of [{}, { controlIds: [] }, { controlIds: ['missing'] }, { controlIds: [1] },
    { controlIds: ['a'], includeScripts: 'false' }, { controlIds: ['a'], expectedRevision: -1 }]) {
    assert.throws(() => studio.exportData('gia-partial', '', options))
  }
  assert.equal(inspectGia(Buffer.from(studio.exportData('gia', 'client-control-template').data, 'base64')).templateCount, 2)
  assert.deepEqual(studio.archiveData(), before)
})

test('partial export reports external and opaque dependencies without silently selecting additional templates', () => {
  const seed = exportFixture().archiveData()
  const badge = seed.assets.client.root.children[0].children[0]
  badge.itemPrefabId = 1073744003
  // Use an actual reference control to exercise preserved opaque slot behavior.
  const reference = { ...badge, id: 'ref', guid: 1073744004, kind: 'reference', name: 'Opaque',
    giaInfoIndex: seed.assets.client.meta.giaNextAssetIndex,
    referencedPrefabId: '1073744003', giaRaw: { ...badge.giaRaw, templateRefSlotBase64: 'gAE=' } }
  seed.assets.client.root.children[0].children.push(reference)
  const studio = createStudio(seed), before = studio.archiveData()
  const result = studio.exportPreview({ controlIds: ['a'] })
  assert.deepEqual(result.selection.controlIds, ['a'])
  assert.equal(result.selection.templateCount, 1)
  assert.ok(result.warnings.some(line => line.includes('1073744003') && line.includes('不在本次导出')))
  assert.ok(result.warnings.some(line => line.includes('二进制模板引用')))
  assert.deepEqual(studio.archiveData(), before)
})
