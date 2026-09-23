import { PixiPlayRenderer, createPlaySession } from './play-renderer.js'

const byId = (id) => document.getElementById(id)

const elements = {
  archive: byId('archive-select'),
  reload: byId('reload-button'),
  theme: byId('theme-button'),
  connection: byId('connection'),
  tree: byId('tree'),
  treeTitle: byId('tree-title'),
  treeCount: byId('tree-count'),
  modeEditor: byId('mode-editor'),
  modePlay: byId('mode-play'),
  asset: byId('asset-select'),
  device: byId('device-select'),
  playControls: byId('play-controls'),
  playStart: byId('play-start'),
  playPause: byId('play-pause'),
  playResume: byId('play-resume'),
  playStep: byId('play-step'),
  playStop: byId('play-stop'),
  assetLabel: byId('asset-label'),
  saveName: byId('save-name'),
  canvasLabel: byId('canvas-label'),
  revisionLabel: byId('revision-label'),
  stageShell: byId('stage-shell'),
  stageImage: byId('stage-image'),
  stageCanvas: byId('stage-canvas'),
  stageEmpty: byId('stage-empty'),
  stageLoading: byId('stage-loading'),
  activePath: byId('active-path'),
  playReadout: byId('play-readout'),
  nodeName: byId('node-name'),
  nodeDetails: byId('node-details'),
  metricControls: byId('metric-controls'),
  metricScripts: byId('metric-scripts'),
  metricCanvas: byId('metric-canvas'),
  runtimeLogs: byId('runtime-logs'),
  clearLogs: byId('clear-logs'),
  toast: byId('toast'),
}

const kindIcons = {
  'server-container': '▣',
  container: '◇',
  textbox: 'T',
  image: '◫',
  button: '▰',
  cursor: '⌖',
  grid: '▦',
  reference: '↗',
  textwindow: '▤',
  keyhint: '⌨',
  animation: '✦',
  fullscreen: '◩',
}

let model = null
let mode = 'editor'
let selectedId = ''
let busy = false
let toastTimer = null
let editorImageRefreshing = false
let editorImageRefreshPending = false

const playRenderer = new PixiPlayRenderer(elements.stageCanvas)

function applyTheme(theme) {
  const next = theme === 'light' ? 'light' : 'dark'
  document.documentElement.dataset.theme = next
  document.querySelector('meta[name="theme-color"]').content = next === 'light' ? '#f5f6f8' : '#20242e'
  elements.theme.title = next === 'dark' ? '切换到亮色主题' : '切换到暗色主题'
  localStorage.setItem('qxqy-simulator-theme', next)
}

const savedTheme = localStorage.getItem('qxqy-simulator-theme')
applyTheme(savedTheme || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'))

function notify(message, isError = false) {
  clearTimeout(toastTimer)
  elements.toast.textContent = message
  elements.toast.className = `toast visible${isError ? ' error' : ''}`
  toastTimer = setTimeout(() => { elements.toast.className = 'toast' }, 2600)
}

async function requestJson(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
  })
  const body = await response.json()
  if (!response.ok || !body.ok) throw new Error(body.error || `HTTP ${response.status}`)
  return body.value
}

function setConnection(status, text) {
  elements.connection.className = `connection ${status}`
  elements.connection.lastChild.textContent = text
}

function option(value, label) {
  const item = document.createElement('option')
  item.value = value
  item.textContent = label
  return item
}

function renderArchives() {
  const previous = elements.archive.value
  elements.archive.replaceChildren()
  const archives = model?.archives || []
  if (!archives.length) {
    const empty = option('', '未发现 qxqy-simulator-save')
    empty.disabled = true
    elements.archive.append(empty)
    return
  }
  for (const archive of archives) {
    elements.archive.append(option(archive.path, `${archive.name} · ${archive.path}`))
  }
  elements.archive.value = model.activePath || previous || archives[0].path
}

function renderDevices() {
  const presets = model?.snapshot?.canvas?.presets || []
  const previous = elements.device.value
  elements.device.replaceChildren(...presets.map((preset) => option(preset.id, preset.label)))
  const active = mode === 'play' && model?.play?.canvasId
    ? model.play.canvasId
    : model?.snapshot?.canvas?.id
  elements.device.value = active || previous || presets[0]?.id || ''
}

