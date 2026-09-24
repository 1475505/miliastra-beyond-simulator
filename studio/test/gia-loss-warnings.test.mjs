import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createStudio, exportGia } from '../index.js'
import { createNode } from '../ui/authoring.js'
import { PLATFORMS } from '../constants.js'

test('GIA preserves rotation visibility and activation for a thousand images', () => {
  const studio = createStudio()
  const archive = studio.archiveData()
  const root = archive.assets.server.root.children[0]
  root.children = Array.from({ length: 1000 }, (_, i) => createNode('image', {
    id: `ellipse-${i}`, name: `ellipse-${i}`, imageId: 100002,
  }))
  for (const n of root.children) {
    for (const p of PLATFORMS) n.transformByPlatform[p].rotation.z = 30
  }
  root.visible = false
  root.children[0].active = false
  const before = structuredClone(archive)
  const s = createStudio(archive)
  for (const format of ['gia', 'combined']) {
    const result = s.exportData(format)
    const rotation = result.warnings.filter(w => w.includes('旋转 Z'))
    assert.equal(rotation.length, 0)
    assert.ok(!result.warnings.some(w => /初始隐藏状态/.test(w)))
    assert.ok(!result.warnings.some(w => /初始未激活状态/.test(w)))
    const target = createStudio()
    target.importData('gia', result.data, result.filename)
    const restored = target.archiveData().assets.server.root.children[0]
    assert.equal(restored.visible, false)
    assert.equal(restored.children.length, 1000)
    assert.equal(restored.children[0].active, false)
    for (const n of restored.children) {
      for (const p of PLATFORMS) assert.equal(n.transformByPlatform[p].rotation.z, 30)
    }
  }
  assert.deepEqual(archive, before, 'export must not remove the original JSON state')
})

test('individual server GIA explicitly reports excluded Lua source; combined retains it', () => {
  const studio = createStudio()
  const archive = studio.archiveData()
  archive.assets.scripts = [{
    id: '1073742110', guid: 1073742110,
    path: 'diary.lua', source: 'function OnStart() print("cover-ready") end',
    controlId: archive.assets.server.root.children[0].id,
    controlAsset: 'server-control-template',
  }]
  const s = createStudio(archive)
  const ui = s.exportData('gia')
  assert.ok(ui.warnings.some(w => /不包含 1 个 Lua 脚本的源码/.test(w)))
  const combined = s.exportData('combined')
  assert.ok(!combined.warnings.some(w => /不包含.*Lua 脚本/.test(w)))
  const loaded = createStudio()
  loaded.importData('gia', combined.data, combined.filename)
  assert.equal(loaded.archiveData().assets.scripts[0].source, archive.assets.scripts[0].source)
})

test('client-template GIA no longer reports supported states as lost', () => {
  const archive = createStudio().archiveData()
  const node = archive.assets.client.root.children[0]
  node.visible = false
  node.active = false
  for (const p of PLATFORMS) node.transformByPlatform[p].rotation.z = 15
  const { warnings } = exportGia(archive.assets.client)
  assert.ok(!warnings.some(w => w.includes('旋转 Z')))
  assert.ok(!warnings.some(w => w.includes('初始隐藏状态')))
  assert.ok(!warnings.some(w => w.includes('初始未激活状态')))
})
