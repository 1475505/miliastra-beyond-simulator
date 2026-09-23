import fengari from 'fengari'

const {
  lua, lauxlib, lualib, to_luastring, to_jsstring,
} = fengari

const LUA_TNIL = lua.LUA_TNIL
const LUA_TBOOLEAN = lua.LUA_TBOOLEAN
const LUA_TNUMBER = lua.LUA_TNUMBER
const LUA_TSTRING = lua.LUA_TSTRING
const LUA_TTABLE = lua.LUA_TTABLE
const LUA_TFUNCTION = lua.LUA_TFUNCTION
const LUA_TUSERDATA = lua.LUA_TUSERDATA
const LUA_OK = lua.LUA_OK

const HOST = new WeakMap()
const LUA_TABLE_ENTRIES = Symbol('luaTableEntries')
export const SCRIPT_HOST_KEY = { __scriptHostKey: true }

function sl(s) {
  return to_luastring(String(s))
}

export function attachHost(ud, obj) {
  HOST.set(ud, obj)
}

export function hostOf(ud) {
  return HOST.get(ud)
}

export function pushValue(L, runtime, value) {
  if (value === undefined || value === null) {
    lua.lua_pushnil(L)
    return
  }
  const t = typeof value
  if (t === 'boolean') {
    lua.lua_pushboolean(L, value)
    return
  }
  if (t === 'number') {
    if (Number.isInteger(value) && Math.abs(value) <= 0x7fffffff) {
      lua.lua_pushinteger(L, value)
    } else {
      lua.lua_pushnumber(L, value)
    }
    return
  }
  if (t === 'string') {
    lua.lua_pushstring(L, sl(value))
    return
  }
  if (t === 'function') {
    pushJsFunction(L, runtime, value)
    return
  }
  if (value && value[LUA_TABLE_ENTRIES]) {
    const entries = value[LUA_TABLE_ENTRIES]
    lua.lua_createtable(L, Array.isArray(value) ? value.length : 0, entries.length)
    for (const [key, entryValue] of entries) {
      pushValue(L, runtime, key)
      pushValue(L, runtime, entryValue)
      lua.lua_settable(L, -3)
    }
    return
  }
  if (Array.isArray(value)) {
    lua.lua_createtable(L, value.length, 0)
    for (let i = 0; i < value.length; i++) {
      pushValue(L, runtime, value[i])
      lua.lua_rawseti(L, -2, i + 1)
    }
    return
  }
  if (value && value.__kind === 'EnumItem') {
    runtime.pushEnumItem(L, value)
    return
  }
  if (value && value.__kind === 'CursorEventData') {
    runtime.pushCursor(L, value)
    return
  }
  if (value && value.__kind === 'Script') {
    runtime.pushScript(L, value)
    return
  }
  if (value && value.typeofName) {
    runtime.pushControl(L, value)
    return
  }
  if (value && value.SetEase) {
    runtime.pushTween(L, value)
    return
  }
  if (t === 'object') {
    lua.lua_createtable(L, 0, Object.keys(value).length)
    for (const [k, v] of Object.entries(value)) {
      pushValue(L, runtime, v)
      lua.lua_setfield(L, -2, sl(k))
    }
    return
  }
  lua.lua_pushnil(L)
}

export function luaString(L, idx) {
  if (lua.lua_isnil(L, idx) || lua.lua_type(L, idx) === lua.LUA_TNONE) return ''
  if (!lua.lua_isstring(L, idx) && lua.lua_type(L, idx) !== lua.LUA_TNUMBER) {
    return `lua_type=${lua.lua_type(L, idx)}`
  }
  const s = lua.lua_tostring(L, idx)
  if (s == null) return ''
  return to_jsstring(s)
}

export function hostFromLua(L, idx) {
  idx = lua.lua_absindex(L, idx)
  const tp = lua.lua_type(L, idx)
  if (tp === LUA_TUSERDATA) return hostOf(lua.lua_touserdata(L, idx))
  if (tp === LUA_TTABLE) {
    lua.lua_pushlightuserdata(L, SCRIPT_HOST_KEY)
    lua.lua_rawget(L, idx)
    const ud = lua.lua_type(L, -1) === LUA_TUSERDATA ? lua.lua_touserdata(L, -1) : null
    lua.lua_pop(L, 1)
    return ud ? hostOf(ud) : null
  }
  return null
}

