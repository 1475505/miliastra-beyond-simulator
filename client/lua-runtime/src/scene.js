const TYPEOF = {
  container: 'ClientUIContainerControl',
  textbox: 'ClientUITextBoxControl',
  textwindow: 'ClientUITextWindowControl',
  image: 'ClientUIImageControl',
  button: 'ClientUIPresetButtonControl',
  cursor: 'ClientUICursorEventAreaControl',
  grid: 'ClientUIGridScrollerControl',
  keyhint: 'ClientUIKeyHintControl',
  animation: 'ClientUIAnimationControl',
  fullscreen: 'ClientUIFullscreenAnimationControl',
  reference: 'ClientUIReferenceControl',
}

const BASE_RO = ['alive', 'Id', 'prefabIndex', 'active', 'activeInHierarchy', 'visible']

/** Fields whose mutation invalidates the whole layout (anchors/pivot/size/activity). */
export const DEEP_DIRTY_FIELDS = new Set([
  'active', 'visible', 'parent',
  'sizeDeltaX', 'sizeDeltaY',
  'anchorMinX', 'anchorMinY', 'anchorMaxX', 'anchorMaxY',
  'pivotX', 'pivotY',
])
const BASE_RW = [
  'name', 'parent',
  'anchoredPositionX', 'anchoredPositionY', 'sizeDeltaX', 'sizeDeltaY',
  'anchorMinX', 'anchorMinY', 'anchorMaxX', 'anchorMaxY', 'pivotX', 'pivotY',
  'localScaleX', 'localScaleY', 'localScaleZ',
  'localRotationX', 'localRotationY', 'localRotationZ', 'canControllerFocus',
]
const KIND_RO = {
  image: ['imageSource', 'imageId'],
  grid: ['itemCount', 'scrollDirection', 'layoutConstraint', 'layoutConstraintFixedCount'],
  reference: ['referencedPrefabIndex'],
}
const KIND_RW = {
  container: ['isolateNavigation', 'disableKeyEventPassthrough', 'disableCursorEventPassthrough', 'showCursor'],
  textbox: ['text', 'fontSize', 'fontColor', 'bgColor', 'enableOutline', 'outlineColor', 'horizontalAlignment', 'verticalAlignment', 'adaptiveFontSize', 'minimumFontSize'],
  textwindow: ['interactable', 'showScrollBar', 'text', 'fontSize', 'fontColor', 'bgColor', 'enableOutline', 'outlineColor', 'horizontalAlignment', 'verticalAlignment', 'adaptiveFontSize', 'minimumFontSize'],
  // Documented RW. Observed: assigning after Instantiate reports
  // "cannot set imageType, no such field". Keep it off the Lua surface.
  image: ['imageColor', 'enableMask', 'enableSoftEdge', 'softEdgeMode', 'softEdgeWidthX', 'softEdgeWidthY', 'horizontalSoftRange', 'verticalSoftRange', 'reverseMaskArea', 'fillType', 'fillHorizontalType', 'fillVerticalType', 'fillRadial90Type', 'fillRadialType', 'fillAmount'],
  button: ['interactable', 'clickAudioId', 'raycastTarget'],
  cursor: ['raycastTarget'],
  grid: ['itemPrefabIndex', 'raycastTarget', 'showScrollBar', 'interactable', 'scrollProgress'],
  keyhint: ['keyboardKeyCode', 'controllerKeyCode'],
  animation: ['animationId', 'playSoundEffect', 'layer'],
  fullscreen: ['animationId', 'playSoundEffect'],
}
const BASE_METHODS = [
  'GetChildren', 'GetChild', 'FindChild',
  'SetActive', 'SetVisible',
  'GetSiblingIndex', 'SetSiblingIndex', 'SetAsFirstSibling', 'SetAsLastSibling',
  'GetAnchoredPosition', 'SetAnchoredPosition', 'GetSizeDelta', 'SetSizeDelta',
  'GetAnchorMin', 'SetAnchorMin', 'GetAnchorMax', 'SetAnchorMax',
  'GetPivot', 'SetPivot', 'GetLocalScale', 'SetLocalScale',
  'GetLocalRotation', 'SetLocalRotation',
  'GetScriptByPath', 'GetScript', 'GetScripts',
  'AddKeyEventListener', 'RemoveKeyEventListener', 'RemoveKeyEventListeners', 'RemoveAllKeyEventListeners',
  'AddNavigationEventListener', 'RemoveNavigationEventListener', 'RemoveNavigationEventListeners', 'RemoveAllNavigationEventListeners',
  'SetControllerNavigation', 'GetControllerNavigation',
]
const CURSOR_METHODS = [
  'AddCursorEventListener', 'RemoveCursorEventListener', 'RemoveCursorEventListeners',
  'RemoveAllCursorEventListeners', 'SimulateCursorClick',
]
const KIND_METHODS = {
  image: ['SetImage', 'SetSoftEdgeWidth', 'SetFillUnused', 'SetFillHorizontal', 'SetFillVertical', 'SetFillRadial90', 'SetFillRadial180', 'SetFillRadial360'],
  button: CURSOR_METHODS,
  cursor: CURSOR_METHODS,
  animation: ['PlayAnimation', 'StopAnimation'],
  grid: ['RefreshItems', 'GetItemIndex', 'GetItemSize', 'GetItemSpacing', 'GetPadding', 'ScrollToItemAt', 'GetContentLength'],
}

