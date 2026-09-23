import {
  lua, lauxlib, lualib, to_luastring, sl,
  LUA_OK, pushValue, toJs, attachHost, hostOf, hostFromLua,
  installSandbox, luaString, SCRIPT_HOST_KEY, unrefLuaFunction, closeLuaState,
} from './lua-bridge.js'
import { Control, DEEP_DIRTY_FIELDS, luaFieldAccess, luaHasMethod, printTree, walk } from './scene.js'
import { Tween, TweenSequence } from './tween.js'
import { packRgba, unpackRgba } from './color.js'
import { buildEnumTree, makeEnumItem, canonicalEnumItem } from './enums.js'

const ENUM_FIELDS = {
  horizontalAlignment: 'TextHorizontalAlignment',
  verticalAlignment: 'TextVerticalAlignment',
  imageSource: 'ImageSource',
  fillType: 'ImageFillType',
  fillHorizontalType: 'ImageFillHorizontalType',
  fillVerticalType: 'ImageFillVerticalType',
  fillRadial90Type: 'ImageFillRadial90Type',
  fillRadialType: 'ImageFillRadialType',
  softEdgeMode: 'ImageMaskSoftEdgeMode',
  layer: 'UIAnimationLayer',
  scrollDirection: 'ScrollDirection',
  layoutConstraint: 'ScrollLayoutConstraint',
}

const LUA_REGISTRYINDEX = lua.LUA_REGISTRYINDEX
const LUA_MULTRET = lua.LUA_MULTRET

function enumName(v) {
  if (v == null) return ''
  if (typeof v === 'string') return v
  return v.Name || v.FullName || String(v)
}

export class LuaRuntime {
  constructor(options = {}) {
    this.canvasWidth = options.canvasWidth ?? 1600
    this.canvasHeight = options.canvasHeight ?? 900
    this.device = options.device ?? 'KeyboardAndMouse'
    this.language = options.language ?? 'LanguageChs'
    this.stageMode = options.stageMode ?? 'Classic'
    this.testPlay = options.testPlay !== false
    this.clock = { time: 0, levelTime: 0, paused: false, frame: 0 }
    this.logs = []
    this.mountErrors = []
    this.tweens = new Set()
    this.sequences = new Set()
    this.audios = new Map()
    this.nextAudioId = 1
    this._nextControlId = 1
    this._playRemoved = []
    this._nextScriptMappingId = 1
    this.lifecyclePhase = 'idle'
    this.controlsById = new Map()
    this.roots = []
    this.templates = new Map()
    this.scriptFiles = new Map()
    this.requireAliases = new Map()
    // Each mounted script owns a VM. Modules use isolated environments inside
    // that VM so Lua tables/functions never pass through the host value bridge.
    this.requireCache = new Map()
    this.moduleBaseEnvironments = new Map()
    this.luaFunctions = new Map()
    this.mountedScripts = []
    this.serverVars = {
      Level: Object.create(null),
      PlayerSelf: Object.create(null),
      AvatarSelf: Object.create(null),
    }
    this.serverBridge = null
    this.varHandlers = []
    this.signalHandlers = []
    this.cursor = { x: 0, y: 0 }
    this.focus = null
    this.stick = { left: [0, 0], right: [0, 0] }
    this.enumTree = buildEnumTree()
    this.luaStates = new Set()
    this.L = null
  }

  nextControlId() {
    const id = this._nextControlId
    this._nextControlId += 1
    return id
  }

  resolveScriptMappingId(value) {
    const id = Number(value)
    if (Number.isSafeInteger(id) && id > 0) {
      this._nextScriptMappingId = Math.max(this._nextScriptMappingId, id + 1)
      return id
    }
    const generated = this._nextScriptMappingId
    this._nextScriptMappingId += 1
    return generated
  }

  pushPackedColor(L, packed) {
    const v = packed >>> 0
    // Fengari Lua integers are 32-bit; values above 0x7fffffff must go as numbers.
    if ((v | 0) === v) lua.lua_pushinteger(L, v)
    else lua.lua_pushnumber(L, v)
  }

  unrefLuaCallback(fn) {
    unrefLuaFunction(this, fn)
  }

  log(level, ...args) {
    const text = args.map((a) => {
      if (a === null || a === undefined) return 'nil'
      if (typeof a === 'object' && a !== null && a.__kind === 'EnumItem') return a.Name
      return String(a)
    }).join('\t')
    this.logs.push({ level, text, time: this.clock.time })
  }

  safeCall(fn, ...args) {
    try {
      return fn(...args)
    } catch (err) {
      this.log('lua-error', err && err.message ? err.message : String(err))
    }
  }

  scriptCanRun(script) {
    if (!script?.alive || !script.enabled) return false
    const object = script.object
    return !object || (object.alive && object.activeInHierarchy)
  }

  cursorEventsEnabled(control) {
    for (let current = control; current; current = current.parent) {
      if (current.kind === 'container' && current.showCursor === true) return true
    }
    return false
  }

  registerTemplate(prefabIndex, spec) {
    this.templates.set(Number(prefabIndex), spec)
  }

  registerScriptFile(path, source) {
    const key = this.normalizeRequirePath(path)
    this.scriptFiles.set(key, source)
    // DSH 导入文件统一放在虚拟 default_import_file 根下，避免与运行时内建模块混名。
    // 保留裸路径是旧存档兼容层；新脚本应显式 require("default_import_file/<映射路径>")。
    if (!key.startsWith('default_import_file/')) {
      this.requireAliases.set(`default_import_file/${key}`, key)
    }
  }

  normalizeRequirePath(path) {
    let p = String(path).replace(/\\/g, '/')
    if (p.endsWith('.lua')) p = p.slice(0, -4)
    return p
  }

  addRoot(spec) {
    const root = spec instanceof Control ? spec : new Control(this, spec)
    this.roots.push(root)
    walk(root, (c) => this.controlsById.set(c.Id, c))
    this.mountSpecScripts(spec, root)
    return root
  }

  mountSpecScripts(spec, control) {
    if (spec instanceof Control) return
    const hasScripts = (node) => (node.scripts?.length || 0) > 0 || (node.children || []).some(hasScripts)
    if (!spec || !hasScripts(spec)) return
    const savedPhase = this.lifecyclePhase
    try {
      const rec = (node, target) => {
        for (const script of node.scripts || []) {
          try {
            this.mountScript({
              path: script.path,
              source: script.source,
              control: target,
              scriptMappingId: script.scriptMappingId,
            })
          } catch (err) {
            const message = err && err.message ? err.message : String(err)
            this.mountErrors.push(message)
            this.log('lua-error', message)
          }
        }
        const children = node.children || []
        for (let i = 0; i < children.length; i += 1) rec(children[i], target?.children?.[i])
      }
      rec(spec, control)
    } finally {
      this.lifecyclePhase = savedPhase
    }
  }

