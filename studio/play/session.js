import { createRuntime, walkControls as walk } from 'qxqy-lua-runtime'
import { createServer, normalizePlayerCount, normalizePlayerIndex } from 'qxqy-server'
import { compileProject } from './compile.js'
import { assertLosslessJson } from '../json.js'
import { CANVAS_PRESETS, IMAGE_PRIMITIVES } from '../constants.js'
import {
  applyMatrix,
  canvasBox,
  composeRectMatrix,
  computeRect,
  identityMatrix,
  invertMatrix,
  localRectMatrix,
} from '../ui/layout.js'
import { recordEvent } from '../autotest/format.js'

const CANVAS_PRESET_LIST = Object.freeze(
  Object.values(CANVAS_PRESETS).map((preset) => Object.freeze({
    id: preset.id,
    label: preset.label,
    platform: preset.platform,
    width: preset.width,
    height: preset.height,
  })),
)

export function runtimeLayout(session) {
  const rootBox = canvasBox({ width: session.runtime.canvasWidth, height: session.runtime.canvasHeight })
  const boxes = new Map()
  function rec(control, parentBox, parentActive) {
    const box = computeRect(parentBox, control)
    box.activeInHierarchy = parentActive && control.active !== false
    boxes.set(control.Id, box)
    const nextActive = box.activeInHierarchy
    for (const child of control.children) rec(child, box, nextActive)
  }
  for (const root of session.runtime.roots) rec(root, rootBox, true)
  return boxes
}

// Layout boxes intentionally remain in their untransformed RectTransform
// space: anchors resolve against a parent's rect, not its scaled visual size.
// This companion map applies every ancestor's scale/rotation for painting and
// pointer hit testing.
export function runtimeTransforms(session, boxes = runtimeLayout(session)) {
  const transforms = new Map()
  function rec(control, parentMatrix) {
    const box = boxes.get(control.Id)
    if (!box) return
    const matrix = composeRectMatrix(parentMatrix, box, control)
    transforms.set(control.Id, matrix)
    for (const child of control.children) rec(child, matrix)
  }
  for (const root of session.runtime.roots) rec(root, identityMatrix())
  return transforms
}

export function controlSnapshot(control, boxes) {
  const box = boxes.get(control.Id)
  // 快照 JSON 键沿用编辑器契约（id/prefabId），取自 Lua API 的 Id/prefabIndex 字段。
  return {
    id: control.Id,
    prefabId: control.prefabIndex,
    authoringId: control.authoringId,
    name: control.name,
    kind: control.kind,
    typeofName: control.typeofName,
    instantiated: !control.authoringId,
    active: !!control.active,
    visible: !!control.visible,
    activeInHierarchy: !!box?.activeInHierarchy,
    raycastTarget: control.raycastTarget !== false,
    interactable: control.interactable !== false,
    pressed: control.pressed === true,
    anchoredPositionX: control.anchoredPositionX,
    anchoredPositionY: control.anchoredPositionY,
    sizeDeltaX: control.sizeDeltaX,
    sizeDeltaY: control.sizeDeltaY,
    localScaleX: control.localScaleX,
    localScaleY: control.localScaleY,
    localScaleZ: control.localScaleZ,
    localRotationZ: control.localRotationZ,
    text: control.kind === 'textbox' || control.kind === 'textwindow' ? (control.text ?? '') : null,
    fontSize: control.kind === 'textbox' || control.kind === 'textwindow' ? control.fontSize : null,
    fontColor: control.kind === 'textbox' || control.kind === 'textwindow' ? control.fontColor : null,
    bgColor: control.kind === 'textbox' || control.kind === 'textwindow' ? control.bgColor : null,
    enableOutline: control.kind === 'textbox' || control.kind === 'textwindow' ? control.enableOutline === true : null,
    outlineColor: control.kind === 'textbox' || control.kind === 'textwindow' ? control.outlineColor : null,
    imageId: control.kind === 'image' ? (control.imageId ?? 0) : null,
    primitive: control.kind === 'image' ? (IMAGE_PRIMITIVES[control.imageId] || 'missing') : null,
    imageColor: control.kind === 'image' ? control.imageColor : null,
    enableMask: control.kind === 'image' ? control.enableMask === true : null,
    enableSoftEdge: control.kind === 'image' ? control.enableSoftEdge === true : null,
    softEdgeMode: control.kind === 'image' ? control.softEdgeMode : null,
    softEdgeWidthX: control.kind === 'image' ? control.softEdgeWidthX : null,
    softEdgeWidthY: control.kind === 'image' ? control.softEdgeWidthY : null,
    horizontalSoftRange: control.kind === 'image' ? control.horizontalSoftRange : null,
    verticalSoftRange: control.kind === 'image' ? control.verticalSoftRange : null,
    enableFill: control.kind === 'image' ? control.enableFill === true : null,
    fillType: control.kind === 'image' ? control.fillType : null,
    fillHorizontalType: control.kind === 'image' ? control.fillHorizontalType : null,
    fillVerticalType: control.kind === 'image' ? control.fillVerticalType : null,
    fillRadial90Type: control.kind === 'image' ? control.fillRadial90Type : null,
    fillRadialType: control.kind === 'image' ? control.fillRadialType : null,
    reverseMaskArea: control.kind === 'image' ? control.reverseMaskArea === true : null,
    fillAmount: control.kind === 'image' ? control.fillAmount : null,
    box: box ? {
      left: box.left,
      bottom: box.bottom,
      width: box.width,
      height: box.height,
    } : null,
    children: control.children.map((c) => controlSnapshot(c, boxes)),
  }
}