export function luaFieldAccess(control, key) {
  if (BASE_RO.includes(key) || (KIND_RO[control.kind] || []).includes(key)) return 'ro'
  if (BASE_RW.includes(key) || (KIND_RW[control.kind] || []).includes(key)) return 'rw'
  return null
}

export function luaHasMethod(control, key) {
  return BASE_METHODS.includes(key) || (KIND_METHODS[control.kind] || []).includes(key)
}

const DEFAULTS = {
  container: { isolateNavigation: false, disableKeyEventPassthrough: false, disableCursorEventPassthrough: false, showCursor: false },
  textbox: { text: '', fontSize: 20, fontColor: 0xffffffff, bgColor: 0, enableOutline: false, outlineColor: 0, horizontalAlignment: null, verticalAlignment: null, adaptiveFontSize: false, minimumFontSize: 10 },
  textwindow: { interactable: true, showScrollBar: true, text: '', fontSize: 20, fontColor: 0xffffffff, bgColor: 0, enableOutline: false, outlineColor: 0, horizontalAlignment: null, verticalAlignment: null, adaptiveFontSize: false, minimumFontSize: 10 },
  image: { imageSource: null, imageId: 0, imageColor: 0xffffffff, imageType: null, enableMask: false, enableSoftEdge: false, softEdgeMode: 'Percentage', softEdgeWidthX: 8, softEdgeWidthY: 8, horizontalSoftRange: 85, verticalSoftRange: 85, enableFill: false, fillType: 'Unused', fillHorizontalType: 'Left', fillVerticalType: 'Bottom', fillRadial90Type: 'BottomLeft', fillRadialType: 'Bottom', reverseMaskArea: false, fillAmount: 1 },
  button: { interactable: true, clickAudioId: 0, raycastTarget: true, unavailableChildId: null, hoverChildId: null, pressedChildId: null, selectedChildId: null, pressed: false },
  cursor: { raycastTarget: true },
  grid: { itemCount: 0, itemPrefabIndex: null, raycastTarget: true, interactable: true, showScrollBar: true, scrollDirection: 'Vertical', layoutConstraint: 'AutoWrap', layoutConstraintFixedCount: null, scrollProgress: 0, cellSizeX: 50, cellSizeY: 50, spacingX: 8, spacingY: 8, padding1X: 20, padding1Y: 20, padding2X: 20, padding2Y: 20, previewCount: 5 },
  keyhint: { keyboardKeyCode: null, controllerKeyCode: null },
  animation: { animationId: null, playSoundEffect: null, layer: null, raycastTarget: false },
  fullscreen: { animationId: null, playSoundEffect: null, raycastTarget: false },
  reference: { referencedPrefabIndex: null },
}