  makeCursorEventData({
    x = 0,
    y = 0,
    pressX = x,
    pressY = y,
    deltaX = x - pressX,
    deltaY = y - pressY,
    dragging = false,
    touchId = -1,
  } = {}) {
    const self = this
    return {
      __kind: 'CursorEventData',
      typeofName: 'CursorEventData',
      dragging,
      touchId,
      x,
      y,
      pressX,
      pressY,
      GetUIPos() {
        return [x, y]
      },
      GetPressUIPos() {
        return [pressX, pressY]
      },
      GetUIPosDelta() {
        return [deltaX, deltaY]
      },
    }
  }

  boot() {
    const L = this.newLuaThread()
    this.L = L
  }

  installGlobals(L) {
    const rt = this
    lua.lua_pushcfunction(L, (LL) => {
      const n = lua.lua_gettop(LL)
      const args = []
      for (let i = 1; i <= n; i++) args.push(toJs(LL, rt, i))
      rt.log('info', ...args)
      return 0
    })
    lua.lua_setglobal(L, sl('print'))

    lua.lua_pushcfunction(L, (LL) => {
      const n = lua.lua_gettop(LL)
      const args = []
      for (let i = 1; i <= n; i++) args.push(toJs(LL, rt, i))
      rt.log('error', ...args)
      return 0
    })
    lua.lua_setglobal(L, sl('printerr'))

    lua.lua_pushcfunction(L, (LL) => {
      const v = toJs(LL, rt, 1)
      lua.lua_pushstring(LL, sl(rt.typeofOf(v)))
      return 1
    })
    lua.lua_setglobal(L, sl('typeof'))

    this.pushColorLib(L)
    this.pushEnumLib(L)
    this.pushGameLib(L)

    lua.lua_pushcfunction(L, (LL) => rt.luaRequire(LL))
    lua.lua_setglobal(L, sl('require'))
  }

  typeofOf(v) {
    if (v == null) return 'nil'
    if (v.__kind === 'Script') return 'Script'
    if (v.__kind === 'EnumItem') return 'EnumItem'
    if (v.__kind === 'CursorEventData') return 'CursorEventData'
    if (v.typeofName) return v.typeofName
    if (typeof v === 'number') return 'number'
    if (typeof v === 'string') return 'string'
    if (typeof v === 'boolean') return 'boolean'
    return typeof v
  }

  pushColorLib(L) {
    lua.lua_newtable(L)
    lua.lua_pushcfunction(L, (LL) => {
      this.pushPackedColor(LL, packRgba(lua.lua_tonumber(LL, 1), lua.lua_tonumber(LL, 2), lua.lua_tonumber(LL, 3), 255))
      return 1
    })
    lua.lua_setfield(L, -2, sl('FromRGB'))
    lua.lua_pushcfunction(L, (LL) => {
      const a = lua.lua_isnoneornil(LL, 4) ? 255 : lua.lua_tonumber(LL, 4)
      this.pushPackedColor(LL, packRgba(lua.lua_tonumber(LL, 1), lua.lua_tonumber(LL, 2), lua.lua_tonumber(LL, 3), a))
      return 1
    })
    lua.lua_setfield(L, -2, sl('FromRGBA'))
    lua.lua_pushcfunction(L, (LL) => {
      const packed = lua.lua_tonumber(LL, 1) >>> 0
      const [r, g, b, a] = unpackRgba(packed)
      lua.lua_pushnumber(LL, r)
      lua.lua_pushnumber(LL, g)
      lua.lua_pushnumber(LL, b)
      lua.lua_pushnumber(LL, a)
      return 4
    })
    lua.lua_setfield(L, -2, sl('ToRGBA'))
    lua.lua_newtable(L)
    lua.lua_pushcfunction(L, (LL) => {
      const r = lua.lua_tonumber(LL, 2)
      const g = lua.lua_tonumber(LL, 3)
      const b = lua.lua_tonumber(LL, 4)
      const a = lua.lua_isnoneornil(LL, 5) ? 255 : lua.lua_tonumber(LL, 5)
      this.pushPackedColor(LL, packRgba(r, g, b, a))
      return 1
    })
    lua.lua_setfield(L, -2, sl('__call'))
    lua.lua_setmetatable(L, -2)
    lua.lua_setglobal(L, sl('Color'))
  }

  pushEnumLib(L) {
    lua.lua_newtable(L)
    for (const [type, group] of Object.entries(this.enumTree)) {
      lua.lua_newtable(L)
      for (const [name, item] of Object.entries(group)) {
        this.pushEnumItem(L, item)
        lua.lua_setfield(L, -2, sl(name))
      }
      lua.lua_setfield(L, -2, sl(type))
    }
    lua.lua_setglobal(L, sl('Enum'))
  }

  pushEnumItem(L, item) {
    const ud = lua.lua_newuserdata(L, 0)
    attachHost(ud, item)
    lauxlib.luaL_setmetatable(L, sl('EnumItem'))
  }

  pushControl(L, control) {
    const ud = lua.lua_newuserdata(L, 0)
    attachHost(ud, control)
    lauxlib.luaL_setmetatable(L, sl('Control'))
  }

  pushScript(L, script) {
    lua.lua_newtable(L)
    lua.lua_pushlightuserdata(L, SCRIPT_HOST_KEY)
    const ud = lua.lua_newuserdata(L, 0)
    attachHost(ud, script)
    lua.lua_rawset(L, -3)
    lauxlib.luaL_getmetatable(L, sl('Script'))
    lua.lua_setmetatable(L, -2)
  }

  pushTween(L, tw) {
    const ud = lua.lua_newuserdata(L, 0)
    attachHost(ud, tw)
    const mt = tw.Append ? 'TweenSequence' : 'Tween'
    lauxlib.luaL_setmetatable(L, sl(mt))
  }

  pushCursor(L, data) {
    const ud = lua.lua_newuserdata(L, 0)
    attachHost(ud, data)
    lauxlib.luaL_setmetatable(L, sl('CursorEventData'))
  }