function renderTree() {
  const rows = model?.snapshot?.tree || []
  elements.tree.replaceChildren()
  elements.treeCount.textContent = String(rows.length)
  elements.treeTitle.textContent = model?.snapshot?.asset?.type === 'client-control-template' ? '模板与子控件' : '控件树'
  if (!rows.length) {
    const empty = document.createElement('div')
    empty.className = 'tree-empty'
    empty.textContent = model?.activePath ? '当前资产没有控件。' : '打开存档后显示控件结构。'
    elements.tree.append(empty)
    return
  }
  if (!rows.some((row) => row.id === selectedId)) selectedId = model.snapshot.selectedId || rows[0].id
  for (const row of rows) {
    const button = document.createElement('button')
    button.className = `tree-row${row.id === selectedId ? ' active' : ''}`
    button.style.paddingLeft = `${8 + row.depth * 15}px`
    button.setAttribute('role', 'treeitem')
    button.addEventListener('click', () => {
      selectedId = row.id
      renderTree()
      renderNodeDetails()
    })
    const icon = document.createElement('span')
    icon.className = 'tree-icon'
    icon.textContent = kindIcons[row.kind] || '·'
    const name = document.createElement('span')
    name.className = 'tree-name'
    name.textContent = row.name
    const kind = document.createElement('span')
    kind.className = 'tree-kind'
    kind.textContent = row.childCount ? String(row.childCount) : ''
    button.append(icon, name, kind)
    elements.tree.append(button)
  }
}

function addDetail(label, value) {
  const term = document.createElement('dt')
  term.textContent = label
  const data = document.createElement('dd')
  data.textContent = value == null || value === '' ? '—' : String(value)
  elements.nodeDetails.append(term, data)
}

function renderNodeDetails() {
  const row = model?.snapshot?.tree?.find((item) => item.id === selectedId)
  elements.nodeDetails.replaceChildren()
  elements.nodeName.textContent = row?.name || '未选择'
  if (!row) return
  addDetail('类型', row.label || row.kind)
  addDetail('ID', row.id)
  addDetail('GUID', row.guid)
  addDetail('树深度', row.depth)
  addDetail('父节点', row.parentId)
  addDetail('子控件', row.childCount)
}

function formatLogs(logs) {
  if (!Array.isArray(logs) || !logs.length) return '试玩启动后显示 Lua 日志。'
  return logs.map((entry) => {
    if (typeof entry === 'string') return entry
    const time = entry.time == null ? '' : `[${Number(entry.time).toFixed(3)}] `
    return `${time}${entry.message || entry.text || JSON.stringify(entry)}`
  }).join('\n')
}

function renderStage() {
  const snapshot = model?.snapshot
  const hasArchive = Boolean(model?.activePath)
  const showEditor = hasArchive && mode === 'editor'
  const showPlay = hasArchive && mode === 'play' && Boolean(model?.play?.running)
  elements.stageImage.hidden = !showEditor
  elements.stageCanvas.hidden = !showPlay
  elements.stageEmpty.hidden = showEditor || showPlay
  elements.stageShell.classList.toggle('playing', mode === 'play' && Boolean(model?.play?.running))
  if (!hasArchive) {
    elements.stageEmpty.querySelector('strong').textContent = '等待工作区存档'
    elements.stageEmpty.querySelector('p').textContent = 'Codex 保存 qxqy-simulator-save JSON 后会自动出现在这里。'
  } else if (mode === 'play' && !model.play.running) {
    elements.stageEmpty.querySelector('strong').textContent = '试玩尚未启动'
    elements.stageEmpty.querySelector('p').textContent = '选择设备并点击“启动”，即可运行 Lua 和交互逻辑。'
  }
  if (showEditor) refreshEditorImage()
  elements.assetLabel.textContent = snapshot?.asset?.label || '等待存档'
  elements.saveName.textContent = snapshot?.save?.name || '未命名存档'
  elements.canvasLabel.textContent = snapshot?.canvas ? `${snapshot.canvas.label} · ${snapshot.canvas.width}×${snapshot.canvas.height}` : '—'
  elements.revisionLabel.textContent = `Revision ${snapshot?.version ?? '—'}`
  elements.activePath.textContent = model?.activePath || '尚未打开存档'
  elements.playReadout.textContent = mode === 'play'
    ? model?.play?.running
      ? `Frame ${model.play.frame} · ${model.play.time.toFixed(3)}s${model.play.paused ? ' · 已暂停' : ''}`
      : '等待启动 Runtime'
    : '编辑器静态预览 · 磁盘自动刷新'
}