function emptyPlayerView() {
  return {
    pointerDownControl: null,
    pointerDownPosition: null,
    pointerLastPosition: null,
    pointerDragging: false,
    pointerHoverControl: null,
    hoveredControl: null,
    selectedControl: null,
    stateRestores: new Map(),
    viewCache: null,
  }
}

function createPlayerRuntime(compiled, templateBundle, scripts, language) {
  const rt = createRuntime({
    canvasWidth: compiled.canvasWidth,
    canvasHeight: compiled.canvasHeight,
    device: compiled.device,
    ...(language ? { language } : {}),
  })
  for (const template of [...(compiled.templates || []), ...(templateBundle?.templates || [])]) {
    if (Number.isSafeInteger(template.prefabIndex) && template.prefabIndex > 0) {
      rt.registerTemplate(template.prefabIndex, template)
    }
  }
  for (const script of scripts) {
    const path = script.path || script.id
    const source = script.source || ''
    if (path && source) rt.registerScriptFile(path, source)
  }
  return rt
}

const VIEW_FIELDS = [
  'pointerDownControl', 'pointerDownPosition', 'pointerLastPosition', 'pointerDragging',
  'pointerHoverControl', 'hoveredControl', 'selectedControl', 'stateRestores', 'viewCache',
]

function bindCurrentView(session) {
  Object.defineProperty(session, 'runtime', {
    configurable: true,
    enumerable: true,
    get() { return session.runtimes[session.viewPlayerIndex - 1] },
  })
  for (const key of VIEW_FIELDS) {
    Object.defineProperty(session, key, {
      configurable: true,
      enumerable: true,
      get() { return session.views[session.viewPlayerIndex - 1][key] },
      set(value) { session.views[session.viewPlayerIndex - 1][key] = value },
    })
  }
}

export function startPlay(project, { templatesProject = null, scripts = [], sceneScripts = null, templateScripts = null, serverConfig = null, canvasId = '', playerCount = 1, viewPlayerIndex = 1, language = '' } = {}) {
  const sceneList = sceneScripts || scripts
  const templateList = templateScripts || scripts
  const compiled = compileProject(project, sceneList, canvasId)
  const templateBundle = templatesProject ? compileProject(templatesProject, templateList, canvasId) : null
  const count = normalizePlayerCount(playerCount)
  const view = normalizePlayerIndex(viewPlayerIndex, count)
  const server = createServer({ playerCount: count, viewPlayerIndex: view })
  if (serverConfig) server.loadConfig({ ...serverConfig, playerCount: count, viewPlayerIndex: view })
  const runtimes = []
  for (let i = 0; i < count; i += 1) runtimes.push(createPlayerRuntime(compiled, templateBundle, scripts, language))
  server.attachRuntimes(runtimes)
  for (const rt of runtimes) rt.addRoot(compiled.root)
  const session = {
    runtimes,
    views: runtimes.map(() => emptyPlayerView()),
    playerCount: count,
    viewPlayerIndex: view,
    server,
    compiled,
    mountError: runtimes.find((rt) => rt.mountErrors[0])?.mountErrors[0] || null,
    debugPaused: false,
    history: { events: [] },
    recording: true,
  }
  bindCurrentView(session)
  const savedView = session.viewPlayerIndex
  for (let i = 1; i <= count; i += 1) {
    session.viewPlayerIndex = i
    prepareButtonStates(session)
  }
  session.viewPlayerIndex = savedView
  return session
}

