import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SimulatorController } from '../lib/index.js'
import { listWorkspaceArchives, resolveWorkspaceArchive } from '../lib/workspace-archives.js'

function fixture(t) {
  const workspace = realpathSync(mkdtempSync(join(tmpdir(), 'qxqy-dsh-archives-')))
  t.after(() => rmSync(workspace, { recursive: true, force: true }))
  return workspace
}

test('DSH discovery includes large archives and selects newest entries before truncation', async t => {
  const workspace = fixture(t)
  const controller = new SimulatorController(workspace)
  t.after(() => controller.dispose())
  for (let index = 0; index < 55; index++) {
    const path = join(workspace, `a-${String(index).padStart(2, '0')}.json`)
    writeFileSync(path, JSON.stringify({ format: 'qxqy-simulator-save', meta: { name: `Archive ${index}` } }))
    utimesSync(path, 1_700_000_000 + index, 1_700_000_000 + index)
  }
  const largePath = join(workspace, 'z-latest-large.json')
  writeFileSync(largePath, JSON.stringify({ format: 'qxqy-simulator-save', meta: { name: 'Large latest' }, source: 'x'.repeat(8 * 1024 * 1024) }))
  utimesSync(largePath, 1_700_001_000, 1_700_001_000)
  const result = controller.listArchives()
  assert.equal(result.bound, true)
  assert.equal(result.archives.length, 50)
  assert.equal(result.archives[0].path, 'z-latest-large.json')
  assert.ok(result.archives[0].bytes > 8 * 1024 * 1024)
  assert.equal(result.archives[1].path, 'a-54.json')
  assert.equal(result.archives.at(-1).path, 'a-06.json')
  assert.equal(result.discovery.matchedArchives, 56)
  assert.equal(result.discovery.truncated, true)
  assert.ok(result.discovery.warnings.some(message => /最新的 50/.test(message)))
})

test('DSH absolute-path load remembers the relative path for subsequent default saves', async t => {
  const workspace = fixture(t)
  const controller = new SimulatorController(workspace)
  t.after(() => controller.dispose())
  controller.patch({ op: 'renameSave', name: 'Original A' })
  controller.saveArchive('nested/a.save.json')
  controller.patch({ op: 'renameSave', name: 'Separate B' })
  controller.saveArchive('b.save.json')
  const absolute = join(workspace, 'nested', 'a.save.json')
  controller.loadArchive(absolute)
  controller.patch({ op: 'renameSave', name: 'Updated A' })
  assert.throws(() => controller.loadArchive('missing.json'), /存档不存在/)
  writeFileSync(join(workspace, 'broken.json'), '{broken')
  assert.throws(() => controller.loadArchive('broken.json'))
  assert.equal(controller.saveArchive().path, 'nested/a.save.json')
  assert.equal(JSON.parse(readFileSync(absolute, 'utf8')).meta.name, 'Updated A')
  assert.equal(JSON.parse(readFileSync(join(workspace, 'b.save.json'), 'utf8')).meta.name, 'Separate B')
  assert.equal(existsSync(join(workspace, 'qxqy-simulator.save.json')), false)
  assert.equal(resolveWorkspaceArchive(workspace, absolute), absolute)
  assert.throws(() => resolveWorkspaceArchive(workspace, '../outside.json'), /存档路径必须位于当前工作区内/)
})

test('DSH discovery retains unbound behavior and localized load errors', async t => {
  const workspace = fixture(t)
  const controller = new SimulatorController()
  t.after(() => controller.dispose())
  const unbound = { bound: false, archives: [] }
  assert.deepEqual(listWorkspaceArchives(''), unbound)
  assert.deepEqual(listWorkspaceArchives(join(workspace, 'missing-workspace')), unbound)
  assert.deepEqual(controller.listArchives(), unbound)
  assert.throws(() => controller.loadArchive('a.json'), /工作区未绑定/)
  assert.throws(() => resolveWorkspaceArchive(workspace, ''), /path is required/)
  assert.throws(() => resolveWorkspaceArchive(workspace, 'missing.json'), /存档不存在/)
})