export class Control {
  constructor(runtime, spec) {
    this.runtime = runtime
    this.kind = spec.kind || 'container'
    this.typeofName = TYPEOF[this.kind] || TYPEOF.container
    this.alive = true
    this.Id = spec.Id ?? runtime.nextControlId()
    this.authoringId = spec.authoringId ?? null
    this.prefabIndex = spec.prefabIndex ?? 0
    this.name = spec.name ?? ''
    this.active = spec.active === true
    this.visible = spec.visible !== false
    this._parent = null
    this.children = []
    this.scripts = []
    this.cursorListeners = new Map()
    this.keyListeners = new Map()
    this.navListeners = new Map()
    this.navConfig = new Map()
    this.anchoredPositionX = spec.anchoredPositionX ?? 0
    this.anchoredPositionY = spec.anchoredPositionY ?? 0
    this.sizeDeltaX = spec.sizeDeltaX ?? 0
    this.sizeDeltaY = spec.sizeDeltaY ?? 0
    this.anchorMinX = spec.anchorMinX ?? 0.5
    this.anchorMinY = spec.anchorMinY ?? 0.5
    this.anchorMaxX = spec.anchorMaxX ?? 0.5
    this.anchorMaxY = spec.anchorMaxY ?? 0.5
    this.pivotX = spec.pivotX ?? 0.5
    this.pivotY = spec.pivotY ?? 0.5
    this.localScaleX = spec.localScaleX ?? 1
    this.localScaleY = spec.localScaleY ?? 1
    this.localScaleZ = spec.localScaleZ ?? 1
    this.localRotationX = spec.localRotationX ?? 0
    this.localRotationY = spec.localRotationY ?? 0
    this.localRotationZ = spec.localRotationZ ?? 0
    this.canControllerFocus = spec.canControllerFocus ?? false
    this._playDirty = true
    this._playDeepDirty = true
    this._playChildDirty = false
    const extra = DEFAULTS[this.kind] || {}
    for (const [k, v] of Object.entries(extra)) {
      if (this[k] === undefined) this[k] = spec[k] !== undefined ? spec[k] : v
    }
    if (spec.children) {
      for (const child of spec.children) {
        const c = child instanceof Control ? child : new Control(runtime, child)
        this.addChild(c)
      }
    }
  }

  get parent() {
    return this._parent
  }

  set parent(value) {
    if (this._parent === value) return
    if (value !== null && !(value instanceof Control)) {
      throw new Error('parent must be a Control or nil')
    }
    if (value && value.runtime !== this.runtime) {
      throw new Error('parent must belong to the same runtime')
    }
    if (value === this) {
      throw new Error('cannot parent a control to itself or its descendant')
    }
    for (let ancestor = value; ancestor; ancestor = ancestor._parent) {
      if (ancestor === this) throw new Error('cannot parent a control to itself or its descendant')
    }
    const oldParent = this._parent
    if (oldParent) {
      const i = oldParent.children.indexOf(this)
      if (i >= 0) oldParent.children.splice(i, 1)
      oldParent.markPlayDirty(true)
    } else {
      const rootIndex = this.runtime.roots.indexOf(this)
      if (rootIndex >= 0) this.runtime.roots.splice(rootIndex, 1)
    }
    this._parent = value
    this.markPlayDirty(true)
    if (value && !value.children.includes(this)) {
      value.children.push(this)
      value.markPlayDirty(true)
    } else if (!value && this.alive && !this.runtime.roots.includes(this)) {
      this.runtime.roots.push(this)
    }
  }

  markPlayDirty(deep = false) {
    this._playDirty = true
    if (deep) this._playDeepDirty = true
    for (let parent = this._parent; parent; parent = parent._parent) {
      if (parent._playChildDirty) break
      parent._playChildDirty = true
    }
  }

  get activeInHierarchy() {
    if (!this.active) return false
    return this._parent ? this._parent.activeInHierarchy : true
  }

  addChild(child) {
    child.parent = this
    return child
  }

  GetChildren() {
    return this.children.slice()
  }

  GetChild(name) {
    return this.children.find((c) => c.name === name) || null
  }

  FindChild(path) {
    if (!path) return null
    if (!path.includes('/')) return this.GetChild(path)
    const parts = path.split('/').filter(Boolean)
    let cur = this
    for (const p of parts) {
      cur = cur.GetChild(p)
      if (!cur) return null
    }
    return cur
  }

  SetActive(v) {
    const next = !!v
    if (this.active === next) return
    if (typeof this.runtime?.onControlActiveChanging === 'function') {
      this.runtime.onControlActiveChanging(this, next)
      return
    }
    this.active = next
    this.markPlayDirty(true)
  }

  SetVisible(v) {
    this.visible = !!v
    this.markPlayDirty(true)
  }