export function setPlayView(session, playerIndex) {
  if (!session) throw new Error('play session has not started')
  const next = normalizePlayerIndex(playerIndex, session.playerCount)
  if (next === session.viewPlayerIndex) return next
  remember(session, { kind: 'view', payload: { playerIndex: next } })
  session.viewPlayerIndex = next
  session.viewCache = null
  if (session.server) session.server.setViewPlayerIndex(next)
  return next
}

function remember(session, event) {
  if (!session?.recording || !session.history) return
  recordEvent(session.history, { ...event, source: event.source || 'user' }, session.runtime.clock.time)
}

function historyRows(session) {
  return session?.history?.events || []
}

const PAINT_KINDS = new Set(['image', 'textbox', 'textwindow', 'button'])

// Pixi receives an affine matrix so nested non-uniform scale and rotation do
// not lose information through a single angle/size decomposition.
function paintTransform(box, matrix) {
  const center = applyMatrix(matrix, box.centerX, box.centerY)
  return {
    centerX: center.x,
    centerY: center.y,
    scaleX: Math.hypot(matrix.a, matrix.b),
    scaleY: Math.hypot(matrix.c, matrix.d),
    rotationZ: Math.atan2(matrix.b, matrix.a) * 180 / Math.PI,
    matrix: {
      a: matrix.a,
      b: matrix.b,
      c: matrix.c,
      d: matrix.d,
      tx: center.x,
      ty: center.y,
    },
  }
}

function enumName(value) {
  // Authoring starts with enum names; a documented Lua assignment stores an
  // EnumItem. Keep Runtime identity intact, but publish one stable scene DTO
  // representation for both PNG and Pixi renderers and their visual caches.
  return typeof value === 'string' ? value : value?.Name
}

function imageFillFields(control) {
  return {
    fillType: enumName(control.fillType),
    fillHorizontalType: enumName(control.fillHorizontalType),
    fillVerticalType: enumName(control.fillVerticalType),
    fillAmount: control.fillAmount,
  }
}

function compactPaint(control, box, transform) {
  const width = Math.abs(box.width * transform.scaleX)
  const height = Math.abs(box.height * transform.scaleY)
  const item = {
    id: control.Id,
    kind: control.kind,
    name: control.name,
    left: transform.centerX - width / 2,
    bottom: transform.centerY - height / 2,
    width,
    height,
    sourceWidth: box.width,
    sourceHeight: box.height,
    rotationZ: transform.rotationZ,
    matrix: transform.matrix,
    pressed: control.pressed === true,
  }
  if (control.kind === 'image') {
    item.primitive = IMAGE_PRIMITIVES[control.imageId] || 'missing'
    item.imageColor = control.imageColor
    item.imageId = control.imageId
    Object.assign(item, imageFillFields(control))
  }
  if (control.kind === 'textbox' || control.kind === 'textwindow') {
    item.text = control.text ?? ''
    item.fontSize = control.fontSize
    item.fontColor = control.fontColor
    item.bgColor = control.bgColor
    item.enableOutline = control.enableOutline === true
    item.outlineColor = control.outlineColor
    item.horizontalAlignment = enumName(control.horizontalAlignment)
    item.verticalAlignment = enumName(control.verticalAlignment)
  }
  return item
}

export function paintList(session, boxes = runtimeLayout(session)) {
  const out = []
  const transforms = runtimeTransforms(session, boxes)
  function rec(control) {
    const box = boxes.get(control.Id)
    if (!box || control.visible === false || !box.activeInHierarchy) return
    const matrix = transforms.get(control.Id)
    if (!matrix) return
    const transform = paintTransform(box, matrix)
    if (PAINT_KINDS.has(control.kind)) out.push(compactPaint(control, box, transform))
    const children = control.children || []
    for (let i = children.length - 1; i >= 0; i -= 1) rec(children[i])
  }
  for (const root of session.runtime.roots) rec(root)
  return out
}

