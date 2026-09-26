import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SimulatorController } from '../host/controller.js'
import { createStudio } from '../index.js'
import { discoverScriptDirectories } from '../host/script-sync.js'

function setup(t) {
  const temp = mkdtempSync(join(tmpdir(), 'qxqy-copy-'))
  const workspace = join(temp, 'workspace')
  const target = join(temp, 'default_import_file')
  mkdirSync(join(workspace, 'game'), { recursive: true }); mkdirSync(target)
  const controller = new SimulatorController(workspace)
  t.after(async () => { await controller.dispose(); rmSync(temp, { recursive: true, force: true }) })
  controller.patch({ op: 'setScriptSync', config: { version: 1, workspaceDir: 'game', clientImportRoot: target, clientSubdir: 'game' } })
  const add = (path, source = '') => controller.patch({ op: 'addScript', path, source }).scripts.at(-1)
  const apply = plan => controller.scriptSync.apply({ planId: plan.id, scriptIds: plan.rows.filter(row => !row.error && row.status !== '未变化').map(row => row.id), confirmed: true })
  return { temp, workspace, target, controller, add, apply }
}

test('copy is explicit, uses runtime source precedence, preserves extra files and backs up originals', async t => {
  const { workspace, target, controller, add, apply } = setup(t)
  mkdirSync(join(target, 'game'))
  writeFileSync(join(target, 'game/main.lua'), '-- original')
  writeFileSync(join(target, 'extra.lua'), '-- untouched')
  writeFileSync(join(workspace, 'game/main.lua'), '-- disk')
  writeFileSync(join(workspace, 'game/module.lua'), '-- module')
  add('game/main.lua', '-- inline'); add('game/module.lua')
  controller.saveArchive('game.save.json')
  const archive = controller.studio.archiveData()
  assert.deepEqual(createStudio(archive).archiveData().scriptSync, archive.scriptSync)
  assert.deepEqual(createStudio(archive).archiveData().assets.scripts, archive.assets.scripts)
  const plan = controller.scriptSyncAction('preview')
  assert.equal(plan.rows[0].sourceMismatch, true)
  assert.equal(plan.rows[1].sourceKind, '工作区文件')
  assert.equal(readFileSync(join(target, 'game/main.lua'), 'utf8'), '-- original')
  assert.throws(() => controller.scriptSyncAction('apply'), /unknown/)
  assert.throws(() => controller.scriptSync.apply({ planId: plan.id }), /确认/)
  const result = apply(plan)
  assert.equal(result.completed, true)
  assert.equal(readFileSync(join(target, 'game/main.lua'), 'utf8'), '-- inline')
  assert.equal(readFileSync(join(target, 'game/module.lua'), 'utf8'), '-- module')
  assert.equal(readFileSync(join(target, 'extra.lua'), 'utf8'), '-- untouched')
  assert.equal(readFileSync(join(result.backupRoot, 'game/main.lua'), 'utf8'), '-- original')
  assert.throws(() => apply(plan), /确认/)
  assert.ok(controller.scriptSync.preview().rows.every(row => row.status === '未变化'))
})

test('changed source, target, config or archive invalidates confirmation before any copy', async t => {
  const { workspace, target, controller, add, apply } = setup(t)
  const script = add('game/main.lua', '-- new')
  const file = join(target, 'game/main.lua')
  controller.saveArchive('game.save.json')
  let plan = controller.scriptSync.preview()
  controller.patch({ op: 'updateScript', id: script.id, source: '-- newer' })
  assert.throws(() => apply(plan), /已变化/)
  assert.equal(existsSync(file), false)
  plan = controller.scriptSync.preview()
  assert.throws(() => apply(plan), /保存/)
  controller.saveArchive()
  plan = controller.scriptSync.preview()
  mkdirSync(join(target, 'game')); writeFileSync(file, '-- external')
  assert.throws(() => apply(plan), /已变化/)
  plan = controller.scriptSync.preview()
  writeFileSync(join(workspace, 'game.save.json'), '{}')
  assert.throws(() => apply(plan), /存档文件已变化/)
  assert.equal(readFileSync(file, 'utf8'), '-- external')
})

test('path-only file changes invalidate previews and unreadable files cannot be copied', async t => {
  const { workspace, controller, add, apply } = setup(t)
  writeFileSync(join(workspace, 'game/main.lua'), '-- v1')
  add('game/main.lua'); add('game/missing.lua')
  controller.saveArchive('game.save.json')
  const plan = controller.scriptSync.preview()
  assert.equal(plan.rows[1].status, '错误')
  writeFileSync(join(workspace, 'game/main.lua'), '-- v2')
  assert.throws(() => apply(plan), /已变化/)
})

test('pending GUID references block copy; invalid paths and duplicate targets are reported', async t => {
  const { controller, add, apply } = setup(t)
  add('game/main.lua', '-- new')
  add('game/../escape.lua', '-- bad')
  add('game/MAIN.lua', '-- duplicate')
  add('game/con.lua', '-- invalid Windows path')
  controller.patch({ op: 'setControlGuid', id: 'n2', guid: 19001 })
  controller.saveArchive('game.save.json')
  const plan = controller.scriptSync.preview()
  assert.equal(plan.rows.filter(row => row.error).length, 4)
  assert.throws(() => apply(plan), /索引/)
})

test('copy refuses junction destinations, supports discovery and validates archive config atomically', async t => {
  const { temp, workspace, target, controller, add } = setup(t)
  symlinkSync(join(workspace, 'game'), join(target, 'game'), 'junction')
  add('game/main.lua', '-- inline')
  assert.equal(controller.scriptSync.preview().rows[0].status, '错误')
  const candidate = join(temp, '123/Beyond_Local_Save_Level/456/external_lua_file/default_import_file')
  mkdirSync(candidate, { recursive: true })
  assert.deepEqual(discoverScriptDirectories(temp).candidates, [{ uid: '123', editorId: '456', path: candidate }])
  const before = controller.studio.archiveData()
  const invalid = structuredClone(before)
  invalid.scriptSync.clientSubdir = '../escape'
  assert.throws(() => controller.studio.importData('json', Buffer.from(JSON.stringify(invalid)).toString('base64')), /相对路径/)
  assert.deepEqual(controller.studio.archiveData(), before)
})