  pushGameLib(L) {
    const rt = this
    lua.lua_newtable(L)
    const methods = {
      InstantiateClientUIControl: (LL) => {
        const prefabIndex = lua.lua_tointeger(LL, 1)
        const parent = hostOf(lua.lua_touserdata(LL, 2))
        const created = rt.instantiate(prefabIndex, parent, rt.lifecyclePhase)
        if (!created) {
          lua.lua_pushnil(LL)
          return 1
        }
        rt.pushControl(LL, created)
        return 1
      },
      DestroyClientUIControl: (LL) => {
        const c = hostOf(lua.lua_touserdata(LL, 1))
        if (c) rt.destroyControl(c)
        return 0
      },
      GetClientUIControl: (LL) => {
        const controlId = lua.lua_tointeger(LL, 1)
        const c = rt.controlsById.get(controlId)
        if (!c) lua.lua_pushnil(LL)
        else rt.pushControl(LL, c)
        return 1
      },
      FindClientUIRoot: (LL) => {
        const name = luaString(LL, 1)
        const c = rt.roots.find((r) => r.name === name)
        if (!c) lua.lua_pushnil(LL)
        else rt.pushControl(LL, c)
        return 1
      },
      GetClientUIRoots: (LL) => {
        lua.lua_createtable(LL, rt.roots.length, 0)
        rt.roots.forEach((r, i) => {
          rt.pushControl(LL, r)
          lua.lua_rawseti(LL, -2, i + 1)
        })
        return 1
      },
      GetUICanvasSize: (LL) => {
        lua.lua_pushnumber(LL, rt.canvasWidth)
        lua.lua_pushnumber(LL, rt.canvasHeight)
        return 2
      },
      GetCursorUIPos: (LL) => {
        lua.lua_pushnumber(LL, rt.cursor.x)
        lua.lua_pushnumber(LL, rt.cursor.y)
        return 2
      },
      GetDevice: (LL) => {
        rt.pushEnumItem(LL, makeEnumItem('Device', rt.device))
        return 1
      },
      SetControllerFocus: (LL) => {
        rt.focus = hostOf(lua.lua_touserdata(LL, 1))
        return 0
      },
      GetControllerFocus: (LL) => {
        if (!rt.focus) lua.lua_pushnil(LL)
        else rt.pushControl(LL, rt.focus)
        return 1
      },
      GetControllerLeftStickAxis: (LL) => {
        lua.lua_pushnumber(LL, rt.stick.left[0])
        lua.lua_pushnumber(LL, rt.stick.left[1])
        return 2
      },
      GetControllerRightStickAxis: (LL) => {
        lua.lua_pushnumber(LL, rt.stick.right[0])
        lua.lua_pushnumber(LL, rt.stick.right[1])
        return 2
      },
      Tween: (LL) => {
        const obj = hostOf(lua.lua_touserdata(LL, 1)) || toJs(LL, rt, 1)
        const data = toJs(LL, rt, 2) || {}
        const dur = lua.lua_tonumber(LL, 3)
        const tw = new Tween(rt, obj, data, dur)
        rt.pushTween(LL, tw)
        return 1
      },
      TweenSequence: (LL) => {
        rt.pushTween(LL, new TweenSequence(rt))
        return 1
      },
      ServerSignal: (LL) => {
        const name = luaString(LL, 1)
        const sig = rt.makeServerSignal(name)
        const ud = lua.lua_newuserdata(LL, 0)
        attachHost(ud, sig)
        lauxlib.luaL_setmetatable(LL, sl('ServerSignal'))
        return 1
      },
      GetGlobalCustomVariableValue: (LL) => {
        const et = enumName(toJs(LL, rt, 1))
        const name = luaString(LL, 2)
        pushValue(LL, rt, rt.getVar(et, name))
        return 1
      },
      PauseLevelTime: (LL) => {
        rt.clock.paused = !!lua.lua_toboolean(LL, 1)
        return 0
      },
      IsLevelTimePaused: (LL) => {
        lua.lua_pushboolean(LL, rt.clock.paused)
        return 1
      },
      PlayAudio2D: (LL) => {
        const id = rt.nextAudioId++
        rt.audios.set(id, { audioId: lua.lua_tointeger(LL, 1), alive: true })
        lua.lua_pushinteger(LL, id)
        return 1
      },
      StopAudio: (LL) => {
        const id = lua.lua_tointeger(LL, 1)
        const a = rt.audios.get(id)
        if (a) a.alive = false
        return 0
      },
      IsAudioAlive: (LL) => {
        const a = rt.audios.get(lua.lua_tointeger(LL, 1))
        lua.lua_pushboolean(LL, !!(a && a.alive))
        return 1
      },
      GetLanguageType: (LL) => {
        rt.pushEnumItem(LL, makeEnumItem('LanguageType', rt.language))
        return 1
      },
      GetStageMode: (LL) => {
        rt.pushEnumItem(LL, makeEnumItem('StageMode', rt.stageMode))
        return 1
      },
      IsTestPlay: (LL) => {
        lua.lua_pushboolean(LL, rt.testPlay)
        return 1
      },
      GetText: (LL) => {
        const id = luaString(LL, 1)
        lua.lua_pushstring(LL, sl(id))
        return 1
      },
      PrintClientUITree: (LL) => {
        for (const r of rt.roots) {
          rt.log('info', printTree(r).join('\n'))
        }
        return 0
      },
    }
    for (const [name, fn] of Object.entries(methods)) {
      lua.lua_pushcfunction(L, fn)
      lua.lua_setfield(L, -2, sl(name))
    }
    lua.lua_setglobal(L, sl('game'))
  }

  makeServerSignal(name) {
    const params = []
    const rt = this
    return {
      __kind: 'ServerSignal',
      name,
      AddParam(type, value) {
        params.push({ type: enumName(type), value })
      },
      AddInt(v) { params.push({ type: 'Int', value: v }) },
      AddIntList(v) { params.push({ type: 'IntList', value: v }) },
      AddFloat(v) { params.push({ type: 'Float', value: v }) },
      AddFloatList(v) { params.push({ type: 'FloatList', value: v }) },
      AddString(v) { params.push({ type: 'String', value: v }) },
      AddStringList(v) { params.push({ type: 'StringList', value: v }) },
      AddVector3(v) { params.push({ type: 'Vector3', value: v }) },
      AddVector3List(v) { params.push({ type: 'Vector3List', value: v }) },
      AddBool(v) { params.push({ type: 'Bool', value: v }) },
      AddBoolList(v) { params.push({ type: 'BoolList', value: v }) },
      AddGuid(v) { params.push({ type: 'Guid', value: v }) },
      AddGuidList(v) { params.push({ type: 'GuidList', value: v }) },
      AddEntity(v) { params.push({ type: 'Entity', value: v }) },
      AddEntityList(v) { params.push({ type: 'EntityList', value: v }) },
      AddPrefabId(v) { params.push({ type: 'PrefabId', value: v }) },
      AddPrefabIdList(v) { params.push({ type: 'PrefabIdList', value: v }) },
      AddConfigId(v) { params.push({ type: 'ConfigId', value: v }) },
      AddConfigIdList(v) { params.push({ type: 'ConfigIdList', value: v }) },
      SendSignal() {
        const packed = params.slice()
        if (rt.serverBridge && typeof rt.serverBridge.receiveFromClient === 'function') {
          rt.serverBridge.receiveFromClient(name, packed)
        }
      },
    }
  }

  instantiate(prefabIndex, parent, phase) {
    if (phase === 'OnInit' || phase === 'OnDestroy') return null
    const spec = this.templates.get(Number(prefabIndex))
    if (!spec || !parent) return null
    const control = new Control(this, {
      ...spec,
      Id: this.nextControlId(),
      authoringId: null,
      prefabIndex: Number(prefabIndex),
    })
    parent.addChild(control)
    walk(control, (child) => this.controlsById.set(child.Id, child))
    this.mountSpecScripts(spec, control)
    return control
  }