function visualFields(control, box) {
  const fields = {
    kind: control.kind,
    name: control.name,
    sourceWidth: box.width,
    sourceHeight: box.height,
    pressed: control.pressed === true,
  }
  if (control.kind === 'image') {
    fields.primitive = IMAGE_PRIMITIVES[control.imageId] || 'missing'
    fields.imageColor = control.imageColor
    fields.imageId = control.imageId
    Object.assign(fields, imageFillFields(control))
  }
  if (control.kind === 'textbox' || control.kind === 'textwindow') {
    fields.text = control.text ?? ''
    fields.fontSize = control.fontSize
    fields.fontColor = control.fontColor
    fields.bgColor = control.bgColor
    fields.enableOutline = control.enableOutline === true
    fields.outlineColor = control.outlineColor
    fields.horizontalAlignment = enumName(control.horizontalAlignment)
    fields.verticalAlignment = enumName(control.verticalAlignment)
  }
  return fields
}

function localCenterMatrix(box, control, parentBox) {
  const local = localRectMatrix(box, control)
  const center = applyMatrix(local, box.centerX, box.centerY)
  return {
    a: local.a,
    b: local.b,
    c: local.c,
    d: local.d,
    tx: center.x - (parentBox ? parentBox.centerX : 0),
    ty: center.y - (parentBox ? parentBox.centerY : 0),
  }
}

function sceneFingerprint(node) {
  const m = node.matrix
  return [
    node.parent, node.z, node.group ? 1 : 0,
    m.a, m.b, m.c, m.d, m.tx, m.ty,
    node.kind, node.name, node.sourceWidth, node.sourceHeight, node.pressed,
    node.primitive, node.imageColor, node.imageId,
    node.fillType, node.fillHorizontalType, node.fillVerticalType, node.fillAmount,
    node.text, node.fontSize, node.fontColor, node.bgColor,
    node.enableOutline, node.outlineColor, node.horizontalAlignment, node.verticalAlignment,
  ].join('\t')
}

function sceneNode(control, parentId, parentBox, box, z, paintedChildren) {
  // tree-v1 z is the stored front-to-back tree position, not Lua's numeric
  // sibling index. Keep this wire convention; renderers negate the position.
  return {
    id: control.Id,
    parent: parentId,
    z,
    group: paintedChildren >= 16,
    matrix: localCenterMatrix(box, control, parentBox),
    ...visualFields(control, box),
  }
}

function collectSceneNodes(session) {
  const rootBox = canvasBox({ width: session.runtime.canvasWidth, height: session.runtime.canvasHeight })
  const include = new Set()
  const childCounts = new Map()
  const boxes = new Map()
  function mark(control, parentBox, parentActive) {
    const box = computeRect(parentBox, control)
    box.activeInHierarchy = parentActive && control.active !== false
    boxes.set(control.Id, box)
    if (control.visible === false || !box.activeInHierarchy) return false
    const children = control.children || []
    let keep = PAINT_KINDS.has(control.kind)
    let paintedChildren = 0
    for (let i = 0; i < children.length; i += 1) {
      if (mark(children[i], box, box.activeInHierarchy)) {
        keep = true
        paintedChildren += 1
      }
    }
    if (!keep) return false
    include.add(control.Id)
    childCounts.set(control.Id, paintedChildren)
    return true
  }
  function emit(control, parentId, parentBox, z) {
    if (!include.has(control.Id)) return
    const box = boxes.get(control.Id)
    nodes.push(sceneNode(control, parentId, parentBox, box, z, childCounts.get(control.Id) || 0))
    const children = control.children || []
    for (let i = 0; i < children.length; i += 1) emit(children[i], control.Id, box, i)
  }
  const nodes = []
  for (let i = 0; i < session.runtime.roots.length; i += 1) {
    mark(session.runtime.roots[i], rootBox, true)
    emit(session.runtime.roots[i], null, null, i)
  }
  return { nodes, childCounts }
}

function clearPlayDirty(control) {
  const walkKids = control._playChildDirty === true || control._playDeepDirty === true
  control._playDirty = false
  control._playChildDirty = false
  control._playDeepDirty = false
  if (!walkKids) return
  const children = control.children
  for (let i = 0; i < children.length; i += 1) clearPlayDirty(children[i])
}

