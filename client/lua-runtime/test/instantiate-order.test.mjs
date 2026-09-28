import test from 'node:test'
import assert from 'node:assert/strict'
import { createRuntime } from '../src/index.js'

const active = (name, extra = {}) => ({ name, kind: 'container', active: true, visible: true, ...extra })

test('Lua Instantiate inserts above authored siblings before template lifecycle and preserves template child order', t => {
  const rt = createRuntime()
  t.after(() => rt.destroy())
  const root = rt.addRoot(active('Root', { children: [active('StaticFront'), active('StaticBack')] }))
  rt.registerTemplate(30001, active('Panel', {
    scripts: [{ path: 'panel-start', source: `
function OnStart()
  local count = #script.object.parent:GetChildren()
  assert(script.object:GetSiblingIndex() == count - 1, "instance must already be on top in OnStart")
  local front = script.object:GetChild("TemplateFront")
  local back = script.object:GetChild("TemplateBack")
  assert(front:GetSiblingIndex() == 1 and back:GetSiblingIndex() == 0)
  print("ready-index", script.object:GetSiblingIndex())
end` }],
    children: ['TemplateFront', 'TemplateBack'].map(name => active(name, {
      scripts: [{ path: name, source: `function OnStart() assert(script.object.name == "${name}") end` }],
    })),
  }))
  rt.mountScript({ path: 'spawn-panels', control: root, source: `
function OnStart()
  local a = game.InstantiateClientUIControl(30001, script.object)
  a.name = "A"
  local b = game.InstantiateClientUIControl(30001, script.object)
  b.name = "B"
  assert(a:GetSiblingIndex() == 2 and b:GetSiblingIndex() == 3)
end` })
  assert.deepEqual(rt.mountErrors, [])
  assert.deepEqual(root.GetChildren().map(c => c.name), ['B', 'A', 'StaticFront', 'StaticBack'])
  assert.deepEqual(['StaticBack', 'StaticFront', 'A', 'B'].map(name => root.GetChild(name).GetSiblingIndex()), [0, 1, 2, 3])
  assert.deepEqual(rt.logs.filter(l => l.text.startsWith('ready-index')).map(l => l.text), ['ready-index\t2', 'ready-index\t3'])
  for (const name of ['A', 'B']) assert.deepEqual(root.GetChild(name).GetChildren().map(c => c.name), ['TemplateFront', 'TemplateBack'])
})

test('a template script can lower itself without Instantiate raising it again after OnStart', t => {
  const rt = createRuntime()
  t.after(() => rt.destroy())
  const root = rt.addRoot(active('Root', { children: [active('Existing')] }))
  rt.registerTemplate(30002, active('SelfLowered', { scripts: [{ path: 'lower-self', source: `
function OnStart()
  assert(script.object:GetSiblingIndex() == 1, "new instance starts on top")
  assert(script.object:SetAsFirstSibling())
end` }] }))
  rt.mountScript({ path: 'spawn-lowered', control: root, source: `
function OnStart()
  local c = game.InstantiateClientUIControl(30002, script.object)
  assert(c:GetSiblingIndex() == 0, "explicit template ordering must win")
end` })
  assert.deepEqual(rt.mountErrors, [])
  assert.deepEqual(root.GetChildren().map(c => c.name), ['Existing', 'SelfLowered'])
})