  destroyControl(control) {
    if (!control || !control.alive) return
    if (control._destroying) {
      throw new Error(`客户端控件生命周期处于创建或销毁时，无法调用DestroyClientUIControl, ID:${control.name}`)
    }
    walk(control, (child) => { child._destroying = true })
    this._destroyControlTree(control)
  }

  _destroyControlTree(control) {
    this.releaseControlListeners(control)
    for (const script of control.scripts.slice()) this.unmountScript(script)
    for (const child of control.children.slice()) this._destroyControlTree(child)
    control.alive = false
    this._playRemoved.push(control.Id)
    if (control.parent) {
      const parent = control.parent
      const i = parent.children.indexOf(control)
      if (i >= 0) parent.children.splice(i, 1)
      control._parent = null
      parent.markPlayDirty(true)
    } else {
      const rootIndex = this.roots.indexOf(control)
      if (rootIndex >= 0) this.roots.splice(rootIndex, 1)
    }
    this.controlsById.delete(control.Id)
    if (this.focus === control) this.focus = null
    for (const tween of [...this.tweens]) {
      if (tween.object === control) tween.Kill(false)
    }
  }

  releaseControlListeners(control) {
    for (const list of control.cursorListeners.values()) {
      for (const fn of list) this.unrefLuaCallback(fn)
    }
    for (const list of control.keyListeners.values()) {
      for (const fn of list) this.unrefLuaCallback(fn)
    }
    for (const list of control.navListeners.values()) {
      for (const fn of list) this.unrefLuaCallback(fn)
    }
    control.cursorListeners.clear()
    control.keyListeners.clear()
    control.navListeners.clear()
    control.navConfig.clear()
  }

  onControlActiveChanging(control, nextActive) {
    const affected = []
    walk(control, (child) => affected.push({ control: child, was: child.activeInHierarchy }))
    control.active = !!nextActive
    control.markPlayDirty(true)
    for (const item of affected) {
      const now = item.control.activeInHierarchy
      if (item.was === now) continue
      for (const script of item.control.scripts.slice()) {
        if (now) this.enableScript(script)
        else this.disableScript(script)
      }
    }
  }

  bindScriptEnv(script) {
    const L = script.env
    if (!L) return null
    this.pushScript(L, script)
    lua.lua_setglobal(L, sl('script'))
    return L
  }

  disableScript(script) {
    if (!script?.alive || !script.env) return
    if (script.lifecyclePhase !== 'running') return
    const savedPhase = this.lifecyclePhase
    this.lifecyclePhase = 'OnDisable'
    script.lifecyclePhase = 'OnDisable'
    this.bindScriptEnv(script)
    this.callGlobal(script.env, 'OnDisable')
    script.lifecyclePhase = 'disabled'
    this.lifecyclePhase = savedPhase
  }

  enableScript(script) {
    if (!script?.alive || !script.env) return
    if (script.lifecyclePhase !== 'disabled') return
    const savedPhase = this.lifecyclePhase
    this.lifecyclePhase = 'OnEnable'
    script.lifecyclePhase = 'OnEnable'
    this.bindScriptEnv(script)
    this.callGlobal(script.env, 'OnEnable')
    script.lifecyclePhase = 'running'
    this.lifecyclePhase = savedPhase
  }

  unmountScript(script) {
    if (!script || !script.alive) return
    const L = script.env
    const savedPhase = this.lifecyclePhase
    if (L) {
      if (script.lifecyclePhase === 'running') {
        this.lifecyclePhase = 'OnDisable'
        script.lifecyclePhase = 'OnDisable'
        this.bindScriptEnv(script)
        this.callGlobal(L, 'OnDisable')
      }
      this.lifecyclePhase = 'OnDestroy'
      script.lifecyclePhase = 'OnDestroy'
      this.bindScriptEnv(script)
      this.callGlobal(L, 'OnDestroy')
    }
    script.alive = false
    script.lifecyclePhase = 'destroyed'
    this.lifecyclePhase = savedPhase
    this.mountedScripts = this.mountedScripts.filter((item) => item !== script)
    if (script.object) script.object.scripts = script.object.scripts.filter((item) => item !== script)
    this.varHandlers = this.varHandlers.filter((handler) => handler.script !== script)
    this.signalHandlers = this.signalHandlers.filter((handler) => handler.script !== script)
    if (L) {
      if (L !== this.L) this.closeTrackedLuaState(L)
    }
    script.env = null
  }

  installMetatables(L) {
    this.mtEnum(L)
    this.mtControl(L)
    this.mtScript(L)
    this.mtTween(L)
    this.mtSeq(L)
    this.mtSignal(L)
    this.mtCursor(L)
  }

  mtIndexNewindex(L, name, getField, setField, methods, hasMethod) {
    lauxlib.luaL_newmetatable(L, sl(name))
    lua.lua_pushcfunction(L, (LL) => {
      const obj = hostFromLua(LL, 1) || hostOf(lua.lua_touserdata(LL, 1))
      const key = luaString(LL, 2)
      if (methods[key] && (!hasMethod || hasMethod(obj, key))) {
        lua.lua_pushcfunction(LL, methods[key])
        return 1
      }
      const v = getField(obj, key)
      if (v === undefined) {
        lua.lua_pushnil(LL)
        return 1
      }
      pushValue(LL, this, v)
      return 1
    })
    lua.lua_setfield(L, -2, sl('__index'))
    lua.lua_pushcfunction(L, (LL) => {
      try {
        const obj = hostFromLua(LL, 1) || hostOf(lua.lua_touserdata(LL, 1))
        const key = luaString(LL, 2)
        const val = toJs(LL, this, 3)
        setField(obj, key, val)
        return 0
      } catch (err) {
        lua.lua_pushstring(LL, sl(String(err.message || err)))
        return lua.lua_error(LL)
      }
    })
    lua.lua_setfield(L, -2, sl('__newindex'))
    lua.lua_pushcfunction(L, (LL) => {
      const a = hostFromLua(LL, 1) || hostOf(lua.lua_touserdata(LL, 1))
      const b = hostFromLua(LL, 2) || hostOf(lua.lua_touserdata(LL, 2))
      lua.lua_pushboolean(LL, a === b)
      return 1
    })
    lua.lua_setfield(L, -2, sl('__eq'))
    lua.lua_pop(L, 1)
  }