function collectDirtyScene(session, cache) {
  const rootBox = canvasBox({ width: session.runtime.canvasWidth, height: session.runtime.canvasHeight })
  const changed = []
  const removed = []
  let count = cache.count
  const pendingRemoved = session.runtime._playRemoved || []
  for (let i = 0; i < pendingRemoved.length; i += 1) {
    const id = pendingRemoved[i]
    if (!cache.fingerprints.has(id)) continue
    removed.push(id)
    cache.fingerprints.delete(id)
    cache.childCounts.delete(id)
    count -= 1
  }
  session.runtime._playRemoved = []

  function removeTree(control) {
    if (cache.fingerprints.has(control.Id)) {
      removed.push(control.Id)
      cache.fingerprints.delete(control.Id)
      cache.childCounts.delete(control.Id)
      count -= 1
    }
    const children = control.children
    for (let i = 0; i < children.length; i += 1) removeTree(children[i])
  }

  function rec(control, parentBox, parentId, z, parentActive, forceDeep) {
    const deep = forceDeep || control._playDeepDirty === true
    const dirty = deep || control._playDirty === true
    const walkKids = deep || control._playChildDirty === true
    if (!dirty && !walkKids) return

    const active = parentActive && control.active !== false
    if (!active || control.visible === false) {
      removeTree(control)
      return
    }

    const box = computeRect(parentBox, control)
    let paintedChildren = cache.childCounts.get(control.Id) || 0
    if (walkKids) {
      paintedChildren = 0
      const children = control.children
      for (let i = 0; i < children.length; i += 1) {
        rec(children[i], box, control.Id, i, true, deep)
        if (cache.fingerprints.has(children[i].Id)) paintedChildren += 1
      }
    }

    const include = PAINT_KINDS.has(control.kind) || paintedChildren > 0
    if (!include) {
      if (cache.fingerprints.has(control.Id)) {
        removed.push(control.Id)
        cache.fingerprints.delete(control.Id)
        cache.childCounts.delete(control.Id)
        count -= 1
      }
      return
    }

    const prevCount = cache.childCounts.get(control.Id)
    cache.childCounts.set(control.Id, paintedChildren)
    const groupChanged = (paintedChildren >= 16) !== ((prevCount || 0) >= 16)
    if (!dirty && !groupChanged && cache.fingerprints.has(control.Id)) return

    const item = sceneNode(control, parentId, parentBox === rootBox ? null : parentBox, box, z, paintedChildren)
    const fp = sceneFingerprint(item)
    if (cache.fingerprints.get(item.id) === fp) return
    if (!cache.fingerprints.has(item.id)) count += 1
    cache.fingerprints.set(item.id, fp)
    changed.push(item)
  }

  for (let i = 0; i < session.runtime.roots.length; i += 1) {
    rec(session.runtime.roots[i], rootBox, null, i, true, false)
  }
  cache.count = count
  return { changed, removed, count }
}

function sceneView(session, sceneRev) {
  const cache = session.viewCache || (session.viewCache = {
    rev: 0,
    fingerprints: new Map(),
    childCounts: new Map(),
    count: 0,
  })
  const prevRev = Number(sceneRev)
  const canPatch = Number.isFinite(prevRev) && prevRev === cache.rev && cache.fingerprints.size > 0
  if (!canPatch) {
    const { nodes, childCounts } = collectSceneNodes(session)
    cache.rev += 1
    cache.fingerprints = new Map(nodes.map((node) => [node.id, sceneFingerprint(node)]))
    cache.childCounts = childCounts
    cache.count = nodes.length
    for (const root of session.runtime.roots) clearPlayDirty(root)
    return { format: 'tree-v1', revision: cache.rev, reset: true, count: nodes.length, nodes }
  }
  const { changed, removed, count } = collectDirtyScene(session, cache)
  cache.rev += 1
  for (const root of session.runtime.roots) clearPlayDirty(root)
  return { format: 'tree-v1', revision: cache.rev, reset: false, count, changed, removed }
}