  GetSiblingIndex() {
    if (!this._parent) return -1
    // The stored tree is editor-facing (first child is on top). Lua's numeric
    // sibling index has the opposite direction: the largest index is on top.
    const children = this._parent.children
    const position = children.indexOf(this)
    return position < 0 ? -1 : children.length - 1 - position
  }

  SetSiblingIndex(index) {
    if (!this._parent) return false
    const arr = this._parent.children
    const i = arr.indexOf(this)
    if (i < 0) return false
    const max = arr.length - 1
    if (!Number.isInteger(index) || index < 0 || index > max) return false
    arr.splice(i, 1)
    arr.splice(max - index, 0, this)
    this._parent.markPlayDirty(true)
    this.markPlayDirty()
    return true
  }

  SetAsFirstSibling() {
    return this.SetSiblingIndex(0)
  }

  SetAsLastSibling() {
    if (!this._parent) return false
    return this.SetSiblingIndex(this._parent.children.length - 1)
  }

  GetAnchoredPosition() {
    return [this.anchoredPositionX, this.anchoredPositionY]
  }

  SetAnchoredPosition(x, y) {
    this.anchoredPositionX = x
    this.anchoredPositionY = y
    this.markPlayDirty()
  }

  GetSizeDelta() {
    return [this.sizeDeltaX, this.sizeDeltaY]
  }

  SetSizeDelta(x, y) {
    this.sizeDeltaX = x
    this.sizeDeltaY = y
    this.markPlayDirty(true)
  }

  GetAnchorMin() {
    return [this.anchorMinX, this.anchorMinY]
  }

  SetAnchorMin(x, y) {
    this.anchorMinX = x
    this.anchorMinY = y
    this.markPlayDirty(true)
  }

  GetAnchorMax() {
    return [this.anchorMaxX, this.anchorMaxY]
  }

  SetAnchorMax(x, y) {
    this.anchorMaxX = x
    this.anchorMaxY = y
    this.markPlayDirty(true)
  }

  GetPivot() {
    return [this.pivotX, this.pivotY]
  }

  SetPivot(x, y) {
    this.pivotX = x
    this.pivotY = y
    this.markPlayDirty(true)
  }

  GetLocalScale() {
    return [this.localScaleX, this.localScaleY, this.localScaleZ]
  }

  SetLocalScale(x, y, z) {
    this.localScaleX = x
    this.localScaleY = y
    this.localScaleZ = z
    this.markPlayDirty()
  }

  GetLocalRotation() {
    return [this.localRotationX, this.localRotationY, this.localRotationZ]
  }

  SetLocalRotation(x, y, z) {
    this.localRotationX = x
    this.localRotationY = y
    this.localRotationZ = z
    this.markPlayDirty()
  }

  GetScriptByPath(path) {
    return this.scripts.find((s) => s.path === path) || null
  }

  GetScript(scriptMappingId) {
    return this.scripts.find((s) => s.scriptMappingId === scriptMappingId) || null
  }

  GetScripts() {
    return this.scripts.slice()
  }

  _addListener(store, typeName, fn) {
    const list = store.get(typeName) || []
    list.push(fn)
    store.set(typeName, list)
  }

  _removeListener(store, typeName, fn) {
    const list = store.get(typeName)
    if (!list) return
    store.set(typeName, list.filter((x) => x !== fn))
    this.runtime.unrefLuaCallback?.(fn)
  }

  _removeListeners(store, typeName) {
    const list = store.get(typeName) || []
    for (const fn of list) this.runtime.unrefLuaCallback?.(fn)
    store.delete(typeName)
  }

  _removeAllListeners(store) {
    for (const list of store.values()) {
      for (const fn of list) this.runtime.unrefLuaCallback?.(fn)
    }
    store.clear()
  }

  AddCursorEventListener(typeName, fn) {
    this._addListener(this.cursorListeners, typeName, fn)
  }

  RemoveCursorEventListener(typeName, fn) {
    this._removeListener(this.cursorListeners, typeName, fn)
  }

  RemoveCursorEventListeners(typeName) {
    this._removeListeners(this.cursorListeners, typeName)
  }

  RemoveAllCursorEventListeners() {
    this._removeAllListeners(this.cursorListeners)
  }

  SimulateCursorClick() {
    const data = this.runtime.makeCursorEventData({ x: 0, y: 0, pressX: 0, pressY: 0 })
    this.emitCursor('CursorDown', data)
    this.emitCursor('CursorUp', data)
    this.emitCursor('CursorClick', data)
  }