  method(fn) {
    const rt = this
    return (LL) => {
      const obj = hostFromLua(LL, 1) || hostOf(lua.lua_touserdata(LL, 1))
      const n = lua.lua_gettop(LL)
      const args = []
      for (let i = 2; i <= n; i++) args.push(toJs(LL, rt, i))
      try {
        const ret = fn(obj, ...args)
        if (ret === obj) {
          lua.lua_pushvalue(LL, 1)
          return 1
        }
        if (ret === undefined) return 0
        if (Array.isArray(ret) && ret.__multi) {
          for (const x of ret) pushValue(LL, rt, x)
          return ret.length
        }
        if (Array.isArray(ret) && !(ret.length && typeof ret[0] === 'object' && ret[0]?.typeofName)) {
          if (ret.__controls) {
            lua.lua_createtable(LL, ret.length, 0)
            ret.forEach((c, i) => {
              rt.pushControl(LL, c)
              lua.lua_rawseti(LL, -2, i + 1)
            })
            return 1
          }
          if (ret.__scripts) {
            lua.lua_createtable(LL, ret.length, 0)
            ret.forEach((s, i) => {
              rt.pushScript(LL, s)
              lua.lua_rawseti(LL, -2, i + 1)
            })
            return 1
          }
          if (typeof ret[0] === 'number' && ret.length <= 4) {
            for (const x of ret) lua.lua_pushnumber(LL, x)
            return ret.length
          }
        }
        pushValue(LL, rt, ret)
        return 1
      } catch (err) {
        lua.lua_pushstring(LL, sl(String(err.message || err)))
        return lua.lua_error(LL)
      }
    }
  }

  mtEnum(L) {
    const fields = new Set(['Name', 'FullName', 'EnumType'])
    this.mtIndexNewindex(
      L,
      'EnumItem',
      (obj, key) => (fields.has(key) ? obj[key] : undefined),
      (_obj, key) => {
        throw new Error(`cannot set ${key}, no such field`)
      },
      {},
    )
  }

  mtCursor(L) {
    const fields = new Set(['dragging', 'touchId'])
    this.mtIndexNewindex(
      L,
      'CursorEventData',
      (obj, key) => (fields.has(key) ? obj[key] : undefined),
      (_obj, key) => {
        throw new Error(`cannot set ${key}, no such field`)
      },
      {
        GetUIPos: this.method((o) => o.GetUIPos()),
        GetPressUIPos: this.method((o) => o.GetPressUIPos()),
        GetUIPosDelta: this.method((o) => o.GetUIPosDelta()),
      },
    )
  }

  mtControl(L) {
    const methods = {
      GetChildren: this.method((o) => {
        const a = o.GetChildren()
        a.__controls = true
        return a
      }),
      GetChild: this.method((o, name) => o.GetChild(name)),
      FindChild: this.method((o, path) => o.FindChild(path)),
      SetActive: this.method((o, v) => o.SetActive(v)),
      SetVisible: this.method((o, v) => o.SetVisible(v)),
      GetSiblingIndex: this.method((o) => o.GetSiblingIndex()),
      SetSiblingIndex: this.method((o, i) => o.SetSiblingIndex(i)),
      SetAsFirstSibling: this.method((o) => o.SetAsFirstSibling()),
      SetAsLastSibling: this.method((o) => o.SetAsLastSibling()),
      GetAnchoredPosition: this.method((o) => o.GetAnchoredPosition()),
      SetAnchoredPosition: this.method((o, x, y) => o.SetAnchoredPosition(x, y)),
      GetSizeDelta: this.method((o) => o.GetSizeDelta()),
      SetSizeDelta: this.method((o, x, y) => o.SetSizeDelta(x, y)),
      GetAnchorMin: this.method((o) => o.GetAnchorMin()),
      SetAnchorMin: this.method((o, x, y) => o.SetAnchorMin(x, y)),
      GetAnchorMax: this.method((o) => o.GetAnchorMax()),
      SetAnchorMax: this.method((o, x, y) => o.SetAnchorMax(x, y)),
      GetPivot: this.method((o) => o.GetPivot()),
      SetPivot: this.method((o, x, y) => o.SetPivot(x, y)),
      GetLocalScale: this.method((o) => o.GetLocalScale()),
      SetLocalScale: this.method((o, x, y, z) => o.SetLocalScale(x, y, z)),
      GetLocalRotation: this.method((o) => o.GetLocalRotation()),
      SetLocalRotation: this.method((o, x, y, z) => o.SetLocalRotation(x, y, z)),
      GetScriptByPath: this.method((o, p) => o.GetScriptByPath(p)),
      GetScript: this.method((o, id) => o.GetScript(id)),
      GetScripts: this.method((o) => {
        const a = o.GetScripts()
        a.__scripts = true
        return a
      }),
      AddCursorEventListener: this.method((o, t, fn) => o.AddCursorEventListener(enumName(t), fn)),
      RemoveCursorEventListener: this.method((o, t, fn) => o.RemoveCursorEventListener(enumName(t), fn)),
      RemoveCursorEventListeners: this.method((o, t) => o.RemoveCursorEventListeners(enumName(t))),
      RemoveAllCursorEventListeners: this.method((o) => o.RemoveAllCursorEventListeners()),
      SimulateCursorClick: this.method((o) => o.SimulateCursorClick()),
      AddKeyEventListener: this.method((o, t, fn) => o.AddKeyEventListener(enumName(t), fn)),
      RemoveKeyEventListener: this.method((o, t, fn) => o.RemoveKeyEventListener(enumName(t), fn)),
      RemoveKeyEventListeners: this.method((o, t) => o.RemoveKeyEventListeners(enumName(t))),
      RemoveAllKeyEventListeners: this.method((o) => o.RemoveAllKeyEventListeners()),
      AddNavigationEventListener: this.method((o, t, fn) => o.AddNavigationEventListener(enumName(t), fn)),
      RemoveNavigationEventListener: this.method((o, t, fn) => o.RemoveNavigationEventListener(enumName(t), fn)),
      RemoveNavigationEventListeners: this.method((o, t) => o.RemoveNavigationEventListeners(enumName(t))),
      RemoveAllNavigationEventListeners: this.method((o) => o.RemoveAllNavigationEventListeners()),
      SetControllerNavigation: this.method((o, d, m, t) => o.SetControllerNavigation(enumName(d), m, t)),
      GetControllerNavigation: this.method((o, d) => o.GetControllerNavigation(enumName(d))),
      SetImage: this.method((o, s, id) => o.SetImage(s, id)),
      SetSoftEdgeWidth: this.method((o, x, y) => o.SetSoftEdgeWidth(x, y)),
      SetFillUnused: this.method((o) => o.SetFillUnused()),
      SetFillHorizontal: this.method((o, t, a) => o.SetFillHorizontal(t, a)),
      SetFillVertical: this.method((o, t, a) => o.SetFillVertical(t, a)),
      SetFillRadial90: this.method((o, t, a) => o.SetFillRadial90(t, a)),
      SetFillRadial180: this.method((o, t, a) => o.SetFillRadial180(t, a)),
      SetFillRadial360: this.method((o, t, a) => o.SetFillRadial360(t, a)),
      PlayAnimation: this.method((o) => o.PlayAnimation()),
      StopAnimation: this.method((o) => o.StopAnimation()),
      RefreshItems: this.method((o) => o.RefreshItems()),
      GetItemIndex: this.method((o) => o.GetItemIndex()),
      GetItemSize: this.method((o) => o.GetItemSize()),
      GetItemSpacing: this.method((o) => o.GetItemSpacing()),
      GetPadding: this.method((o) => o.GetPadding()),
      ScrollToItemAt: this.method((o) => o.ScrollToItemAt()),
      GetContentLength: this.method((o) => o.GetContentLength()),
    }
    this.mtIndexNewindex(
      L,
      'Control',
      (obj, key) => {
        if (!luaFieldAccess(obj, key)) return undefined
        const value = obj[key]
        const enumType = ENUM_FIELDS[key]
        return enumType ? canonicalEnumItem(enumType, value) : value
      },
      (obj, key, val) => {
        const access = luaFieldAccess(obj, key)
        if (access === 'rw') {
          const enumType = ENUM_FIELDS[key]
          obj[key] = enumType ? canonicalEnumItem(enumType, val) : val
          if (typeof obj.markPlayDirty === 'function') {
            obj.markPlayDirty(DEEP_DIRTY_FIELDS.has(key))
          }
          return
        }
        throw new Error(`cannot set ${key}, no such field`)
      },
      methods,
      luaHasMethod,
    )
  }