export function playSnapshot(session, { inspect = false, view = false, paint = false, sceneRev, compact = false } = {}) {
  const rt = session.runtime
  const compiled = session.compiled
  const [w, h] = [rt.canvasWidth, rt.canvasHeight]
  if (session.server) session.server.setClock(rt.clock.time)
  const clientLogs = compact ? rt.logs.slice(-100) : rt.logs
  const history = historyRows(session)
  const serverSnapshot = session.server ? session.server.snapshot() : { vars: {}, inbound: [], outbound: [], logs: [] }
  if (compact) {
    serverSnapshot.inbound = serverSnapshot.inbound.slice(-100)
    serverSnapshot.outbound = serverSnapshot.outbound.slice(-100)
    serverSnapshot.logs = serverSnapshot.logs.slice(-100)
  }
  const payload = {
    canvasId: compiled.canvasId,
    platform: compiled.platform,
    device: rt.device,
    canvasWidth: w,
    canvasHeight: h,
    canvasPresets: CANVAS_PRESET_LIST,
    playerCount: session.playerCount || 1,
    viewPlayerIndex: session.viewPlayerIndex || 1,
    players: Array.from({ length: session.playerCount || 1 }, (_, i) => ({
      index: i + 1,
      label: `玩家${i + 1}`,
      entityType: `Player${i + 1}`,
    })),
    time: rt.clock.time,
    frame: rt.clock.frame,
    paused: !!session.debugPaused,
    levelTimePaused: !!rt.clock.paused,
    mountError: session.mountError || rt.mountErrors[0] || null,
    logs: clientLogs.map((l) => ({ source: 'client', level: l.level, text: l.text, time: l.time })),
    tree: [],
    paint: [],
    scene: null,
    server: serverSnapshot,
    history: (compact ? history.slice(-100) : history).map((row) => ({
      t: row.t,
      source: row.source || 'user',
      kind: row.kind,
      payload: row.payload || {},
    })),
  }
  if (inspect || paint) {
    const boxes = runtimeLayout(session)
    if (inspect) payload.tree = rt.roots.map((r) => controlSnapshot(r, boxes))
    if (paint) payload.paint = paintList(session, boxes)
  }
  if (view) payload.scene = sceneView(session, sceneRev)
  // payload 全部由本次调用新建（无共享可变对象），只做无损校验，不再 parse/stringify 克隆。
  assertLosslessJson(payload)
  return payload
}

export function stepPlay(session, dt = 1 / 30) {
  const runtimes = session.runtimes || (session.runtime ? [session.runtime] : [])
  for (const rt of runtimes) rt.step(dt)
  if (session.server) {
    session.server.setClock(session.runtime.clock.time)
    session.server.flush()
  }
}

export function injectPlayKey(session, typeName) {
  remember(session, { kind: 'key', payload: { typeName: String(typeName) } })
  session.runtime.injectKey(typeName)
}

export function findPlayControl(session, name) {
  let hit = null
  for (const root of session.runtime.roots) {
    walk(root, (c) => {
      if (!hit && c.name === name) hit = c
    })
  }
  return hit
}

export function injectPlayClick(session, name) {
  remember(session, { kind: 'click', payload: { name: String(name) } })
  const c = findPlayControl(session, name)
  if (c && acceptsPlayPointer(c) && (c.kind === 'button' || c.kind === 'cursor')) {
    c.SimulateCursorClick()
  }
}

function findButtonStateChild(button, authoringId) {
  if (!button || !authoringId) return null
  return button.children.find((child) => child.authoringId === authoringId || child.Id === authoringId) || null
}

const BUTTON_STATE_KEYS = {
  unavailable: 'unavailableChildId',
  hover: 'hoverChildId',
  pressed: 'pressedChildId',
  selected: 'selectedChildId',
}

function buttonStateChildren(_session, control) {
  const out = []
  for (const [state, key] of Object.entries(BUTTON_STATE_KEYS)) {
    const child = control[key] ? findButtonStateChild(control, control[key]) : null
    if (child) out.push({ state, child })
  }
  return out
}

function prepareButtonStates(session) {
  for (const root of session.runtime.roots) {
    walk(root, (control) => {
      if (control.kind !== 'button') return
      for (const { child } of buttonStateChildren(session, control)) {
        if (!session.stateRestores.has(child.Id)) {
          session.stateRestores.set(child.Id, { child, active: child.active, visible: child.visible })
        }
        child.active = true
        child.visible = false
        if (typeof child.markPlayDirty === 'function') child.markPlayDirty(true)
      }
      refreshButtonState(session, control)
    })
  }
}

function refreshButtonState(session, control) {
  if (!control || control.kind !== 'button') return
  let state = null
  if (control.interactable === false) state = 'unavailable'
  else if (control.pressed === true) state = 'pressed'
  else if (session.hoveredControl === control) state = 'hover'
  else if (session.selectedControl === control) state = 'selected'
  for (const item of buttonStateChildren(session, control)) {
    item.child.active = true
    item.child.visible = item.state === state
    if (typeof item.child.markPlayDirty === 'function') item.child.markPlayDirty(true)
  }
}

