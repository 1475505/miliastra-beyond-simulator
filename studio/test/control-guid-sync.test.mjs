import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SimulatorController } from '../host/controller.js'
import { createNode } from '../ui/authoring.js'
import { planLuaGuidReplacements } from '../control-guid-lua.js'

const CLIENT = 'client-control-template'
const G = 1073741900
function setup(t, source, { disk = source } = {}) {
  const workspace = mkdtempSync(join(tmpdir(), 'guid-lua-'))
  const controller = new SimulatorController(workspace)
  t.after(async () => { await controller.dispose(); rmSync(workspace, { recursive: true, force: true }) })
  const save = controller.studio.archiveData()
  save.activeAssetType = CLIENT
  save.assets.client.root.children = [G, G + 1].map((guid, i) => createNode('container', { id: `tpl${i}`, name: `Template${i}`, guid }))
  save.assets.scripts = [{ guid: 1073741920, id: '1073741920', path: 'main.lua', source, controlId: 'n1', controlAsset: 'server-control-template' }]
  controller.studio.importData('json', Buffer.from(JSON.stringify(save)).toString('base64'))
  if (disk !== null) writeFileSync(join(workspace, 'main.lua'), disk)
  const change = (guid = G + 1) => controller.patch({ op: 'setControlGuid', id: 'tpl0', guid, autoFillClientGuids: true })
  const preview = () => controller.patch({ op: 'previewControlGuidSync' }).controlGuidSyncPreview
  const apply = plan => controller.patch({ op: 'syncControlGuidReferences', planId: plan.id, expectedRevision: controller.get().version })
  return { controller, workspace, change, preview, apply }
}

test('automatic sync applies overlapping values once, updates project and archive, backs up and survives reload', async t => {
  const source = `function OnStart()\n game.InstantiateClientUIControl(${G}, script.object)\n game.InstantiateClientUIControl(${G + 1}, script.object)\nend`
  const { controller, workspace, change, preview, apply } = setup(t, source)
  change()
  const pending = controller.studio.archiveData()
  const plan = preview()
  assert.equal(plan.canApply, true)
  assert.equal(plan.replacements, 2)
  assert.equal(readFileSync(join(workspace, 'main.lua'), 'utf8'), source)
  const result = apply(plan)
  const expected = `function OnStart()\n game.InstantiateClientUIControl(${G + 1}, script.object)\n game.InstantiateClientUIControl(${G + 2}, script.object)\nend`
  assert.equal(result.scripts[0].source, expected)
  assert.equal(readFileSync(join(workspace, 'main.lua'), 'utf8'), expected)
  assert.deepEqual(result.controlGuidChanges, [])
  assert.equal(readFileSync(join(workspace, result.controlGuidSyncResult.backupRoot, '1073741920.lua'), 'utf8'), source)
  assert.deepEqual(JSON.parse(readFileSync(join(workspace, result.controlGuidSyncResult.backupRoot, 'before.save.json'), 'utf8')), pending)
  assert.throws(() => apply(plan), /预览/)
  controller.saveArchive('game.save.json')
  controller.loadArchive('game.save.json')
  assert.equal(controller.get().scripts[0].source, expected)
  const play = controller.studio.playStart()
  assert.equal(play.logs.filter(row => row.level === 'error').length, 0)
})

test('chained edits compose by control identity; going back to original is a no-op', t => {
  const source = `game.InstantiateClientUIControl(${G}, script.object)`
  const { controller, change, preview, apply } = setup(t, source)
  change(G + 100); change(G + 200)
  assert.equal(preview().rows[0].edits[0].newGuid, G + 200)
  change(G)
  const plan = preview()
  assert.equal(plan.replacements, 0)
  assert.equal(plan.canApply, true)
  apply(plan)
  assert.equal(controller.get().scripts[0].source, source)
  assert.equal(controller.get().controlGuidChanges.length, 0)
})

test('full replacement includes config tables, strings, comments and non-index values', t => {
  const source = `local TemplateGuids={basic=${G},ivy=${G + 1}}\nlocal index=${G}\ngame.InstantiateClientUIControl(index, script.object)\nimage:SetImage(${G})\n-- ${G}\nlocal text="${G}"`
  const { controller, change, preview, apply } = setup(t, source)
  change()
  const plan = preview()
  assert.equal(plan.canApply, true)
  assert.equal(plan.replacements, 6)
  apply(plan)
  assert.equal(controller.get().scripts[0].source, `local TemplateGuids={basic=${G + 1},ivy=${G + 2}}\nlocal index=${G + 1}\ngame.InstantiateClientUIControl(index, script.object)\nimage:SetImage(${G + 1})\n-- ${G + 1}\nlocal text="${G + 1}"`)
  assert.equal(controller.get().controlGuidChanges.length, 0)
})

test('file divergence and stale plan reject before any mutation', t => {
  const source = `game.InstantiateClientUIControl(${G}, script.object)`
  const { controller, workspace, change, preview, apply } = setup(t, source)
  change(G + 100)
  const before = controller.studio.archiveData()
  let plan = preview()
  writeFileSync(join(workspace, 'main.lua'), '-- another editor')
  assert.throws(() => apply(plan), /已变化/)
  assert.deepEqual(controller.studio.archiveData(), before)
  plan = preview()
  assert.equal(plan.canApply, false)
  assert.match(plan.rows[0].issues[0].reason, /存档源码与项目文件不同/)
  writeFileSync(join(workspace, 'main.lua'), source)
  plan = preview()
  controller.patch({ op: 'set', id: 'tpl0', key: 'name', value: 'changed after preview' })
  assert.throws(() => apply(plan), /已变化/)
  assert.equal(readFileSync(join(workspace, 'main.lua'), 'utf8'), source)
})

test('full replacement supports legacy ledgers and registered file-only scripts', t => {
  const { controller, workspace, change, preview, apply } = setup(t, '', { disk: `local template=${G}` })
  change(G + 100)
  const archive = controller.studio.archiveData()
  for (const row of archive.controlGuidChanges) delete row.scriptSignature
  controller.studio.importData('json', Buffer.from(JSON.stringify(archive)).toString('base64'))
  const plan = preview()
  assert.equal(plan.canApply, true)
  apply(plan)
  assert.equal(readFileSync(join(workspace, 'main.lua'), 'utf8'), `local template=${G + 100}`)
  assert.equal(controller.get().scripts[0].source, `local template=${G + 100}`)
})

test('full-source replacement uses original decimal digit runs once and preserves surrounding formatting', () => {
  const mapping = new Map([[100, 101], [101, 102]])
  const source = '-- 100\r\nlocal text=[=[100 + 101]=]\r\nlocal values={100, 101, 1000, 1100, 0100}\r\nreturn game.GetClientUIControl(100)'
  const result = planLuaGuidReplacements(source, mapping)
  assert.deepEqual(result.issues, [])
  assert.equal(result.edits.length, 6)
  assert.deepEqual(result.edits.map(row => row.line), [1, 2, 2, 3, 3, 4])
  assert.equal(result.source, '-- 101\r\nlocal text=[=[101 + 102]=]\r\nlocal values={101, 102, 1000, 1100, 0100}\r\nreturn game.GetClientUIControl(101)')
  assert.equal(planLuaGuidReplacements('local template=50+50 -- hex 0x64', mapping).source, 'local template=50+50 -- hex 0x64')
})
