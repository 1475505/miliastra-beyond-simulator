import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createWebServer } from '../server.js'
import { createStudio } from '../../studio/index.js'

test('GIA import → real index calibration → Lua correction → saved directory binding → confirmed copy', async t => {
  const temp = mkdtempSync(join(tmpdir(), 'qxqy-script-e2e-'))
  const workspace = join(temp, 'workspace')
  const target = join(temp, 'BeyondLocal/170427528/Beyond_Local_Save_Level/1073741993/external_lua_file/default_import_file')
  mkdirSync(join(workspace, 'game/src'), { recursive: true })
  mkdirSync(join(target, 'game/src'), { recursive: true })
  const app = await createWebServer({ workspace, port: 0 })
  t.after(async () => { await app.close(); rmSync(temp, { recursive: true, force: true }) })
  const request = async (action, body = {}) => {
    const response = await fetch(`${app.url}/editor/api/${action}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: 'e2e', ...body }) })
    return response.json()
  }
  const call = async (action, body) => { const result = await request(action, body); assert.equal(result.ok, true, result.error); return result.value }
  const patch = async op => { const current = await call('get'); return call('patch', { op: { ...op, expectedRevision: current.version } }) }
  const save = async () => { const current = await call('get'); return call('save', { path: 'game/game.save.json', expectedRevision: current.version }) }
  const seed = createStudio()
  const template = seed.archiveData().assets.client.root.children[0]
  const newIndex = 190123
  const source = index => `local TEMPLATE_INDEX = ${index}\nlocal unrelatedImage = ${template.guid}\nfunction OnStart()\n local panel = game.InstantiateClientUIControl(TEMPLATE_INDEX, script.object)\n print("copy-ready", panel.prefabIndex, unrelatedImage)\nend`
  seed.patch({ op: 'addScript', path: 'game/main.lua', source: source(template.guid), controlId: 'n1', controlAsset: 'server-control-template' })
  seed.patch({ op: 'addScript', path: 'game/src/module.lua', source: 'return { version = 1 }' })
  const gia = seed.exportData('combined')
  let snapshot = (await call('import', { format: 'gia', data: gia.data, filename: gia.filename })).snapshot
  // Model the already-imported client files. The game UI itself is not automated.
  writeFileSync(join(target, 'game/main.lua'), source(template.guid))
  writeFileSync(join(target, 'keep.lua'), '-- other mapping')
  snapshot = await patch({ op: 'selectAsset', assetType: 'client-control-template' })
  const importedTemplate = snapshot.root.children.find(node => node.guid === template.guid)
  assert.ok(importedTemplate)
  snapshot = await patch({ op: 'setControlGuid', id: importedTemplate.id, guid: newIndex })
  const changes = snapshot.controlGuidChanges
  const main = snapshot.scripts.find(script => script.path === 'game/main.lua')
  assert.equal(main.source, source(template.guid), 'index edits must not rewrite Lua numbers')
  await save()
  snapshot = (await call('load-archive', { path: 'game/game.save.json' })).snapshot
  assert.deepEqual(snapshot.controlGuidChanges, changes, 'pending changes survive disk reload')
  const pendingExport = await call('export', { format: 'lua', assetType: main.id })
  assert.ok(pendingExport.warnings.some(line => line.startsWith('控件索引待核对 Lua 引用：')))
  const staleRevision = snapshot.version
  snapshot = await patch({ op: 'updateScript', id: main.id, source: source(newIndex) })
  assert.deepEqual(snapshot.controlGuidChanges, changes, 'editing Lua does not acknowledge changes')
  const staleAck = await request('patch', { op: { op: 'acknowledgeControlGuidChanges', changeIds: changes.map(row => row.id), expectedRevision: staleRevision } })
  assert.equal(staleAck.ok, false)
  assert.match(staleAck.error, /revision conflict/)
  writeFileSync(join(workspace, 'game/main.lua'), source(newIndex))
  snapshot = await patch({ op: 'acknowledgeControlGuidChanges', changeIds: changes.map(row => row.id) })
  const config = { version: 1, workspaceDir: 'game', clientImportRoot: target, clientSubdir: 'game' }
  await call('script-sync', { action: 'configure', args: { config, expectedRevision: snapshot.version } })
  await save()
  const persisted = JSON.parse(readFileSync(join(workspace, 'game/game.save.json'), 'utf8'))
  assert.deepEqual(persisted.scriptSync, config)
  assert.deepEqual(persisted.controlGuidChanges, [])
  await call('load-archive', { path: 'game/game.save.json' })
  let plan = await call('script-sync', { action: 'preview' })
  assert.equal(plan.rows.find(row => row.id === main.id).status, '覆盖')
  assert.equal(readFileSync(join(target, 'game/main.lua'), 'utf8'), source(template.guid), 'preview must not copy')
  assert.equal(existsSync(join(target, 'game/src/module.lua')), false)
  const denied = await request('script-sync-apply', { planId: plan.id, scriptIds: plan.rows.map(row => row.id) })
  assert.equal(denied.ok, false)
  const copied = await call('script-sync-apply', { planId: plan.id, scriptIds: plan.rows.map(row => row.id), confirmed: true })
  assert.equal(copied.completed, true)
  assert.equal(readFileSync(join(target, 'game/main.lua'), 'utf8'), source(newIndex))
  assert.equal(readFileSync(join(target, 'game/src/module.lua'), 'utf8'), 'return { version = 1 }')
  assert.equal(readFileSync(join(target, 'keep.lua'), 'utf8'), '-- other mapping')
  assert.equal(readFileSync(join(copied.backupRoot, 'game/main.lua'), 'utf8'), source(template.guid))
  // Execute the actual copied bytes against the remapped imported assets.
  const copiedArchive = structuredClone(persisted)
  for (const script of copiedArchive.assets.scripts) script.source = readFileSync(join(target, script.path), 'utf8')
  const runtime = createStudio(copiedArchive)
  try {
    const logs = runtime.playStart().logs.map(row => row.text).join('\n')
    assert.match(logs, new RegExp(`copy-ready\\t${newIndex}\\t${template.guid}`))
  } finally { runtime.playStop() }
  plan = await call('script-sync', { action: 'preview' })
  assert.ok(plan.rows.every(row => row.status === '未变化'))
  // A second edit must require a new preview and explicit confirmation.
  await patch({ op: 'updateScript', id: main.id, source: source(newIndex) + '\n-- next edit' })
  assert.equal(readFileSync(join(target, 'game/main.lua'), 'utf8'), source(newIndex))
  await save()
  plan = await call('script-sync', { action: 'preview' })
  writeFileSync(join(target, 'game/main.lua'), '-- game-side edit')
  const stale = await request('script-sync-apply', { planId: plan.id, scriptIds: [main.id], confirmed: true })
  assert.equal(stale.ok, false)
  assert.match(stale.error, /内容已变化/)
  assert.equal(readFileSync(join(target, 'game/main.lua'), 'utf8'), '-- game-side edit')
})