  emitCursor(typeName, data) {
    if (!this.runtime.cursorEventsEnabled(this)) return
    const list = this.cursorListeners.get(typeName) || []
    for (const fn of list) fn(data)
  }

  AddKeyEventListener(typeName, fn) {
    this._addListener(this.keyListeners, typeName, fn)
  }

  RemoveKeyEventListener(typeName, fn) {
    this._removeListener(this.keyListeners, typeName, fn)
  }

  RemoveKeyEventListeners(typeName) {
    this._removeListeners(this.keyListeners, typeName)
  }

  RemoveAllKeyEventListeners() {
    this._removeAllListeners(this.keyListeners)
  }

  emitKey(typeName) {
    const list = this.keyListeners.get(typeName) || []
    for (const fn of list) {
      const ret = fn()
      if (ret === true) break
    }
  }

  AddNavigationEventListener(typeName, fn) {
    this._addListener(this.navListeners, typeName, fn)
  }

  RemoveNavigationEventListener(typeName, fn) {
    this._removeListener(this.navListeners, typeName, fn)
  }

  RemoveNavigationEventListeners(typeName) {
    this._removeListeners(this.navListeners, typeName)
  }

  RemoveAllNavigationEventListeners() {
    this._removeAllListeners(this.navListeners)
  }

  SetControllerNavigation(dir, mode, target) {
    this.navConfig.set(dir, { mode, target })
  }

  GetControllerNavigation(dir) {
    const v = this.navConfig.get(dir)
    const pair = v ? [v.mode, v.target] : [null, null]
    pair.__multi = true
    return pair
  }

  SetImage(source, id) {
    this.imageSource = source
    this.imageId = id
    this.markPlayDirty()
  }

  SetSoftEdgeWidth(x, y) {
    this.softEdgeWidthX = x
    this.softEdgeWidthY = y
    this.markPlayDirty()
  }

  SetFillUnused() {
    this.fillType = 'Unused'
    this.markPlayDirty()
  }

  SetFillHorizontal(t, a) {
    this.fillType = 'Horizontal'
    this.fillHorizontalType = t
    this.fillAmount = a
    this.markPlayDirty()
  }

  SetFillVertical(t, a) {
    this.fillType = 'Vertical'
    this.fillVerticalType = t
    this.fillAmount = a
    this.markPlayDirty()
  }

  SetFillRadial90(t, a) {
    this.fillType = 'Radial90'
    this.fillRadial90Type = t
    this.fillAmount = a
    this.markPlayDirty()
  }

  SetFillRadial180(t, a) {
    this.fillType = 'Radial180'
    this.fillRadialType = t
    this.fillAmount = a
    this.markPlayDirty()
  }

  SetFillRadial360(t, a) {
    this.fillType = 'Radial360'
    this.fillRadialType = t
    this.fillAmount = a
    this.markPlayDirty()
  }

  PlayAnimation() {
    // 界面动效尚未实现：方法保留为 Lua API 占位，保证脚本可调用而不抛错。
  }

  StopAnimation() {
    // 界面动效尚未实现：方法保留为 Lua API 占位，保证脚本可调用而不抛错。
  }

  RefreshItems() {
    throw new Error('ClientUIGridScrollerControl:RefreshItems not implemented')
  }

  GetItemIndex() {
    throw new Error('ClientUIGridScrollerControl:GetItemIndex not implemented')
  }

  GetItemSize() {
    throw new Error('ClientUIGridScrollerControl:GetItemSize not implemented')
  }

  GetItemSpacing() {
    throw new Error('ClientUIGridScrollerControl:GetItemSpacing not implemented')
  }

  GetPadding() {
    throw new Error('ClientUIGridScrollerControl:GetPadding not implemented')
  }

  ScrollToItemAt() {
    throw new Error('ClientUIGridScrollerControl:ScrollToItemAt not implemented')
  }

  GetContentLength() {
    throw new Error('ClientUIGridScrollerControl:GetContentLength not implemented')
  }
}

export function walk(root, fn) {
  fn(root)
  for (const c of root.children) walk(c, fn)
}

export function printTree(root, lines = [], indent = '') {
  lines.push(`${indent}${root.name || '(unnamed)'} [${root.typeofName}] Id=${root.Id}`)
  for (const c of root.children) printTree(c, lines, indent + '  ')
  return lines
}