function refreshEditorImage() {
  if (!model?.activePath) return
  if (editorImageRefreshing) {
    editorImageRefreshPending = true
    return
  }
  editorImageRefreshing = true
  editorImageRefreshPending = false
  elements.stageLoading.hidden = false
  const next = `/api/editor.png?v=${Date.now()}`
  const image = new Image()
  const finish = () => {
    editorImageRefreshing = false
    if (editorImageRefreshPending) {
      editorImageRefreshPending = false
      refreshEditorImage()
    }
  }
  image.onload = () => {
    elements.stageImage.src = next
    elements.stageLoading.hidden = true
    finish()
  }
  image.onerror = () => {
    elements.stageLoading.hidden = true
    notify('编辑器画面加载失败。', true)
    finish()
  }
  image.src = next
}

function applyPlayStatus(next) {
  if (!next || typeof next !== 'object' || !model) return
  const stopped = next.running === false
  const previous = model.play || {}
  model.play = {
    running: !stopped,
    paused: stopped ? false : Boolean(next.paused),
    canvasId: String(next.canvasId || previous.canvasId || ''),
    width: Number(next.canvasWidth || previous.width || 0),
    height: Number(next.canvasHeight || previous.height || 0),
    frame: Number(next.frame || 0),
    time: Number(next.time || 0),
    logs: Array.isArray(next.logs) ? next.logs.slice(-100) : previous.logs,
  }
}

function updatePlayChrome() {
  const playState = model?.play
  elements.playReadout.textContent = mode === 'play'
    ? playState?.running
      ? `Frame ${playState.frame} · ${Number(playState.time || 0).toFixed(3)}s${playState.paused ? ' · 已暂停' : ''}`
      : '等待启动 Runtime'
    : '编辑器静态预览 · 磁盘自动刷新'
  if (mode === 'play') elements.runtimeLogs.textContent = formatLogs(playState?.logs)
  renderControls()
}

function syncPlayPolling() {
  if (mode === 'play' && play.running) play.startPolling()
  else play.stopPolling()
}

async function onPlaySnapshot(next) {
  applyPlayStatus(next)
  updatePlayChrome()
}

function renderControls() {
  const running = Boolean(model?.play?.running)
  const hasArchive = Boolean(model?.activePath)
  elements.modeEditor.classList.toggle('active', mode === 'editor')
  elements.modePlay.classList.toggle('active', mode === 'play')
  elements.playControls.classList.toggle('visible', mode === 'play')
  elements.playStart.disabled = busy || !hasArchive || running
  elements.playPause.disabled = busy || !running
  elements.playResume.disabled = busy || !running
  elements.playStep.disabled = busy || !running
  elements.playStop.disabled = busy || !running
  elements.asset.disabled = busy || mode === 'play'
  elements.device.disabled = busy || !hasArchive
  elements.archive.disabled = busy || !(model?.archives?.length)
  elements.reload.disabled = busy
}

function render() {
  renderArchives()
  renderDevices()
  renderTree()
  renderNodeDetails()
  const snapshot = model?.snapshot
  elements.asset.value = snapshot?.asset?.type || 'server-control-template'
  elements.metricControls.textContent = String(snapshot?.tree?.length || 0)
  elements.metricScripts.textContent = String(snapshot?.scriptCount || 0)
  elements.metricCanvas.textContent = snapshot?.canvas ? `${snapshot.canvas.width}×${snapshot.canvas.height}` : '—'
  elements.runtimeLogs.textContent = formatLogs(model?.play?.logs)
  renderControls()
  renderStage()
  syncPlayPolling()
}

