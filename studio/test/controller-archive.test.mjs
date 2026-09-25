import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SimulatorController } from '../host/controller.js'

test('save defaults to the last successfully opened or saved path', async t => {
  const workspace = mkdtempSync(join(tmpdir(), 'qxqy-controller-save-'))
  const controller = new SimulatorController(workspace)
  t.after(async () => { await controller.dispose(); rmSync(workspace, { recursive: true, force: true }) })
  assert.equal(controller.saveArchive().path, 'qxqy-simulator.save.json')
  controller.saveArchive('nested/a.json')
  controller.patch({ op: 'renameSave', name: 'Updated A' })
  assert.equal(controller.saveArchive().path, 'nested/a.json')
  assert.equal(JSON.parse(readFileSync(join(workspace, 'nested/a.json'), 'utf8')).meta.name, 'Updated A')
  controller.saveArchive('b.json')
  controller.loadArchive('nested/a.json')
  assert.throws(() => controller.loadArchive('missing.json'), /does not exist/)
  assert.throws(() => controller.saveArchive('../outside.json'), /inside the configured workspace/)
  assert.equal(controller.saveArchive().path, 'nested/a.json')
})