function normalizeButtonHit(control) {
  if (!control) return null
  const parent = control.parent
  if (parent?.kind === 'button') {
    const ids = Object.values(BUTTON_STATE_KEYS).map((key) => parent[key]).filter(Boolean)
    if (ids.includes(control.authoringId)) return parent
  }
  return control
}

function acceptsPlayPointer(control) {
  if (control.kind === 'button') return control.raycastTarget !== false && control.interactable !== false
  if (control.kind === 'cursor' || control.kind === 'grid') return control.raycastTarget !== false
  if (control.kind === 'textwindow') return control.interactable !== false
  // 容器/装饰图/文本默认穿透，与真机一致；只有显式开启射线才接收。
  return control.raycastTarget === true
}

function pointerRecursesInto(control) {
  // Device: a CursorEventArea nested under an image never receives
  // events. Only layout hosts forward the pointer to children.
  return control.kind === 'container' || control.kind === 'grid' || control.kind === 'textwindow' || control.kind === 'reference' || control.kind === 'button'
}

function subtreeCanHit(control, memo) {
  const id = control.Id
  const cached = memo.get(id)
  if (cached !== undefined) return cached
  let can = acceptsPlayPointer(control)
  if (!can && pointerRecursesInto(control)) {
    const children = control.children
    for (let i = 0; i < children.length; i += 1) {
      if (subtreeCanHit(children[i], memo)) {
        can = true
        break
      }
    }
  }
  memo.set(id, can)
  return can
}

export function hitPlayControl(session, x, y) {
  const rootBox = canvasBox({ width: session.runtime.canvasWidth, height: session.runtime.canvasHeight })
  const memo = new Map()
  function rec(control, parentBox, parentMatrix, parentActive) {
    if (!parentActive || control.active === false || control.visible === false) return null
    if (!subtreeCanHit(control, memo)) return null
    const box = computeRect(parentBox, control)
    const matrix = composeRectMatrix(parentMatrix, box, control)
    const inverse = invertMatrix(matrix)
    if (!inverse) return null
    const local = applyMatrix(inverse, x, y)
    if (local.x < box.left || local.x > box.right || local.y < box.bottom || local.y > box.top) return null
    if (pointerRecursesInto(control)) {
      for (let i = 0; i < control.children.length; i += 1) {
        const child = rec(control.children[i], box, matrix, true)
        if (child) return child
      }
    }
    return acceptsPlayPointer(control) ? control : null
  }
  const identity = identityMatrix()
  // Later roots paint over earlier ones; hit testing must match that cover order.
  for (let i = session.runtime.roots.length - 1; i >= 0; i -= 1) {
    const hit = rec(session.runtime.roots[i], rootBox, identity, true)
    if (hit) return hit
  }
  return null
}

function pointerData(session, x, y, { dragging = false, press = null, previous = null } = {}) {
  const pressPos = press || { x, y }
  const prevPos = previous || { x, y }
  return session.runtime.makeCursorEventData({
    x,
    y,
    pressX: pressPos.x,
    pressY: pressPos.y,
    deltaX: x - prevPos.x,
    deltaY: y - prevPos.y,
    dragging,
  })
}

function setPressed(session, control, pressed) {
  control.pressed = pressed
  if (typeof control.markPlayDirty === 'function') control.markPlayDirty()
  refreshButtonState(session, control)
}

