import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRuntime } from '../src/index.js'
import { lua, sl } from '../src/lua-bridge.js'

const messages = (rt) => rt.logs.map((entry) => entry.text).join('\n')
const mount = (rt, source, path = 'main') => rt.mountScript({
  path, source, control: rt.addRoot({ active: true, kind: 'container', name: path }),
})

test('require retains recursive tables, metatables, closures and multi-return Lua values in the caller VM', () => {
  const rt = createRuntime()
  rt.registerScriptFile('classes/counter', `
local Counter = {} Counter.__index = Counter
Counter.self = Counter
local privateCount = 0
function Counter.new(n) return setmetatable({ value=n }, Counter) end
function Counter:add(n) self.value=self.value+n return self.value, self end
function Counter.next() privateCount=privateCount+1 return privateCount end
return Counter
`)
  mount(rt, `
local Counter=require('classes/counter')
local one=Counter.new(4)
local value,identity=one:add(3)
assert(Counter==Counter.__index and Counter.self==Counter)
assert(getmetatable(one)==Counter and identity==one and value==7 and one.value==7)
assert(Counter.next()==1 and Counter.next()==2)
assert(require('default_import_file/classes/counter.lua')==Counter)
print('native class works')
`)
  assert.match(messages(rt), /native class works/)
  assert.equal(rt.luaStates.size, 2, 'one boot VM and one mounted VM; modules must not allocate more VMs')
  rt.destroy()
  assert.equal(rt.luaStates.size, 0)
  assert.equal(rt.requireCache.size, 0)
})

test('nested require shares table identity while isolating each module _ENV and script identity', () => {
  const rt = createRuntime()
  rt.registerScriptFile('leaf', `
assert(callerGlobal==nil and parentGlobal==nil)
_G.leafGlobal='leaf-only'
local leaf={path=script.path, id=script.scriptMappingId, count=0}
function leaf.step() leaf.count=leaf.count+1 return leaf.count, script.path, _G.leafGlobal end
return leaf
`)
  rt.registerScriptFile('parent', `
assert(callerGlobal==nil)
parentGlobal='parent-only'
local leaf=require('leaf')
assert(leafGlobal==nil and script.path=='parent')
return {leaf=leaf, path=script.path}
`)
  const main = mount(rt, `
callerGlobal='main-only'
local parent=require('parent')
local leaf=require('leaf')
assert(parent.leaf==leaf and leaf.path=='leaf' and parent.path=='parent')
local count,path,secret=parent.leaf.step()
assert(count==1 and path=='leaf' and secret=='leaf-only')
assert(script.path=='main' and leaf.id~=script.scriptMappingId)
assert(parentGlobal==nil and leafGlobal==nil)
assert(leaf.step()==2)
function OnStart() print('native nested works') end
`)
  assert.equal(rt.mountErrors.length, 0)
  assert.match(messages(rt), /native nested works/)
  const other = mount(rt, `local leaf=require('leaf'); assert(leaf.count==0); print('separate mounted cache works')`, 'other')
  rt.unmountScript(main)
  rt.invokeOn(other.env, 'unused', [])
  assert.match(messages(rt), /separate mounted cache works/)
  rt.destroy()
})

test('failed and cyclic require restore the caller stack and do not poison the cache', () => {
  const rt = createRuntime()
  rt.registerScriptFile('broken', `error('initial failure')`)
  rt.registerScriptFile('cycleA', `return require('cycleB')`)
  rt.registerScriptFile('cycleB', `return require('cycleA')`)
  const script = mount(rt, `
function Probe()
  local ok,err=pcall(require,'broken')
  assert(not ok and string.find(err,'initial failure',1,true))
  local cyclic,message=pcall(require,'cycleA')
  assert(not cyclic and string.find(message,'cyclic',1,true))
  print('errors isolated', script.path)
end
function Retry() assert(require('broken').fixed); print('retry works') end
`)
  rt.invokeOn(script.env, 'Probe', [])
  rt.registerScriptFile('broken', `return {fixed=true}`)
  rt.invokeOn(script.env, 'Retry', [])
  assert.match(messages(rt), /errors isolated\tmain/)
  assert.match(messages(rt), /retry works/)
  rt.destroy()
})

test('same-VM require preserves coroutine continuation and cache identity when a test VM explicitly enables it', () => {
  const rt = createRuntime()
  // Production sandbox keeps the observed coroutine restriction. This isolated
  // VM fixture exposes the existing library solely to exercise VM transfer semantics.
  const original = rt.newLuaThread.bind(rt)
  rt.newLuaThread = () => {
    const L = original()
    lua.lua_getfield(L, lua.LUA_REGISTRYINDEX, sl('_LOADED'))
    lua.lua_getfield(L, -1, sl('coroutine'))
    lua.lua_setglobal(L, sl('testCoroutine'))
    lua.lua_pop(L, 1)
    return L
  }
  rt.registerScriptFile('worker', `
local M={}
function M.run(co)
  assert(require('worker')==M)
  local input=co.yield(M)
  assert(input==M and require('default_import_file/worker.lua')==M)
  return M
end
return M
`)
  mount(rt, `
assert(coroutine==nil)
local worker=require('worker')
local co=testCoroutine.create(function() return worker.run(testCoroutine) end)
local ok,value=testCoroutine.resume(co)
assert(ok and value==worker and testCoroutine.status(co)=='suspended')
local done,result=testCoroutine.resume(co,worker)
assert(done and result==worker and testCoroutine.status(co)=='dead')
print('native coroutine works')
`)
  assert.match(messages(rt), /native coroutine works/)
  rt.destroy()
})
