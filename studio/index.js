import { existsSync, readFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { applyPatch, createProject, snapshotProject } from './ui/project.js'
import { createDefaultClientTemplateProject, createDefaultProject, findNode, walk } from './ui/authoring.js'
import {
  startPlay,
  stepPlay,
  playSnapshot,
  injectPlayKey,
  injectPlayClick,
  injectPlayPointer,
  stopPlay,
  setPlayVar,
  getPlayVar,
  sendPlaySignal,
  setPlayView,
  playAdapter,
} from './play/session.js'
import { caseFromHistory, normalizeCase } from './autotest/format.js'
import { replayCase } from './autotest/runner.js'
import { compileProject } from './play/compile.js'
import { toJson, assertNoUndefined } from './json.js'
import { filterLogs } from './log/collect.js'
import { CANVAS_PRESETS } from './constants.js'
import { MAX_PLAYERS, PLAYER_SLOTS, normalizePlayerCount, normalizePlayerIndex, normalizeServerLogic } from 'qxqy-server'
import { exportGia, exportCombinedGia, importGia, inspectGia, validateGiaCompatibility, validateServerGiaCompatibility, exportScriptGia, importScriptGia, isScriptGia } from './gia/codec.js'
import { collectUsedGuids, isValidGuid, nextFreeGuid } from './gia/guid.js'

// 脚本与测试从 qxqy-studio 包入口直接消费这些 GIA 工具导出。
export { exportGia, exportCombinedGia, importGia, inspectGia, validateGiaCompatibility, validateServerGiaCompatibility, exportScriptGia, importScriptGia, isScriptGia }

const ENTITY_LABELS = {
  Level: '关卡',
  PlayerSelf: '当前玩家',
  AvatarSelf: '当前角色',
  ...Object.fromEntries(PLAYER_SLOTS.map((name, i) => [name, `玩家${i + 1}`])),
  ...Object.fromEntries(Array.from({ length: MAX_PLAYERS }, (_, i) => [`Avatar${i + 1}`, `角色${i + 1}`])),
}

function listServerVars(server, playerCount = 1) {
  const bags = server?.vars || {}
  const out = []
  const count = Number(playerCount) > 0 ? Number(playerCount) : 1
  const types = ['Level', 'PlayerSelf', 'AvatarSelf']
  if (count > 1) {
    for (let i = 1; i <= count; i += 1) types.push(`Player${i}`, `Avatar${i}`)
  }
  const seen = new Set()
  for (const entityType of types) {
    if (seen.has(entityType) || !bags[entityType]) continue
    seen.add(entityType)
    const bag = bags[entityType] || {}
    for (const name of Object.keys(bag)) {
      out.push(toJson({
        entityType,
        entityLabel: ENTITY_LABELS[entityType] || entityType,
        name,
        type: bag[name]?.type || '',
        value: bag[name]?.value ?? null,
      }))
    }
  }
  return out
}

const SAVE_FORMAT = 'qxqy-simulator-save'
const SCRIPT_BUNDLE_FORMAT = 'qxqy-simulator-scripts'
const SERVER_ASSET = 'server-control-template'
const CLIENT_ASSET = 'client-control-template'
const ASSET_LABELS = {
  [SERVER_ASSET]: '服务器控件模板',
  [CLIENT_ASSET]: '客户端控件模板',
}

function assetKey(assetType) {
  return assetType === CLIENT_ASSET ? 'client' : 'server'
}

function normalizeScriptGuid(raw) {
  const candidates = [raw?.guid, raw?.id]
  for (const value of candidates) {
    const guid = Number(value)
    if (Number.isSafeInteger(guid) && guid > 0 && guid <= 0x7fffffff) return guid
  }
  return 0
}

function normalizeScriptEntry(raw) {
  const rawAsset = String(raw?.controlAsset || '')
  const guid = normalizeScriptGuid(raw)
  return {
    id: guid ? String(guid) : String(raw?.id || ''),
    guid,
    path: String(raw?.path || ''),
    source: String(raw?.source || ''),
    controlId: String(raw?.controlId || ''),
    controlAsset: rawAsset === CLIENT_ASSET || rawAsset === 'client' ? CLIENT_ASSET
      : rawAsset === SERVER_ASSET || rawAsset === 'server' ? SERVER_ASSET
        : '',
  }
}

function seedScriptList(seed) {
  const list = []
  const push = (raw, controlAsset = '') => {
    if (!raw) return
    if (raw.path || raw.source) {
      const entry = normalizeScriptEntry(raw)
      list.push(controlAsset ? { ...entry, controlAsset } : entry)
    }
  }
  if (Array.isArray(seed?.assets?.scripts)) {
    for (const raw of seed.assets.scripts) {
      if (raw && (raw.path || raw.source)) list.push(normalizeScriptEntry(raw))
    }
    return list
  }
  push(seed?.assets?.server?.script, SERVER_ASSET)
  push(seed?.assets?.client?.script, CLIENT_ASSET)
  if (seed && seed.format !== SAVE_FORMAT) {
    push(seed?.script)
    for (const raw of seed?.scripts || []) push(raw)
  }
  return list
}

function defaultProject(assetType) {
  return createProject(assetType === CLIENT_ASSET
    ? createDefaultClientTemplateProject()
    : createDefaultProject())
}

const UNBOUND_WORKSPACE_NAME = '未绑定'
const DEFAULT_SAVE_NAME = '未命名存档'
const DEFAULT_PROJECT_NAME = '未命名界面'


function findWorkspaceRoot(start) {
  let dir = start
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, 'simulator', 'studio')) && existsSync(join(dir, 'lua'))) return dir
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return start
}