async function refreshState({ quiet = false } = {}) {
  if (mode === 'play' && model?.play?.running && quiet) return
  try {
    model = await requestJson('/api/state')
    if (!quiet && model?.play?.running && !play.running) {
      mode = 'play'
      await play.attach()
    }
    setConnection('online', '实时监听中')
    render()
  } catch (error) {
    setConnection('error', '连接中断')
    if (!quiet) notify(error.message, true)
  }
}

async function run(task) {
  if (busy) return
  busy = true
  renderControls()
  try {
    await task()
  } catch (error) {
    notify(error.message, true)
  } finally {
    busy = false
    renderControls()
  }
}

const play = createPlaySession({
  renderer: playRenderer,
  api: (action, args = {}) => requestJson('/api/play', {
    method: 'POST',
    body: JSON.stringify({ action, args }),
  }),
  onSnapshot: onPlaySnapshot,
  onStatus: (next) => { applyPlayStatus(next); updatePlayChrome() },
  onError: (error) => notify(error.message, true),
  isActive: () => mode === 'play',
})
play.bindInput(elements.stageCanvas, { keysOn: elements.stageShell })

elements.archive.addEventListener('change', () => run(async () => {
  if (play.running) await play.stop().catch(() => {})
  model = await requestJson('/api/open', { method: 'POST', body: JSON.stringify({ path: elements.archive.value }) })
  mode = 'editor'
  selectedId = ''
  render()
  notify('已打开存档')
}))

elements.reload.addEventListener('click', () => run(async () => {
  if (play.running) await play.stop().catch(() => {})
  if (model?.activePath) {
    model = await requestJson('/api/open', { method: 'POST', body: JSON.stringify({ path: model.activePath }) })
    mode = 'editor'
    render()
    notify('已重新读取磁盘存档')
  } else {
    await refreshState()
  }
}))

elements.theme.addEventListener('click', () => {
  applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark')
})

elements.modeEditor.addEventListener('click', () => { mode = 'editor'; render() })
elements.modePlay.addEventListener('click', () => { mode = 'play'; render() })

elements.asset.addEventListener('change', () => run(async () => {
  model = await requestJson('/api/view', {
    method: 'POST',
    body: JSON.stringify({ assetType: elements.asset.value }),
  })
  selectedId = ''
  render()
}))

elements.device.addEventListener('change', () => run(async () => {
  if (mode === 'play' && play.running) {
    await play.device({ canvasId: elements.device.value })
    renderStage()
  } else {
    model = await requestJson('/api/view', {
      method: 'POST',
      body: JSON.stringify({ canvasId: elements.device.value }),
    })
    render()
  }
}))

elements.playStart.addEventListener('click', () => run(async () => {
  mode = 'play'
  await play.start({ canvasId: elements.device.value })
  renderStage()
  updatePlayChrome()
  elements.stageShell.focus()
}))
elements.playPause.addEventListener('click', () => void play.act('pause'))
elements.playResume.addEventListener('click', () => void play.act('resume'))
elements.playStep.addEventListener('click', () => void play.act('step', { dt: 1 / 30 }))
elements.playStop.addEventListener('click', () => run(async () => {
  await play.stop()
  applyPlayStatus({ running: false, logs: [] })
  renderStage()
  updatePlayChrome()
}))

elements.clearLogs.addEventListener('click', () => { elements.runtimeLogs.textContent = '日志已在当前视图清空。' })

const events = new EventSource('/api/events')
events.addEventListener('open', () => setConnection('online', '实时监听中'))
events.addEventListener('error', () => setConnection('error', '正在重连'))
events.addEventListener('state', (event) => {
  let change = {}
  try { change = JSON.parse(event.data) } catch {}
  if (change.reason === 'external-change') {
    mode = 'editor'
    play.reset()
    notify('检测到 Codex/MCP 保存，预览已更新')
  }
  // 试玩画面有独立的轻量状态轮询；忽略 play 事件，避免重复刷新。
  if (change.type !== 'play') void refreshState({ quiet: true })
})

setInterval(() => { void refreshState({ quiet: true }) }, 5000)
addEventListener('pagehide', () => play.destroy())
void refreshState()