  mtScript(L) {
    const rt = this
    const fields = new Set(['alive', 'scriptMappingId', 'object', 'path', 'enabled'])
    this.mtIndexNewindex(
      L,
      'Script',
      (obj, key) => (fields.has(key) ? obj[key] : undefined),
      (obj, key, val) => {
        if (key === 'enabled') {
          obj.enabled = !!val
          return
        }
        throw new Error(`cannot set ${key}, no such field`)
      },
      {
        GetParam: this.method((o, name) => (Object.prototype.hasOwnProperty.call(o.params, name) ? o.params[name] : null)),
        Invoke: this.method((o, name, ...args) => o.invoke(name, args)),
        EnableUpdate: this.method((o, v) => { o.updateEnabled = !!v }),
        RegisterServerSignalHandler: this.method((o, name, fn) => {
          rt.signalHandlers.push({ script: o, name, fn })
        }),
        UnregisterServerSignalHandler: this.method((o, name) => {
          rt.signalHandlers = rt.signalHandlers.filter((h) => !(h.script === o && h.name === name))
        }),
        RegisterCustomVariableChangedHandler: this.method((o, et, name, fn) => {
          rt.varHandlers.push({ script: o, entityType: enumName(et), name, fn })
        }),
        UnregisterCustomVariableChangedHandler: this.method((o, et, name) => {
          const e = enumName(et)
          rt.varHandlers = rt.varHandlers.filter((h) => !(h.script === o && h.entityType === e && h.name === name))
        }),
      },
    )
  }

  mtTween(L) {
    this.mtIndexNewindex(L, 'Tween', () => undefined, () => {}, {
      SetEase: this.method((o, e) => o.SetEase(e)),
      SetRelative: this.method((o, v) => o.SetRelative(v)),
      Play: this.method((o) => o.Play()),
      Pause: this.method((o) => o.Pause()),
      Resume: this.method((o) => o.Resume()),
      Restart: this.method((o) => o.Restart()),
      Complete: this.method((o) => o.Complete()),
      Kill: this.method((o, c) => o.Kill(c)),
      SetOnComplete: this.method((o, fn) => o.SetOnComplete(fn)),
      SetOnStepComplete: this.method((o, fn) => o.SetOnStepComplete(fn)),
      SetLoops: this.method((o, n) => o.SetLoops(n)),
    })
  }

  mtSeq(L) {
    this.mtIndexNewindex(L, 'TweenSequence', () => undefined, () => {}, {
      Append: this.method((o, t) => o.Append(t)),
      AppendInterval: this.method((o, n) => o.AppendInterval(n)),
      AppendCallback: this.method((o, fn) => o.AppendCallback(fn)),
      Join: this.method((o, t) => o.Join(t)),
      Insert: this.method((o, t, tw) => o.Insert(t, tw)),
      InsertCallback: this.method((o, t, fn) => o.InsertCallback(t, fn)),
      Play: this.method((o) => o.Play()),
      Pause: this.method((o) => o.Pause()),
      Resume: this.method((o) => o.Resume()),
      Restart: this.method((o) => o.Restart()),
      Complete: this.method((o) => o.Complete()),
      Kill: this.method((o, c) => o.Kill(c)),
      SetOnComplete: this.method((o, fn) => o.SetOnComplete(fn)),
      SetOnStepComplete: this.method((o, fn) => o.SetOnStepComplete(fn)),
      SetLoops: this.method((o, n) => o.SetLoops(n)),
    })
  }

  mtSignal(L) {
    this.mtIndexNewindex(L, 'ServerSignal', () => undefined, () => {}, {
      AddParam: this.method((o, t, v) => o.AddParam(t, v)),
      SendSignal: this.method((o) => o.SendSignal()),
      AddInt: this.method((o, v) => o.AddInt(v)),
      AddIntList: this.method((o, v) => o.AddIntList(v)),
      AddFloat: this.method((o, v) => o.AddFloat(v)),
      AddFloatList: this.method((o, v) => o.AddFloatList(v)),
      AddString: this.method((o, v) => o.AddString(v)),
      AddStringList: this.method((o, v) => o.AddStringList(v)),
      AddVector3: this.method((o, v) => o.AddVector3(v)),
      AddVector3List: this.method((o, v) => o.AddVector3List(v)),
      AddBool: this.method((o, v) => o.AddBool(v)),
      AddBoolList: this.method((o, v) => o.AddBoolList(v)),
      AddGuid: this.method((o, v) => o.AddGuid(v)),
      AddGuidList: this.method((o, v) => o.AddGuidList(v)),
      AddEntity: this.method((o, v) => o.AddEntity(v)),
      AddEntityList: this.method((o, v) => o.AddEntityList(v)),
      AddPrefabId: this.method((o, v) => o.AddPrefabId(v)),
      AddPrefabIdList: this.method((o, v) => o.AddPrefabIdList(v)),
      AddConfigId: this.method((o, v) => o.AddConfigId(v)),
      AddConfigIdList: this.method((o, v) => o.AddConfigIdList(v)),
    })
  }

