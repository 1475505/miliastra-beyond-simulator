import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createStudio } from '../index.js'
import { createNode } from '../ui/authoring.js'

function find(root, name) {
  if (root.name === name) return root
  for (const child of root.children || []) {
    const hit = find(child, name)
    if (hit) return hit
  }
  return null
}

test('new containers enable showCursor; explicit false and import stay off', () => {
  const studio = createStudio()
  const serverRoot = find(studio.get().root, '容器节点')
  assert.equal(serverRoot.showCursor, true)

  const added = studio.patch({
    op: 'add',
    kind: 'container',
    parentId: serverRoot.id,
    name: 'Nested',
    expectedRevision: studio.get().version,
  })
  assert.equal(find(added.root, 'Nested').showCursor, true)

  studio.patch({
    op: 'selectAsset',
    assetType: 'client-control-template',
    expectedRevision: studio.get().version,
  })
  assert.equal(find(studio.get().root, 'Lua实例化面板').showCursor, true)
  const template = studio.patch({
    op: 'addTemplate',
    kind: 'container',
    name: 'NewTemplate',
    expectedRevision: studio.get().version,
  })
  assert.equal(find(template.root, 'NewTemplate').showCursor, true)

  assert.equal(createNode('container', { showCursor: false }).showCursor, false)
  assert.equal(createNode('container').showCursor, true)
})

test('a newly created container dispatches button clicks without a manual showCursor', () => {
  const studio = createStudio()
  const root = find(studio.get().root, '容器节点')
  studio.patch({
    op: 'addScript',
    path: 'cursor-default.lua',
    source: `function OnStart()
  script.object:GetChild("预设按钮"):AddCursorEventListener(Enum.CursorEventType.CursorClick, function()
    print("clicked")
  end)
end`,
    controlId: root.id,
    controlAsset: 'server-control-template',
    expectedRevision: studio.get().version,
  })
  studio.playStart({ canvasId: 'pc-16-9' })
  studio.playClick('预设按钮')
  assert.match(studio.playGet().logs.map((entry) => entry.text).join('\n'), /clicked/)
})