export function toJs(L, runtime, idx) {
  idx = lua.lua_absindex(L, idx)
  const tp = lua.lua_type(L, idx)
  if (tp === LUA_TNIL) return null
  if (tp === LUA_TBOOLEAN) return !!lua.lua_toboolean(L, idx)
  if (tp === LUA_TNUMBER) {
    if (lua.lua_isinteger(L, idx)) return lua.lua_tointeger(L, idx)
    return lua.lua_tonumber(L, idx)
  }
  if (tp === LUA_TSTRING) return luaString(L, idx)
  if (tp === LUA_TUSERDATA) {
    const ud = lua.lua_touserdata(L, idx)
    return hostOf(ud) ?? ud
  }
  if (tp === LUA_TFUNCTION) {
    return internLuaFunction(L, runtime, idx)
  }
  if (tp === LUA_TTABLE) {
    const host = hostFromLua(L, idx)
    if (host) return host
    const entries = []
    lua.lua_pushnil(L)
    while (lua.lua_next(L, idx) !== 0) {
      const k = toJs(L, runtime, -2)
      const v = toJs(L, runtime, -1)
      entries.push([k, v])
      lua.lua_pop(L, 1)
    }
    const numeric = new Map(entries.filter(([key]) => Number.isInteger(key) && key >= 1))
    let sequenceLength = 0
    while (numeric.has(sequenceLength + 1)) sequenceLength += 1
    const value = sequenceLength > 0 ? [] : {}
    for (const [key, entryValue] of entries) {
      if (Array.isArray(value) && Number.isInteger(key) && key >= 1) value[key - 1] = entryValue
      else if (typeof key === 'string' || typeof key === 'number') value[key] = entryValue
    }
    Object.defineProperty(value, LUA_TABLE_ENTRIES, { value: entries })
    return value
  }
  return null
}

function internLuaFunction(L, runtime, idx) {
  if (!runtime.luaFunctions) runtime.luaFunctions = new Map()
  const ptr = typeof lua.lua_topointer === 'function' ? lua.lua_topointer(L, idx) : null
  if (ptr != null && runtime.luaFunctions.has(ptr)) return runtime.luaFunctions.get(ptr)
  lua.lua_pushvalue(L, idx)
  const ref = lauxlib.luaL_ref(L, lua.LUA_REGISTRYINDEX)
  const fn = wrapLuaFunction(L, runtime, ref)
  if (ptr != null) runtime.luaFunctions.set(ptr, fn)
  return fn
}

function wrapLuaFunction(L, runtime, ref) {
  const fn = (...args) => {
    const top = lua.lua_gettop(L)
    lua.lua_rawgeti(L, lua.LUA_REGISTRYINDEX, ref)
    for (const a of args) pushValue(L, runtime, a)
    const status = lua.lua_pcall(L, args.length, lua.LUA_MULTRET, 0)
    if (status !== LUA_OK) {
      const msg = luaString(L, -1)
      lua.lua_settop(L, top)
      throw new Error(msg)
    }
    const n = lua.lua_gettop(L) - top
    const results = []
    for (let i = 1; i <= n; i++) results.push(toJs(L, runtime, top + i))
    lua.lua_settop(L, top)
    if (results.length === 0) return undefined
    if (results.length === 1) return results[0]
    return results
  }
  fn.__luaRef = ref
  fn.__luaState = L
  return fn
}

export function unrefLuaFunction(runtime, fn) {
  if (!fn || fn.__luaRef == null || !fn.__luaState) return
  const L = fn.__luaState
  if (!runtime?.luaStates || runtime.luaStates.has(L)) {
    lauxlib.luaL_unref(L, lua.LUA_REGISTRYINDEX, fn.__luaRef)
  }
  fn.__luaRef = null
  fn.__luaState = null
  if (runtime?.luaFunctions) {
    for (const [ptr, cached] of runtime.luaFunctions) {
      if (cached === fn) runtime.luaFunctions.delete(ptr)
    }
  }
}