export function injectPlayPointer(session, type, x, y, options = {}) {
  const px = Number(x)
  const py = Number(y)
  if (!Number.isFinite(px) || !Number.isFinite(py)) throw new Error('pointer coordinates must be finite')
  session.runtime.cursor.x = px
  session.runtime.cursor.y = py
  if (!options.silent) remember(session, { kind: 'pointer', payload: { type, x: px, y: py } })
  if (type === 'move') {
    const previousPos = session.pointerLastPosition || { x: px, y: py }
    const previousHit = session.pointerHoverControl
    const hit = normalizeButtonHit(hitPlayControl(session, px, py))
    const hoverData = pointerData(session, px, py, { previous: previousPos })
    if (previousHit && previousHit !== hit) session.runtime.injectCursor(previousHit, 'CursorExit', hoverData)
    if (hit && previousHit !== hit) session.runtime.injectCursor(hit, 'CursorEnter', hoverData)
    session.pointerHoverControl = hit
    const previousButton = session.hoveredControl
    session.hoveredControl = hit?.kind === 'button' ? hit : null
    if (previousButton && previousButton !== session.hoveredControl) refreshButtonState(session, previousButton)
    if (session.hoveredControl) refreshButtonState(session, session.hoveredControl)
    const down = session.pointerDownControl
    if (down) {
      const press = session.pointerDownPosition || previousPos
      const moved = px !== previousPos.x || py !== previousPos.y
      if (!session.pointerDragging && moved) {
        session.runtime.injectCursor(down, 'CursorBeginDrag', pointerData(session, px, py, {
          press,
          previous: previousPos,
          dragging: false,
        }))
        session.pointerDragging = true
      }
      if (session.pointerDragging) {
        session.runtime.injectCursor(down, 'CursorDrag', pointerData(session, px, py, {
          press,
          previous: previousPos,
          dragging: true,
        }))
      }
    }
    session.pointerLastPosition = { x: px, y: py }
    return hit
  }
  if (type === 'down') {
    const hit = normalizeButtonHit(hitPlayControl(session, px, py))
    session.pointerDownControl = hit
    session.pointerDownPosition = { x: px, y: py }
    session.pointerLastPosition = { x: px, y: py }
    session.pointerDragging = false
    if (hit) {
      setPressed(session, hit, true)
      session.runtime.injectCursor(hit, 'CursorDown', pointerData(session, px, py))
    }
    return hit
  }
  if (type === 'up') {
    const down = session.pointerDownControl
    const hit = normalizeButtonHit(hitPlayControl(session, px, py))
    if (down) {
      const data = pointerData(session, px, py, {
        press: session.pointerDownPosition,
        previous: session.pointerLastPosition,
        dragging: session.pointerDragging,
      })
      session.runtime.injectCursor(down, 'CursorUp', data)
      if (session.pointerDragging) {
        session.runtime.injectCursor(down, 'CursorEndDrag', data)
      } else if (hit === down) {
        session.runtime.injectCursor(down, 'CursorClick', data)
        const previous = session.selectedControl
        session.selectedControl = down.kind === 'button' ? down : null
        if (previous && previous !== session.selectedControl) refreshButtonState(session, previous)
      }
      setPressed(session, down, false)
    }
    session.pointerDownControl = null
    session.pointerDownPosition = null
    session.pointerLastPosition = { x: px, y: py }
    session.pointerDragging = false
    return hit
  }
  if (type === 'click') {
    injectPlayPointer(session, 'down', px, py, { silent: true })
    return injectPlayPointer(session, 'up', px, py, { silent: true })
  }
  throw new Error(`unknown pointer type ${type}`)
}

export function setPlayVar(session, entityType, name, value) {
  if (!session?.server) throw new Error('play session has no server')
  remember(session, { kind: 'serverSet', payload: { entityType, name, value, playerIndex: session.viewPlayerIndex } })
  return session.server.setVar(entityType, name, value, { playerIndex: session.viewPlayerIndex })
}

export function getPlayVar(session, entityType, name) {
  if (!session?.server) throw new Error('play session has no server')
  const value = session.server.getVar(entityType, name, { playerIndex: session.viewPlayerIndex })
  return value === undefined ? null : value
}

export function sendPlaySignal(session, name, params = [], target = 'PlayerSelf') {
  if (!session?.server) throw new Error('play session has no server')
  remember(session, { kind: 'serverSend', payload: { name, params, target, playerIndex: session.viewPlayerIndex } })
  return session.server.sendToClient(name, params, { target, playerIndex: session.viewPlayerIndex })
}

export function playAdapter(session) {
  return {
    snapshot: (options) => playSnapshot(session, options),
    step: (dt) => stepPlay(session, dt),
    pointer: (type, x, y) => injectPlayPointer(session, type, x, y),
    key: (typeName) => injectPlayKey(session, typeName),
    click: (name) => injectPlayClick(session, name),
    view: (playerIndex) => setPlayView(session, playerIndex),
    pause: () => {
      remember(session, { kind: 'pause', payload: {} })
      session.debugPaused = true
    },
    resume: () => {
      remember(session, { kind: 'resume', payload: {} })
      session.debugPaused = false
    },
    serverSet: (entityType, name, value) => setPlayVar(session, entityType, name, value),
    serverSend: (signalName, params, target) => sendPlaySignal(session, signalName, params, target),
  }
}

export function stopPlay(session) {
  if (session?.server) session.server.destroy()
  const runtimes = session?.runtimes || (session?.runtime ? [session.runtime] : [])
  for (const rt of runtimes) rt.destroy()
}