  luaRequire(L) {
    const raw = luaString(L, 1)
    const requestedPath = this.normalizeRequirePath(raw)
    const path = this.requireAliases.get(requestedPath) || requestedPath
    // Coroutines share their main thread's registry and module identity.
    lua.lua_rawgeti(L, LUA_REGISTRYINDEX, lua.LUA_RIDX_MAINTHREAD)
    const owner = lua.lua_tothread(L, -1)
    lua.lua_pop(L, 1)
    let cache = this.requireCache.get(owner)
    if (!cache) { cache = new Map(); this.requireCache.set(owner, cache) }
    const cached = cache.get(path)
    if (cached?.loading) {
      lua.lua_pushstring(L, sl(`failed to load script '${requestedPath}': cyclic require`))
      return lua.lua_error(L)
    }
    if (cached && cached.ref != null) {
      lua.lua_rawgeti(L, LUA_REGISTRYINDEX, cached.ref)
      return 1
    }
    const source = this.scriptFiles.get(path)
    if (source == null) {
      lua.lua_pushstring(L, sl(`failed to load script '${requestedPath}'`))
      return lua.lua_error(L)
    }
    const top = lua.lua_gettop(L)
    cache.set(path, { loading: true })
    try {
      this.loadModule(L, owner, path, source)
      lua.lua_pushvalue(L, -1)
      const ref = lauxlib.luaL_ref(L, LUA_REGISTRYINDEX)
      cache.set(path, { ref })
      return 1
    } catch (err) {
      cache.delete(path)
      lua.lua_settop(L, top)
      lua.lua_pushstring(L, sl(`failed to load script '${requestedPath}': ${err.message || err}`))
      return lua.lua_error(L)
    }
  }

  newLuaThread() {
    const L = lauxlib.luaL_newstate()
    lualib.luaL_openlibs(L)
    installSandbox(L)
    this.installMetatables(L)
    this.installGlobals(L)
    this.luaStates.add(L)
    // Capture only the pristine sandbox/host surface, before the caller adds
    // globals. Copying the caller's live _G would leak its application globals.
    lua.lua_pushglobaltable(L)
    this.copyLuaEnvironment(L, -1)
    lua.lua_remove(L, -2)
    this.moduleBaseEnvironments.set(L, lauxlib.luaL_ref(L, LUA_REGISTRYINDEX))
    return L
  }

  copyLuaEnvironment(L, source) {
    const from = lua.lua_absindex(L, source)
    lua.lua_newtable(L)
    const target = lua.lua_absindex(L, -1)
    lua.lua_pushnil(L)
    while (lua.lua_next(L, from) !== 0) {
      lua.lua_pushvalue(L, -2)
      lua.lua_pushvalue(L, -2)
      lua.lua_rawset(L, target)
      lua.lua_pop(L, 1)
    }
    lua.lua_pushvalue(L, target)
    lua.lua_setfield(L, target, sl('_G'))
  }

  closeTrackedLuaState(L) {
    if (!L || !this.luaStates.has(L)) return
    for (const cached of this.requireCache.get(L)?.values() || []) {
      if (cached.ref != null) lauxlib.luaL_unref(L, LUA_REGISTRYINDEX, cached.ref)
    }
    this.requireCache.delete(L)
    const baseRef = this.moduleBaseEnvironments.get(L)
    if (baseRef != null) lauxlib.luaL_unref(L, LUA_REGISTRYINDEX, baseRef)
    this.moduleBaseEnvironments.delete(L)
    this.luaStates.delete(L)
    if (this.luaFunctions) {
      for (const [ptr, fn] of this.luaFunctions) {
        if (fn.__luaState === L) this.luaFunctions.delete(ptr)
      }
    }
    closeLuaState(L)
  }

  loadModule(L, owner, path, source) {
    const dummy = {
      __kind: 'Script',
      alive: true,
      scriptMappingId: this.resolveScriptMappingId(),
      object: null,
      path,
      enabled: true,
      updateEnabled: false,
      params: {},
      env: L,
      invoke() {
        return undefined
      },
    }
    const src = String(source).replace(/^\uFEFF/, '')
    const buf = to_luastring(src)
    const status = lauxlib.luaL_loadbuffer(L, buf, buf.length, sl(`@${path}`))
    if (status !== LUA_OK) {
      throw new Error(luaString(L, -1))
    }
    const chunk = lua.lua_absindex(L, -1)
    lua.lua_rawgeti(L, LUA_REGISTRYINDEX, this.moduleBaseEnvironments.get(owner))
    this.copyLuaEnvironment(L, -1)
    lua.lua_remove(L, -2)
    this.pushScript(L, dummy)
    lua.lua_setfield(L, -2, sl('script'))
    lua.lua_setupvalue(L, chunk, 1) // Lua 5.3 chunks' first upvalue is _ENV.
    const call = lua.lua_pcall(L, 0, 1, 0)
    if (call !== LUA_OK) {
      throw new Error(luaString(L, -1))
    }
    // Leave the actual Lua return value on the caller's stack. Its metatable,
    // cycles, closures, upvalues and thread values are part of the value.
  }

  mountScript({ path, source, control, params = {}, scriptMappingId = undefined }) {
    if (!this.L) this.boot()
    const L = this.newLuaThread()
    const rec = {
      __kind: 'Script',
      alive: true,
      scriptMappingId: this.resolveScriptMappingId(scriptMappingId),
      object: control,
      path: this.normalizeRequirePath(path),
      enabled: true,
      updateEnabled: false,
      params,
      env: L,
      lifecyclePhase: 'idle',
    }
    rec.invoke = (name, args) => this.invokeOn(L, name, args)
    if (control) control.scripts.push(rec)
    this.mountedScripts.push(rec)
    this.pushScript(L, rec)
    lua.lua_setglobal(L, sl('script'))
    const savedPhase = this.lifecyclePhase
    try {
      this.lifecyclePhase = 'OnInit'
      rec.lifecyclePhase = 'OnInit'
      this.runChunk(L, source, path)
      const initError = this.callGlobal(L, 'OnInit')
      if (initError) this.mountErrors.push(initError)
      this.lifecyclePhase = 'OnEnable'
      rec.lifecyclePhase = 'OnEnable'
      const enableError = this.callGlobal(L, 'OnEnable')
      if (enableError) this.mountErrors.push(enableError)
      this.lifecyclePhase = 'OnStart'
      rec.lifecyclePhase = 'OnStart'
      const startError = this.callGlobal(L, 'OnStart')
      if (startError) this.mountErrors.push(startError)
      this.lifecyclePhase = 'running'
      rec.lifecyclePhase = 'running'
      return rec
    } catch (error) {
      rec.alive = false
      rec.lifecyclePhase = 'failed'
      this.mountedScripts = this.mountedScripts.filter((item) => item !== rec)
      if (control) control.scripts = control.scripts.filter((item) => item !== rec)
      this.varHandlers = this.varHandlers.filter((handler) => handler.script !== rec)
      this.signalHandlers = this.signalHandlers.filter((handler) => handler.script !== rec)
      this.lifecyclePhase = savedPhase
      if (L && L !== this.L) this.closeTrackedLuaState(L)
      rec.env = null
      throw error
    }
  }

