import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRuntime } from '../src/index.js'

// API visible is boolean and SetVisible changes only visibility; device error:
// bad argument #2 to 'SetVisible' (boolean expected, got nil).
test('SetVisible rejects non-booleans before changing the control', t => {
  const rt = createRuntime()
  t.after(() => rt.destroy())
  const root = rt.addRoot({ kind: 'container', name: 'Root', active: true, visible: true })
  rt.mountScript({ path: 'visibility-types', control: root, source: `
function OnStart()
  local c = script.object
  local function reject(value, valueType)
    local before = c.visible
    local ok, err = pcall(function() c:SetVisible(value) end)
    assert(not ok, 'invalid visibility accepted: ' .. valueType)
    assert(string.find(tostring(err), "bad argument #2 to 'SetVisible' (boolean expected, got " .. valueType .. ")", 1, true), tostring(err))
    assert(c.visible == before, 'rejected argument changed visibility')
  end
  for _, initial in ipairs({true, false}) do
    c:SetVisible(initial)
    reject(nil, 'nil')
    reject(0, 'number')
    reject(1, 'number')
    reject('false', 'string')
    reject('', 'string')
    reject({}, 'table')
    local cycle = {}; cycle.self = cycle
    reject(cycle, 'table')
    reject(function() end, 'function')
    reject(c, 'userdata')
    local ok = pcall(function() c:SetVisible() end)
    assert(not ok and c.visible == initial, 'omitted argument accepted or changed visibility')
  end
  c:SetVisible(true)
end` })
  assert.deepEqual(rt.mountErrors, [])
  assert.equal(root.visible, true)
  assert.equal(rt.logs.some(row => row.level === 'lua-error'), false)
})

test('SetVisible(true/false) keeps update and active state unchanged', t => {
  const rt = createRuntime()
  t.after(() => rt.destroy())
  const root = rt.addRoot({ kind: 'container', name: 'Root', active: true, visible: true })
  rt.mountScript({ path: 'visibility-update', control: root, source: `
local frames = 0
function OnStart()
  script:EnableUpdate(true)
  script.object:SetVisible(false)
end
function OnUpdate()
  frames = frames + 1
  assert(script.object.active)
  assert(script.object.visible == (frames > 1))
  if frames == 1 then script.object:SetVisible(true) end
  print('updated', frames)
end` })
  rt.step(1 / 30)
  rt.step(1 / 30)
  assert.deepEqual(rt.mountErrors, [])
  assert.equal(root.active, true)
  assert.equal(root.visible, true)
  assert.equal(rt.logs.filter(row => row.text.startsWith('updated')).length, 2)
  assert.equal(rt.logs.some(row => row.level === 'lua-error'), false)
})
