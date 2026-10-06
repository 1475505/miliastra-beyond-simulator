import test from 'node:test'
import assert from 'node:assert/strict'
import { createRuntime } from '../src/index.js'

// Official API rev223: GetChildren returns ClientUIBaseControl[], whose
// SetVisible / SetAsLastSibling methods operate on the actual child controls.
// Do not assert array order or default creation order: neither is documented.
test('GetChildren controls support documented visibility and sibling methods (#7)', t => {
  const rt = createRuntime()
  t.after(() => rt.destroy())
  const root = rt.addRoot({
    kind: 'container', name: 'Root', active: true, visible: true,
    children: ['A', 'B', 'C'].map(name => ({ kind: 'container', name, active: true, visible: true })),
  })
  rt.mountScript({ path: 'children-reference', control: root, source: `
function OnStart()
  local a = script.object:GetChild("A")
  local children = script.object:GetChildren()
  assert(#children == 3)
  local byName = {}
  for _, child in ipairs(children) do byName[child.name] = child end
  assert(byName.A and byName.B and byName.C)
  assert(byName.A.Id == a.Id)
  byName.A:SetVisible(false)
  assert(not a.visible)
  byName.A:SetVisible(true)
  assert(a.visible)
  assert(a:SetAsFirstSibling())
  assert(a:GetSiblingIndex() == 0)
  assert(byName.A:SetAsLastSibling())
  assert(a:GetSiblingIndex() == #children - 1)
  print("children-reference-ok")
end` })
  assert.deepEqual(rt.mountErrors, [])
  assert.equal(root.GetChild('A').visible, true)
  assert.equal(root.GetChild('A').GetSiblingIndex(), 2)
  assert.ok(rt.logs.some(row => row.text === 'children-reference-ok'))
  assert.equal(rt.logs.some(row => row.level === 'lua-error'), false)
})