function describeWorkspace(path) {
  if (!path) return { name: UNBOUND_WORKSPACE_NAME, path: '', bound: false }
  return { name: basename(path), path, bound: true }
}

function resolveWorkspaceFile(relOrAbs, cwd = process.cwd()) {
  if (isAbsolute(relOrAbs) && existsSync(relOrAbs)) return relOrAbs
  const start = cwd || process.cwd()
  const root = findWorkspaceRoot(start)
  const fromRoot = resolve(root, relOrAbs)
  if (existsSync(fromRoot)) return fromRoot
  const fromCwd = resolve(start, relOrAbs)
  if (existsSync(fromCwd)) return fromCwd
  throw new Error('script file not found: ' + relOrAbs)
}

export function createStudio(seed, options = {}) {
  // 显示用的工作区必须是会话 cwd 本身，缺省保持未绑定，绝不回退到宿主 process.cwd()。
  // 仓库根只用于解析相对路径脚本，不改写顶栏身份。
  let workspacePath = typeof options.workspacePath === 'string' && options.workspacePath
    ? options.workspacePath
    : ''
  const isSave = seed?.format === SAVE_FORMAT && seed.assets
  const seededProject = isSave ? null : createProject(seed)
  const projects = {
    server: isSave && seed.assets.server ? createProject(seed.assets.server) : defaultProject(SERVER_ASSET),
    client: isSave && seed.assets.client ? createProject(seed.assets.client) : defaultProject(CLIENT_ASSET),
  }
  if (seededProject) projects[assetKey(seededProject.meta.assetType)] = seededProject
  let activeAssetType = isSave && seed.activeAssetType === CLIENT_ASSET
    ? CLIENT_ASSET
    : seededProject?.meta.assetType || SERVER_ASSET
  // 显式存档名（renameSave / 导入存档包写入）优先；否则用中性默认名，不跟目录名漂。
  let explicitSaveName = isSave && seed.meta?.name ? String(seed.meta.name) : ''
  const currentSaveName = () => explicitSaveName || DEFAULT_SAVE_NAME
  if (!seed?.meta?.name && projects.server.meta.name === '未命名界面控件组') {
    projects.server.meta.name = DEFAULT_PROJECT_NAME
  }
  let scripts = []
  const usedScriptGuids = new Set()
  function refreshUsedGuids() {
    usedScriptGuids.clear()
    collectUsedGuids(projects.server.root, usedScriptGuids)
    collectUsedGuids(projects.client.root, usedScriptGuids, { skipServerContainer: true })
    for (const script of scripts) {
      if (isValidGuid(script.guid)) usedScriptGuids.add(Number(script.guid))
    }
  }
  function allocateScriptGuid(preferred = 0) {
    refreshUsedGuids()
    const guid = isValidGuid(preferred) && !usedScriptGuids.has(Number(preferred))
      ? Number(preferred)
      : nextFreeGuid(usedScriptGuids)
    usedScriptGuids.add(guid)
    return guid
  }
  function adoptScript(raw) {
    const entry = normalizeScriptEntry(raw)
    const guid = allocateScriptGuid(entry.guid)
    return { ...entry, guid, id: String(guid) }
  }
  for (const raw of seedScriptList(seed)) scripts.push(adoptScript(raw))
  let serverLogic = normalizeServerLogic(seed?.serverLogic)
  let play = null
  // 试玩侧设备画布：显式指定后粘性生效（隐式重启沿用），playStop 后回到跟随编辑器画布。
  let playCanvasId = ''
  let playPlayerCount = 1
  let playViewPlayerIndex = 1

  function normalizePlayCanvasId(raw) {
    const key = String(raw || '').trim()
    if (!key) return ''
    if (!CANVAS_PRESETS[key]) {
      throw new Error(`unknown canvas preset: ${key} (available: ${Object.keys(CANVAS_PRESETS).join(', ')})`)
    }
    return key
  }

  const currentProject = () => projects[assetKey(activeAssetType)]

  function findControlTarget(controlId) {
    if (!controlId) return null
    for (const [key, project] of [['server', projects.server], ['client', projects.client]]) {
      const node = findNode(project.root, controlId)
      if (node && node.kind !== 'server-container') return { key, node }
    }
    return null
  }

  function resolveScriptTarget(script) {
    if (!script.controlId) return null
    const assetKey = script.controlAsset === CLIENT_ASSET ? 'client' : script.controlAsset === SERVER_ASSET ? 'server' : null
    if (assetKey) {
      const node = findNode(projects[assetKey].root, script.controlId)
      if (node && node.kind !== 'server-container') return { key: assetKey, node }
      return null
    }
    return findControlTarget(script.controlId)
  }

  function reconcileScriptMounts() {
    for (const script of scripts) {
      if (script.controlId && !resolveScriptTarget(script)) {
        script.controlId = ''
        script.controlAsset = ''
      }
    }
  }

  function scriptMountFromGenericSlot(guid) {
    if (!isValidGuid(guid)) return null
    for (const [assetType, project] of [[SERVER_ASSET, projects.server], [CLIENT_ASSET, projects.client]]) {
      let controlId = ''
      walk(project.root, (node) => {
        if (!controlId && (node.scriptMappingIds || []).includes(Number(guid))) controlId = node.id
      })
      if (controlId) return { controlId, controlAsset: assetType }
    }
    return null
  }

  function rewriteGenericScriptGuid(mount, previousGuid, nextGuid) {
    const project = projects[assetKey(mount.controlAsset)]
    const node = project && findNode(project.root, mount.controlId)
    if (!node) return
    node.scriptMappingIds = (node.scriptMappingIds || []).map((guid) => (
      Number(guid) === Number(previousGuid) ? Number(nextGuid) : guid
    ))
  }
  reconcileScriptMounts()

  function describeScripts() {
    return scripts.map((script) => {
      const target = resolveScriptTarget(script)
      const assetType = target ? (target.key === 'client' ? CLIENT_ASSET : SERVER_ASSET) : ''
      return toJson({
        id: script.id,
        guid: script.guid || 0,
        path: script.path || '',
        source: script.source || '',
        controlId: script.controlId || '',
        controlAsset: script.controlAsset || assetType,
        controlName: target?.node.name || '',
        assetType,
        assetLabel: target ? ASSET_LABELS[assetType] : '',
        mounted: Boolean(target),
      })
    })
  }

  function mountTargetRows() {
    const out = []
    const collect = (project, assetType) => {
      walk(project.root, (node) => {
        if (node.kind === 'server-container') return
        out.push(toJson({ id: node.id, name: node.name, kind: node.kind, assetType, assetLabel: ASSET_LABELS[assetType] }))
      })
    }
    collect(projects.server, SERVER_ASSET)
    collect(projects.client, CLIENT_ASSET)
    return out
  }

  function factoryFingerprint(project) {
    const rows = []
    walk(project.root, (node) => {
      if (node.kind === 'server-container') return
      rows.push(JSON.stringify({
        kind: node.kind,
        name: node.name,
        text: node.text ?? null,
        imageId: node.imageId ?? null,
        fontSize: node.fontSize ?? null,
        fontColor: node.fontColor ?? null,
        bgColor: node.bgColor ?? null,
        imageColor: node.imageColor ?? null,
        fillType: node.fillType ?? null,
        fillAmount: node.fillAmount ?? null,
        syncAllDevices: node.syncAllDevices !== false,
        transformByPlatform: node.transformByPlatform || null,
        transformByCanvas: node.transformByCanvas || null,
      }))
    })
    return rows.join('/')
  }

  const FACTORY_CLIENT_FINGERPRINT = factoryFingerprint(createDefaultClientTemplateProject())
  const FACTORY_SERVER_FINGERPRINT = factoryFingerprint(createDefaultProject())

  function isFactoryDefaultProject(project) {
    const fingerprint = factoryFingerprint(project)
    return project.meta?.assetType === CLIENT_ASSET
      ? fingerprint === FACTORY_CLIENT_FINGERPRINT
      : fingerprint === FACTORY_SERVER_FINGERPRINT
  }

  function safeFilePart(name, fallback) {
    const cleaned = String(name || '').replace(/[\\/:*?"<>|]/g, '-').trim()
    return cleaned || fallback
  }

  function assetExportStem(project) {
    const save = safeFilePart(currentSaveName(), DEFAULT_SAVE_NAME)
    const kind = project.meta?.assetType === CLIENT_ASSET ? '客户端控件模板' : '服务器控件模板'
    return `${save} · ${kind}`
  }

  function buildCombinedControlProject() {
    const hostRoot = (projects.server.root.children || []).find((node) => node.kind === 'container')
      || projects.server.root.children?.[0]
    if (!hostRoot) throw new Error('整合包需要服务端客户端控件容器下至少有一个根控件')
    return exportCombinedGia(projects.server, projects.client, {
      scripts,
      fileName: `${safeFilePart(currentSaveName(), DEFAULT_SAVE_NAME)} · 整合包.gia`,
    })
  }

  function saveDescriptor() {
    const describe = (project) => ({
      type: project.meta.assetType,
      name: project.meta.name,
      sourceFile: project.meta.sourceFile || '',
    })
    return {
      format: SAVE_FORMAT,
      name: currentSaveName(),
      activeAssetType,
      assets: {
        server: describe(projects.server),
        client: describe(projects.client),
        scripts: describeScripts(),
      },
    }
  }

  function archiveData() {
    return toJson({
      format: SAVE_FORMAT,
      version: 3,
      meta: { name: currentSaveName() },
      activeAssetType,
      serverLogic,
      assets: {
        server: projects.server,
        client: projects.client,
        scripts: scripts.map((script) => toJson({
          id: script.id,
          guid: script.guid || 0,
          path: script.path || '',
          source: script.source || '',
          controlId: script.controlId || '',
          controlAsset: script.controlAsset || '',
        })),
      },
    })
  }

  function get() {
    const project = currentProject()
    const snap = snapshotProject(project)
    snap.workspace = describeWorkspace(workspacePath)
    snap.save = saveDescriptor()
    snap.scripts = describeScripts()
    snap.mountTargets = mountTargetRows()
    snap.serverLogic = serverLogic
    assertNoUndefined(snap)
    return snap
  }

  function checkRevision(op) {
    const project = currentProject()
    if (op.expectedRevision !== undefined && Number(op.expectedRevision) !== project.version) {
      throw new Error(`revision conflict: expected ${op.expectedRevision}, current ${project.version}`)
    }
    return project
  }

  function setScriptMount(script, controlId, controlAsset = '') {
    const value = String(controlId || '')
    if (value) {
      const asset = controlAsset === CLIENT_ASSET ? CLIENT_ASSET : controlAsset === SERVER_ASSET ? SERVER_ASSET : ''
      const probe = { controlId: value, controlAsset: asset }
      if (!resolveScriptTarget(probe)) throw new Error('挂载目标必须是存档内的客户端控件或客户端控件模板')
      script.controlAsset = asset
    } else {
      script.controlAsset = ''
    }
    script.controlId = value
  }

  function applyScriptOp(op) {
    const project = checkRevision(op)
    if (op.op === 'addScript') {
      const script = adoptScript({ path: String(op.path || ''), source: String(op.source || ''), controlId: '', controlAsset: '' })
      if (op.controlId !== undefined && op.controlId !== '') setScriptMount(script, op.controlId, op.controlAsset)
      scripts.push(script)
    } else if (op.op === 'updateScript') {
      const script = scripts.find((row) => row.id === op.id)
      if (!script) throw new Error(`脚本不存在: ${op.id}`)
      if (op.controlId !== undefined) setScriptMount(script, op.controlId, op.controlAsset)
      if (op.path !== undefined) script.path = String(op.path)
      if (op.source !== undefined) script.source = String(op.source)
    } else if (op.op === 'removeScript') {
      const before = scripts.length
      scripts = scripts.filter((row) => row.id !== op.id)
      if (scripts.length === before) throw new Error(`脚本不存在: ${op.id}`)
    }
    project.version += 1
    return get()
  }

  function patch(op) {
    if (!op || typeof op !== 'object') throw new Error('patch requires op')
    if (op.op === 'setServerLogic') {
      const project = checkRevision(op)
      serverLogic = normalizeServerLogic(op.logic)
      project.version += 1
      return get()
    }
    if (op.op === 'addScript' || op.op === 'updateScript' || op.op === 'removeScript') {
      return applyScriptOp(op)
    }
    if (op.op === 'selectAsset') {
      activeAssetType = op.assetType === CLIENT_ASSET ? CLIENT_ASSET : SERVER_ASSET
      return get()
    }
    if (op.op === 'renameSave') {
      const name = String(op.name || '').trim()
      if (!name) throw new Error('存档名称不能为空')
      explicitSaveName = name
      return get()
    }
    if (op.op === 'newAsset') {
      const project = checkRevision(op)
      activeAssetType = op.assetType === CLIENT_ASSET ? CLIENT_ASSET : SERVER_ASSET
      const next = defaultProject(activeAssetType)
      next.version = project.version + 1
      projects[assetKey(activeAssetType)] = next
      reconcileScriptMounts()
      return get()
    }
    applyPatch(currentProject(), op)
    reconcileScriptMounts()
    return get()
  }

  function scriptsInProject(assetType) {
    return scripts.filter((script) => {
      const target = resolveScriptTarget(script)
      return Boolean(target && (target.key === 'client') === (assetType === CLIENT_ASSET))
    })
  }

  function exportData(format = 'json', requestedAssetType = '') {
    const normalized = String(format).toLowerCase()
    if (normalized === 'save' || normalized === 'archive') {
      const data = Buffer.from(JSON.stringify(archiveData(), null, 2), 'utf8')
      return toJson({
        filename: `${currentSaveName().replace(/[\\/:*?"<>|]/g, '-')} · 资产包.json`,
        mimeType: 'application/json',
        encoding: 'base64',
        data: data.toString('base64'),
        warnings: [],
      })
    }
    if (normalized === 'save-gia' || normalized === 'archive-gia') {
      // 官方编辑器中三类资产本就是独立 GIA 文件（UIControlGroup / UIControlTemplate 列表 / script.gia），
      // 没有单文件混合格式的证据，因此资产包 GIA 以多文件交付，不捏造合并格式。
      // 另一类 UI 若仍是出厂默认且当前没在看、也没有脚本挂上去，就不要夹带进压缩包，
      // 否则用户会以为「页面上的 Flappy Fish」导出成了「Lua实例化面板」。
      const files = []
      const warnings = []
      const collect = (format, assetType = '') => {
        const result = exportData(format, assetType)
        files.push(toJson({
          filename: result.filename,
          mimeType: result.mimeType,
          encoding: result.encoding,
          data: result.data,
          warnings: result.warnings || [],
        }))
        warnings.push(...(result.warnings || []))
      }
      const includeUi = (assetType, skipMessage) => {
        const project = projects[assetKey(assetType)]
        const visible = assetType === activeAssetType
        const mounted = scripts.some((script) => script.controlAsset === assetType && script.controlId)
        if (!visible && isFactoryDefaultProject(project) && !mounted) {
          warnings.push(skipMessage)
          return
        }
        collect('gia', assetType)
      }
      includeUi(SERVER_ASSET, '服务器控件模板仍是默认橱窗，未改动且当前未显示，已从资产包 GIA 中省略。')
      includeUi(CLIENT_ASSET, '客户端控件模板仍是默认「Lua实例化面板」，未改动且当前未显示，已从资产包 GIA 中省略。')
      if (scripts.some((script) => script.path || script.source)) collect('scripts-gia')
      if (!files.length) {
        throw new Error('资产包 GIA 没有可导出的已改动项；请先编辑当前界面，或改用「当前界面 GIA」。')
      }
      return toJson({
        format: 'qxqy-gia-package',
        files,
        warnings: [...new Set(warnings)],
      })
    }
    if (normalized === 'gia-combined' || normalized === 'combined-gia' || normalized === 'combined') {
      const result = buildCombinedControlProject()
      return toJson({
        filename: `${safeFilePart(currentSaveName(), DEFAULT_SAVE_NAME)} · 整合包.gia`,
        mimeType: 'application/octet-stream',
        encoding: 'base64',
        data: result.buffer.toString('base64'),
        warnings: [...new Set(result.warnings || [])],
      })
    }
    if (normalized === 'scripts') {
      const bundle = toJson({
        format: SCRIPT_BUNDLE_FORMAT,
        version: 1,
        scripts: scripts.map((script) => toJson({
          id: script.id,
          guid: script.guid || 0,
          path: script.path || '',
          source: script.source || '',
          controlId: script.controlId || '',
          controlAsset: script.controlAsset || '',
        })),
      })
      const data = Buffer.from(JSON.stringify(bundle, null, 2), 'utf8')
      return toJson({
        filename: `${safeFilePart(currentSaveName(), DEFAULT_SAVE_NAME)} · 脚本.json`,
        mimeType: 'application/json',
        encoding: 'base64',
        data: data.toString('base64'),
        warnings: [],
      })
    }
    if (normalized === 'scripts-gia' || normalized === 'scriptsgia') {
      const result = exportScriptGia(scripts)
      return toJson({
        filename: `${safeFilePart(currentSaveName(), DEFAULT_SAVE_NAME)} · 脚本.gia`,
        mimeType: 'application/octet-stream',
        encoding: 'base64',
        data: result.buffer.toString('base64'),
        warnings: result.warnings,
      })
    }
    if (normalized === 'lua') {
      const script = scripts.find((row) => row.id === requestedAssetType)
        || scripts.find((row) => row.path === requestedAssetType)
      if (!script) throw new Error('没有可导出的 Lua 脚本，请先在“Lua 脚本”页创建')
      const filename = basename(script.path || '') || `qxqy-script-${script.id}`
      return toJson({
        filename: /\.lua$/i.test(filename) ? filename : `${filename}.lua`,
        mimeType: 'text/x-lua',
        encoding: 'base64',
        data: Buffer.from(script.source || '', 'utf8').toString('base64'),
        warnings: [],
      })
    }
    const project = requestedAssetType
      ? projects[assetKey(requestedAssetType)]
      : currentProject()
    const baseName = assetExportStem(project)
    if (normalized === 'json') {
      const payload = toJson({ ...project, scripts: scriptsInProject(project.meta.assetType) })
      const data = Buffer.from(JSON.stringify(payload, null, 2), 'utf8')
      return toJson({
        filename: `${baseName}.json`,
        mimeType: 'application/json',
        encoding: 'base64',
        data: data.toString('base64'),
        warnings: [],
      })
    }
    if (normalized === 'gia') {
      const result = exportGia(project, project.meta.assetType === CLIENT_ASSET
        ? { scripts: scriptsInProject(CLIENT_ASSET) }
        : {})
      return toJson({
        filename: `${baseName}.gia`,
        mimeType: 'application/octet-stream',
        encoding: 'base64',
        data: result.buffer.toString('base64'),
        warnings: result.warnings,
      })
    }
    throw new Error(`unsupported export format: ${format}`)
  }

  function absorbScripts(rawList) {
    for (const raw of rawList) {
      const entry = normalizeScriptEntry(raw)
      if (!entry.path && !entry.source) continue
      const genericMount = entry.controlId ? null : scriptMountFromGenericSlot(entry.guid)
      const script = adoptScript(genericMount ? { ...entry, ...genericMount } : entry)
      if (genericMount && script.guid !== entry.guid) {
        // A separately imported UI asset can share a GUID with the inactive
        // default tree. Keep the newly allocated script GUID and repair the
        // GenericSlot reference so the restored mount remains exportable.
        rewriteGenericScriptGuid(genericMount, entry.guid, script.guid)
      }
      if (script.controlId && !resolveScriptTarget(script)) {
        script.controlId = ''
        script.controlAsset = ''
      }
      scripts.push(script)
    }
  }

  function importData(format, base64, filename = '') {
    const normalized = String(format || '').toLowerCase()
    if (typeof base64 !== 'string' || !base64) throw new Error('import data is required')
    const bytes = Buffer.from(base64, 'base64')
    let next
    let warnings = []
    let metadata = {}
    if (normalized === 'json') {
      try {
        next = JSON.parse(bytes.toString('utf8'))
      } catch {
        throw new Error('JSON 文件无效')
      }
      if (next?.project) next = next.project
      if (next?.format === SAVE_FORMAT && next?.assets) {
        projects.server = createProject(next.assets.server || createDefaultProject())
        projects.client = createProject(next.assets.client || createDefaultClientTemplateProject())
        activeAssetType = next.activeAssetType === CLIENT_ASSET ? CLIENT_ASSET : SERVER_ASSET
        explicitSaveName = String(next.meta?.name || basename(filename).replace(/\.json$/i, '') || explicitSaveName)
        serverLogic = normalizeServerLogic(next.serverLogic)
        scripts = []
        usedScriptGuids.clear()
        absorbScripts(seedScriptList(next))
        reconcileScriptMounts()
        return toJson({ snapshot: get(), warnings, metadata: { format: SAVE_FORMAT } })
      }
    } else if (normalized === 'lua') {
      scripts.push(adoptScript({
        path: basename(filename || 'imported.lua'),
        source: bytes.toString('utf8'),
        controlId: '',
      }))
      return toJson({ snapshot: get(), warnings, metadata: { assetType: 'lua-script' } })
    } else if (normalized === 'gia') {
      if (isScriptGia(bytes)) {
        const imported = importScriptGia(bytes)
        absorbScripts(imported.scripts)
        return toJson({ snapshot: get(), warnings: imported.warnings, metadata: imported.metadata })
      }
      const imported = importGia(bytes)
      next = imported.project
      warnings = imported.warnings
      metadata = imported.metadata
      if (imported.clientProject) {
        projects.client = createProject(imported.clientProject)
        warnings.push('整合包已拆回「UI控件-服务端」与「UI控件-客户端」；客户端模板边界已保留。')
      }
      const mountByGuid = new Map()
      const collectMounts = (project, controlAsset) => {
        if (!project) return
        walk(project.root, (node) => {
          for (const guid of node.scriptMappingIds || []) {
            const existing = mountByGuid.get(Number(guid))
            if (existing) {
              warnings.push(`脚本 GUID ${guid} 同时挂载到多个控件，已保留“${existing.controlAsset === SERVER_ASSET ? '服务端' : '客户端'}”目标。`)
              continue
            }
            mountByGuid.set(Number(guid), { controlId: node.id, controlAsset })
          }
        })
      }
      collectMounts(imported.project, SERVER_ASSET)
      collectMounts(imported.clientProject, CLIENT_ASSET)
      absorbScripts((imported.scripts || []).map((script) => (
        mountByGuid.has(Number(script.guid))
          ? { ...script, ...mountByGuid.get(Number(script.guid)) }
          : script
      )))
    } else {
      throw new Error(`unsupported import format: ${format}`)
    }
    const importedProject = createProject(next)
    const key = assetKey(importedProject.meta.assetType)
    projects[key] = importedProject
    activeAssetType = importedProject.meta.assetType
    const project = projects[key]
    if (filename) {
      project.meta.name = basename(filename).replace(/\.(json|gia)$/i, '') || project.meta.name
      project.meta.sourceFile = basename(filename)
      project.meta.sourceFormat = normalized
    }
    absorbScripts(next?.scripts || [])
    if (next?.script && (next.script.path || next.script.source)) {
      absorbScripts([next.script])
    }
    return toJson({ snapshot: get(), warnings, metadata })
  }

  function pick(x, y) {
    applyPatch(currentProject(), { op: 'pick', x, y })
    return get()
  }

  // 会话工作区可能在首个 HTTP/工具调用时才可知。只改显示与脚本解析根，不改存档名。
  function setWorkspace(path) {
    const next = typeof path === 'string' && path ? path : ''
    if (!next || next === workspacePath) return
    workspacePath = next
  }

  function resolveScriptSource(script) {
    let source = script.source || ''
    if (!source.trim() && script.path.trim()) {
      try {
        source = readFileSync(resolveWorkspaceFile(script.path, workspacePath), 'utf8')
      } catch (err) {
        throw new Error(`脚本 ${script.path} 读取失败: ${err?.message || err}`)
      }
    }
    return source
  }

  function playStart(options = {}) {
    const requested = normalizePlayCanvasId(options.canvasId)
    if (requested) playCanvasId = requested
    if (options.playerCount !== undefined && options.playerCount !== null && options.playerCount !== '') {
      playPlayerCount = normalizePlayerCount(options.playerCount)
      if (playViewPlayerIndex > playPlayerCount) playViewPlayerIndex = 1
    }
    if (options.viewPlayerIndex !== undefined && options.viewPlayerIndex !== null && options.viewPlayerIndex !== '') {
      playViewPlayerIndex = normalizePlayerIndex(options.viewPlayerIndex, playPlayerCount)
    }
    if (play) stopPlay(play)
    const resolvedScripts = scripts.map((script) => {
      try {
        return {
          id: script.id,
          guid: script.guid || 0,
          path: script.path || script.id,
          source: resolveScriptSource(script),
          controlId: script.controlId || '',
          controlAsset: script.controlAsset || '',
        }
      } catch (err) {
        return { id: script.id, guid: script.guid || 0, path: script.path || script.id, source: `error([==[ ${String(err.message).replace(/]=+]/g, '] =]')} ])`, controlId: script.controlId || '', controlAsset: script.controlAsset || '' }
      }
    })
    const byAsset = (assetKey) => resolvedScripts.filter((script) => {
      const probe = { controlId: script.controlId, controlAsset: script.controlAsset }
      const target = script.controlId ? resolveScriptTarget(probe) : null
      return Boolean(target && target.key === assetKey)
    })
    play = startPlay(projects.server, {
      templatesProject: projects.client,
      scripts: resolvedScripts,
      sceneScripts: byAsset('server'),
      templateScripts: byAsset('client'),
      serverConfig: { logic: serverLogic },
      canvasId: playCanvasId,
      playerCount: playPlayerCount,
      viewPlayerIndex: playViewPlayerIndex,
    })
    return playGet(options)
  }

  // 多设备试玩：切换设备 = 以该设备画布重建运行时（新生命周期，与真机换设备一致）。
  function playSetCanvas(rawCanvasId, options = {}) {
    const canvasId = normalizePlayCanvasId(rawCanvasId)
    if (!canvasId) throw new Error('playSetCanvas requires canvasId')
    return playStart({ ...options, canvasId })
  }

  function playGet(options = {}) {
    if (!play) return toJson({ running: false, tree: [], logs: [], serverLogs: [], serverVars: [] })
    const snap = playSnapshot(play, options)
    snap.running = true
    snap.logs = filterLogs(snap.logs)
    snap.serverLogs = filterLogs(snap.server?.logs || [])
    snap.serverVars = listServerVars(snap.server, snap.playerCount || 1)
    return snap
  }

  function playStep(dt, options = {}) {
    if (!play) playStart()
    stepPlay(play, dt)
    if (options.observe === false) {
      return toJson({
        running: true,
        time: play.runtime.clock.time,
        frame: play.runtime.clock.frame,
        paused: !!play.debugPaused,
        levelTimePaused: !!play.runtime.clock.paused,
        playerCount: play.playerCount || 1,
        viewPlayerIndex: play.viewPlayerIndex || 1,
      })
    }
    return playGet(options)
  }

  function playRun(frames = 0) {
    playStart()
    const n = Math.max(0, Number(frames) || 0)
    for (let i = 0; i < n; i++) stepPlay(play, 1 / 30)
    return playGet()
  }

  function playStop() {
    if (play) stopPlay(play)
    play = null
    playCanvasId = ''
    playPlayerCount = 1
    playViewPlayerIndex = 1
    return toJson({ running: false, tree: [], logs: [], serverLogs: [], serverVars: [] })
  }

  function playSetView(playerIndex, options = {}) {
    const session = requirePlay()
    playViewPlayerIndex = setPlayView(session, playerIndex)
    return options.observe === false ? null : playGet(options)
  }

  function playKey(typeName, options = {}) {
    if (!play) throw new Error('play session has not started')
    injectPlayKey(play, typeName)
    return options.observe === false ? null : playGet(options)
  }

  function playClick(name, options = {}) {
    if (!play) throw new Error('play session has not started')
    injectPlayClick(play, name)
    return options.observe === false ? null : playGet(options)
  }

  function playPointer(type, x, y, options = {}) {
    if (!play) throw new Error('play session has not started')
    injectPlayPointer(play, type, x, y)
    return options.observe === false ? null : playGet(options)
  }

  function playPause(options = {}) {
    if (!play) return options.observe === false ? null : playGet(options)
    playAdapter(play).pause()
    return options.observe === false ? null : playGet(options)
  }

  function playResume(options = {}) {
    if (!play) return options.observe === false ? null : playGet(options)
    playAdapter(play).resume()
    return options.observe === false ? null : playGet(options)
  }

  function requirePlay() {
    if (!play) throw new Error('play session has not started')
    return play
  }

  function playServerGet(entityType, name) {
    const session = requirePlay()
    if (!entityType && !name) {
      const snap = playGet()
      return toJson({ vars: snap.serverVars || [] })
    }
    return toJson({
      entityType: String(entityType || ''),
      name: String(name || ''),
      value: getPlayVar(session, entityType, name),
    })
  }

  function playServerSet(entityType, name, value) {
    const session = requirePlay()
    setPlayVar(session, entityType, name, value)
    return playGet()
  }

  function playServerSend(name, params = [], target = 'PlayerSelf') {
    const session = requirePlay()
    sendPlaySignal(session, name, params, target)
    return playGet()
  }

  function playHistory() {
    const snap = playGet()
    return toJson({
      events: snap.history || [],
      case: caseFromHistory(snap.history || [], { playerCount: snap.playerCount || 1 }),
    })
  }

  function playSaveCase(raw = {}) {
    const snap = playGet()
    const spec = normalizeCase({
      name: raw.name || '',
      dt: raw.dt,
      playerCount: raw.playerCount || snap.playerCount || 1,
      events: raw.events || snap.history || [],
      asserts: raw.asserts || [],
    })
    return toJson(spec)
  }

  function playRunCase(rawCase, options = {}) {
    const spec = normalizeCase(rawCase)
    playStart({ ...options, playerCount: options.playerCount || spec.playerCount || 1 })
    const session = requirePlay()
    session.recording = false
    try {
      return replayCase(playAdapter(session), rawCase)
    } finally {
      session.recording = true
    }
  }

  // 轻量状态：worker 时钟每 tick 轮询用，禁止构建全量快照。
  function playStatus() {
    if (!play) return { running: false, paused: false, time: 0, frame: 0, playerCount: 1, viewPlayerIndex: 1 }
    const clock = play.runtime.clock
    return {
      running: true,
      paused: !!play.debugPaused,
      levelTimePaused: !!clock.paused,
      time: clock.time,
      frame: clock.frame,
      playerCount: play.playerCount || 1,
      viewPlayerIndex: play.viewPlayerIndex || 1,
    }
  }

  const api = {
    get,
    patch,
    setWorkspace,
    exportData,
    importData,
    pick,
    playStart,
    playSetCanvas,
    playSetView,
    playGet,
    playStatus,
    playStep,
    playRun,
    playStop,
    playKey,
    playClick,
    playPointer,
    playPause,
    playResume,
    playServerGet,
    playServerSet,
    playServerSend,
    playHistory,
    playSaveCase,
    playRunCase,
    archiveData,
  }
  Object.defineProperty(api, '_project', { enumerable: false, get: currentProject })
  return api
}