function pushJsFunction(L, runtime, fn) {
  lua.lua_pushlightuserdata(L, fn)
  lua.lua_pushlightuserdata(L, runtime)
  lua.lua_pushcclosure(L, function cfun(LL) {
    const f = lua.lua_touserdata(LL, lua.lua_upvalueindex(1))
    const rt = lua.lua_touserdata(LL, lua.lua_upvalueindex(2))
    const n = lua.lua_gettop(LL)
    const args = []
    for (let i = 1; i <= n; i++) args.push(toJs(LL, rt, i))
    try {
      const ret = f(...args)
      if (Array.isArray(ret) && ret.__multi) {
        for (const x of ret) pushValue(LL, rt, x)
        return ret.length
      }
      if (ret === undefined) return 0
      pushValue(LL, rt, ret)
      return 1
    } catch (err) {
      lua.lua_pushstring(LL, sl(String(err && err.message ? err.message : err)))
      return lua.lua_error(LL)
    }
  }, 2)
}

export {
  lua, lauxlib, lualib, to_luastring, sl,
  LUA_OK,
}

export function closeLuaState(L) {
  if (!L || typeof lua.lua_close !== 'function') return
  lua.lua_close(L)
}

export function installSandbox(L) {
  lua.lua_pushnil(L)
  lua.lua_setglobal(L, sl('_VERSION'))
  lua.lua_getglobal(L, sl('string'))
  if (!lua.lua_isnil(L, -1)) {
    lua.lua_pushnil(L)
    lua.lua_setfield(L, -2, sl('dump'))
  }
  lua.lua_pop(L, 1)
  lua.lua_pushnil(L)
  lua.lua_setglobal(L, sl('io'))
  lua.lua_getglobal(L, sl('os'))
  if (!lua.lua_isnil(L, -1)) {
    for (const name of Object.keys({
      execute: 1, getenv: 1, remove: 1, rename: 1, tmpname: 1,
      setlocale: 1, exit: 1,
    })) {
      lua.lua_pushnil(L)
      lua.lua_setfield(L, -2, sl(name))
    }
  }
  lua.lua_pop(L, 1)
  lua.lua_getglobal(L, sl('debug'))
  if (!lua.lua_isnil(L, -1)) {
    lua.lua_getfield(L, -1, sl('traceback'))
    lua.lua_newtable(L)
    lua.lua_pushvalue(L, -2)
    lua.lua_setfield(L, -2, sl('traceback'))
    lua.lua_setglobal(L, sl('debug'))
    lua.lua_pop(L, 2)
  } else {
    lua.lua_pop(L, 1)
  }
  lua.lua_getglobal(L, sl('math'))
  if (!lua.lua_isnil(L, -1)) {
    for (const name of ['modf', 'ult']) {
      lua.lua_pushnil(L)
      lua.lua_setfield(L, -2, sl(name))
    }
    lua.lua_pushcfunction(L, (LL) => {
      const n = lua.lua_tonumber(LL, 1)
      lua.lua_pushboolean(LL, Number.isNaN(n))
      return 1
    })
    lua.lua_setfield(L, -2, sl('isnan'))
    lua.lua_pushcfunction(L, (LL) => {
      const n = lua.lua_tonumber(LL, 1)
      lua.lua_pushboolean(LL, n === Infinity || n === -Infinity)
      return 1
    })
    lua.lua_setfield(L, -2, sl('isinf'))
  }
  lua.lua_pop(L, 1)
  lua.lua_pushnil(L)
  lua.lua_setglobal(L, sl('package'))
  lua.lua_pushnil(L)
  lua.lua_setglobal(L, sl('loadfile'))
  lua.lua_pushnil(L)
  lua.lua_setglobal(L, sl('dofile'))
  lua.lua_pushnil(L)
  lua.lua_setglobal(L, sl('coroutine'))
  lua.lua_pushnil(L)
  lua.lua_setglobal(L, sl('fengari'))
}