  runChunk(L, source, name) {
    const src = String(source).replace(/^\uFEFF/, '')
    const buf = to_luastring(src)
    const status = lauxlib.luaL_loadbuffer(L, buf, buf.length, sl(`@${name}`))
    if (status !== LUA_OK) {
      const msg = luaString(L, -1) || `luaL_loadbuffer status ${status}`
      lua.lua_pop(L, 1)
      throw new Error(msg)
    }
    const call = lua.lua_pcall(L, 0, 0, 0)
    if (call !== LUA_OK) {
      const msg = luaString(L, -1) || `lua_pcall status ${call}`
      lua.lua_pop(L, 1)
      throw new Error(msg)
    }
  }

  callGlobal(L, name) {
    lua.lua_getglobal(L, sl(name))
    if (lua.lua_isfunction(L, -1)) {
      const st = lua.lua_pcall(L, 0, 0, 0)
      if (st !== LUA_OK) {
        const msg = luaString(L, -1)
        lua.lua_pop(L, 1)
        const error = `${name}: ${msg}`
        this.log('lua-error', error)
        return error
      }
    } else {
      lua.lua_pop(L, 1)
    }
    return null
  }

  callGlobalDt(L, name, dt) {
    lua.lua_getglobal(L, sl(name))
    if (lua.lua_isfunction(L, -1)) {
      lua.lua_pushnumber(L, dt)
      const st = lua.lua_pcall(L, 1, 0, 0)
      if (st !== LUA_OK) {
        const msg = luaString(L, -1)
        lua.lua_pop(L, 1)
        this.log('lua-error', `${name}: ${msg}`)
      }
    } else {
      lua.lua_pop(L, 1)
    }
  }

  invokeOn(L, name, args) {
    const top = lua.lua_gettop(L)
    lua.lua_getglobal(L, sl(name))
    if (!lua.lua_isfunction(L, -1)) {
      lua.lua_settop(L, top)
      return undefined
    }
    for (const a of args) pushValue(L, this, a)
    const st = lua.lua_pcall(L, args.length, LUA_MULTRET, 0)
    if (st !== LUA_OK) {
      const msg = luaString(L, -1)
      lua.lua_settop(L, top)
      throw new Error(msg)
    }
    const n = lua.lua_gettop(L) - top
    if (n <= 0) {
      lua.lua_settop(L, top)
      return undefined
    }
    if (n === 1) {
      const ret = toJs(L, this, -1)
      lua.lua_settop(L, top)
      return ret
    }
    const results = []
    for (let i = 1; i <= n; i++) results.push(toJs(L, this, top + i))
    lua.lua_settop(L, top)
    results.__multi = true
    return results
  }

  runScriptPhase(phaseName, dt) {
    for (const s of this.mountedScripts) {
      if (!this.scriptCanRun(s)) continue
      const L = s.env
      if (!L) continue
      this.pushScript(L, s)
      lua.lua_setglobal(L, sl('script'))
      if (phaseName === 'OnUpdate' && !s.updateEnabled) continue
      this.callGlobalDt(L, phaseName, dt)
    }
  }

  step(dt = 1 / 30) {
    if (typeof dt !== 'number' || !Number.isFinite(dt) || dt < 0) {
      throw new TypeError('dt must be a finite non-negative number')
    }
    this.clock.frame++
    this.clock.time += dt
    const levelUpdateScheduled = !this.clock.paused
    for (const tw of [...this.tweens]) tw.step(dt)
    for (const seq of [...this.sequences]) seq.step(dt)
    this.runScriptPhase('OnUpdate', dt)
    if (levelUpdateScheduled) {
      this.clock.levelTime += dt
      this.runScriptPhase('OnLevelUpdate', dt)
    }
  }

  injectKey(typeName) {
    for (const root of this.roots) {
      walk(root, (c) => {
        if (c.alive && c.activeInHierarchy && c.keyListeners.has(typeName)) c.emitKey(typeName)
      })
    }
  }

  injectCursor(control, typeName, data) {
    const event = data || this.makeCursorEventData({})
    if (Number.isFinite(event.x) && Number.isFinite(event.y)) {
      this.cursor.x = event.x
      this.cursor.y = event.y
    }
    control.emitCursor(typeName, event)
  }

  getVar(entityType, name) {
    if (this.serverBridge && typeof this.serverBridge.getVar === 'function') {
      return this.serverBridge.getVar(entityType, name)
    }
    const bag = this.serverVars[entityType]
    return bag ? bag[name] : undefined
  }

  notifyVarHandlers(entityType, name) {
    for (const h of this.varHandlers) {
      if (this.scriptCanRun(h.script) && h.entityType === entityType && h.name === name) {
        this.safeCall(h.fn, this.enumTree.CustomVariableEntityType[entityType], name)
      }
    }
  }

  setVar(entityType, name, value) {
    if (this.serverBridge && typeof this.serverBridge.setVar === 'function') {
      this.serverBridge.setVar(entityType, name, value)
      return
    }
    const bag = this.serverVars[entityType] || (this.serverVars[entityType] = Object.create(null))
    bag[name] = value
    this.notifyVarHandlers(entityType, name)
  }

  sendClientSignal(name, params) {
    for (const h of this.signalHandlers) {
      if (this.scriptCanRun(h.script) && h.name === name) this.safeCall(h.fn, name, params)
    }
  }

  evalQueryScript(source, query) {
    if (!this.L) this.boot()
    const L = this.L
    lua.lua_createtable(L, 0, 5)
    const setFn = (name, fn) => {
      lua.lua_pushcfunction(L, fn)
      lua.lua_setfield(L, -2, sl(name))
    }
    setFn('var', (LL) => {
      pushValue(LL, this, query.var(luaString(LL, 1), luaString(LL, 2)))
      return 1
    })
    setFn('logContains', (LL) => {
      lua.lua_pushboolean(LL, query.logContains(luaString(LL, 1)))
      return 1
    })
    setFn('control', (LL) => {
      pushValue(LL, this, query.control(luaString(LL, 1)))
      return 1
    })
    setFn('logs', (LL) => {
      pushValue(LL, this, query.logs())
      return 1
    })
    setFn('signals', (LL) => {
      pushValue(LL, this, query.signals(luaString(LL, 1)))
      return 1
    })
    setFn('serverLogs', (LL) => {
      pushValue(LL, this, query.serverLogs ? query.serverLogs() : [])
      return 1
    })
    setFn('serverLogContains', (LL) => {
      const fn = query.serverLogContains
      lua.lua_pushboolean(LL, fn ? !!fn(luaString(LL, 1)) : false)
      return 1
    })
    lua.lua_setglobal(L, sl('query'))
    this.runChunk(L, source, 'autotest-assert')
    return true
  }

  destroy() {
    for (const root of this.roots.slice()) this.destroyControl(root)
    for (const script of this.mountedScripts.slice()) this.unmountScript(script)
    this.lifecyclePhase = 'idle'
    this.mountedScripts = []
    this.luaFunctions.clear()
    for (const L of [...this.luaStates]) this.closeTrackedLuaState(L)
    this.L = null
  }
}

export function createRuntime(options) {
  const rt = new LuaRuntime(options)
  rt.boot()
  return rt
}
