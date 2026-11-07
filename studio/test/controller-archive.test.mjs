import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SimulatorController } from '../host/controller.js'

function setup(t) {
  const workspace = mkdtempSync(join(tmpdir(), 'qxqy-controller-save-'))
  const controller = new SimulatorController(workspace)
  t.after(async () => { await controller.dispose(); rmSync(workspace, { recursive: true, force: true }) })
  return { controller, workspace }
}

test('save defaults to the last successfully opened or saved path', t => {
  const { controller, workspace } = setup(t)
  assert.equal(controller.saveArchive().path, 'qxqy-simulator.save.json')
  controller.saveArchive('nested/a.json')
  controller.patch({ op: 'renameSave', name: 'Updated A' })
  assert.equal(controller.saveArchive().path, 'nested/a.json')
  assert.equal(JSON.parse(readFileSync(join(workspace, 'nested/a.json'), 'utf8')).meta.name, 'Updated A')
  controller.saveArchive('b.json')
  assert.equal(controller.loadArchive('nested/a.json').snapshot.storage.path, 'nested/a.json')
  assert.throws(() => controller.loadArchive('missing.json'), /does not exist/)
  assert.throws(() => controller.saveArchive('../outside.json'), /inside the configured workspace/)
  assert.equal(controller.saveArchive().path, 'nested/a.json')
})

test('editor and sync saves share revision checks, file fingerprints and save-as association', t => {
  const { controller, workspace } = setup(t)
  const save = (path, revision = controller.get().version) => controller.saveArchiveChecked(path, revision)
  const sync = (path, revision = controller.get().version) => controller.scriptSyncAction('save', { path, expectedRevision: revision })
  assert.throws(() => controller.saveArchiveChecked('game.json'), /expectedRevision/)
  assert.throws(() => sync(), /path/)
  assert.throws(() => save('game.json', -1), /revision conflict/)
  assert.equal(existsSync(join(workspace, 'game.json')), false)
  writeFileSync(join(workspace, 'existing.json'), '-- unrelated')
  assert.throws(() => save('existing.json'), /目标文件已存在/)
  assert.equal(readFileSync(join(workspace, 'existing.json'), 'utf8'), '-- unrelated')

  save('game.json')
  controller.patch({ op: 'renameSave', name: 'Synced' })
  assert.equal(sync().path, 'game.json')
  controller.patch({ op: 'renameSave', name: 'Edited' })
  assert.equal(save().path, 'game.json')
  assert.equal(JSON.parse(readFileSync(join(workspace, 'game.json'), 'utf8')).meta.name, 'Edited')
  assert.equal(sync('copy.json').path, 'copy.json')
  assert.equal(save().path, 'copy.json')
  assert.equal(controller.get().storage.path, 'copy.json')
  assert.throws(() => save('game.json'), /目标文件已存在/)
  writeFileSync(join(workspace, 'copy.json'), '-- external changes')
  for (const write of [save, sync]) assert.throws(() => write(), /存档已被外部修改/)
  assert.equal(readFileSync(join(workspace, 'copy.json'), 'utf8'), '-- external changes')
})

test('successful imports detach the old save; failed imports preserve the project and association', t => {
  const { controller, workspace } = setup(t)
  controller.saveArchive('original.json')
  const before = controller.get()
  const original = readFileSync(join(workspace, 'original.json'), 'utf8')
  const invalid = controller.studio.archiveData()
  invalid.version = 999
  const invalidAsset = JSON.parse(Buffer.from(controller.exportData('json').data, 'base64').toString('utf8'))
  invalidAsset.root.name = 'Must not replace the old root'
  invalidAsset.scripts = {} // invalid after the tree itself has been parsed
  for (const text of ['{', JSON.stringify(invalid), JSON.stringify(invalidAsset)]) {
    assert.throws(() => controller.importData('json', Buffer.from(text).toString('base64')))
    assert.deepEqual(controller.get(), before)
    assert.doesNotThrow(() => controller.assertSavedArchive())
  }
  const imported = controller.studio.archiveData()
  imported.meta.name = 'Imported'
  const result = controller.importData('json', Buffer.from(JSON.stringify(imported)).toString('base64'))
  assert.equal(result.snapshot.save.name, 'Imported')
  assert.equal(result.snapshot.storage.path, '')
  assert.throws(() => controller.assertSavedArchive(), /保存/)
  assert.throws(() => controller.scriptSyncAction('save', { expectedRevision: result.snapshot.version }), /path/)
  assert.equal(readFileSync(join(workspace, 'original.json'), 'utf8'), original)
  controller.saveArchiveChecked('imported.json', result.snapshot.version)
  assert.equal(controller.get().storage.path, 'imported.json')
})
