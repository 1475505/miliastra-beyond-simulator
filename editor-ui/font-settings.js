import { t } from '../studio/i18n.js'
const endpoint = '/qxqy-font/settings'

async function request(config) {
  const response = await fetch(endpoint, { credentials: 'same-origin', mode: 'same-origin', cache: 'no-store',
    signal: AbortSignal.timeout(10_000),
    ...(config ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(config) } : {}) })
  if (response.status === 404) throw new Error('当前后台尚未加载字体设置功能，请重启 Web 或 Harness 宿主后重试。')
  if (!response.ok) throw new Error(await response.text() || t('无法读取字体设置'))
  return response.json()
}

export function createFontSettings(React) {
  const e = React.createElement
  return function FontSettings({ onClose }) {
    const [settings, setSettings] = React.useState(null)
    const [mode, setMode] = React.useState('auto')
    const [path, setPath] = React.useState('')
    const [scope, setScope] = React.useState('all')
    const [busy, setBusy] = React.useState(false)
    const [error, setError] = React.useState('')
    const [notice, setNotice] = React.useState('')
    const [attempt, setAttempt] = React.useState(0)
    React.useEffect(() => {
      let active = true
      setError('')
      request().then(value => {
        if (!active) return
        setSettings(value); setMode(value.mode)
        setScope(value.scope || 'all')
        setPath(value.environmentPath || value.path || value.active.path || value.defaultPaths[0] || '')
      }, reason => { if (active) setError(reason.message) })
      return () => { active = false }
    }, [attempt])
    async function save(event) {
      event.preventDefault(); setBusy(true); setError(''); setNotice('')
      try {
        const value = await request(locked ? { scope } : { mode, path, scope })
        setSettings(value)
        const detected = !locked && mode === 'auto' ? (value.nextFont.path ? t`找到字体：${value.nextFont.path}。` : t('默认位置未找到字体，将使用系统字体。')) : ''
        setNotice(t`已保存。${detected}重启 Web、MCP 或 Harness 宿主后，刷新编辑器及试玩页生效。`)
      } catch (reason) { setError(reason.message) }
      finally { setBusy(false) }
    }
    const locked = Boolean(settings?.environmentPath)
    return e('div', { className: 'qxsim-save-overlay', onKeyDown: event => {
      if (event.key === 'Escape') { event.stopPropagation(); if (!busy) onClose() }
    } }, e('form', { className: 'qxsim-save-dialog qxsim-font-dialog', role: 'dialog', 'aria-modal': true,
      'aria-label': t('字体设置'), onSubmit: save, style: { width: 'min(680px, 94%)', maxHeight: '90%', overflow: 'auto' } },
    e('h2', null, t('字体设置')),
    e('p', null, t('自定义字体可用于游戏内文本或整体 UI。设置仅保存在本机，重启宿主后生效。')),
    settings ? e(React.Fragment, null,
      e('p', { style: { overflowWrap: 'anywhere' } }, t`当前字体：${settings.active.path || t('系统字体')}`),
      locked ? e('p', { role: 'status' }, t('字体文件由环境变量 QXQY_FONT_PATH 指定，仍可调整应用范围。')) : null,
      settings.error ? e('p', { role: 'alert' }, t(settings.error)) : null,
      e('label', { className: 'qxsim-field' }, t('字体来源'), e('select', { autoFocus: true, 'aria-label': t('字体来源'), value: mode,
        disabled: busy || locked, onChange: event => { setMode(event.target.value); setNotice('') } },
      e('option', { value: 'auto' }, t('自动尝试原神的默认安装位置')),
      e('option', { value: 'custom' }, t('指定本机字体文件')), e('option', { value: 'system' }, t('使用系统字体')))),
      mode === 'custom' || locked ? e('label', { className: 'qxsim-field' }, t('字体文件路径'),
        e('input', { type: 'text', 'aria-label': t('字体文件路径'), value: path, required: mode === 'custom', disabled: busy || locked,
          spellCheck: false, placeholder: settings.defaultPaths[0] || '/path/to/font.ttf',
          onChange: event => { setPath(event.target.value); setNotice('') } }),
        e('small', null, t('填写 TTF / OTF 的绝对路径，最大 32 MiB；可以直接粘贴带引号的 Windows 路径。'))) : null,
      mode === 'auto' && !locked ? e('div', null,
        e('p', null, t('按顺序尝试以下位置；都未找到时使用系统字体。安装在其他盘符时请选择“指定本机字体文件”。')),
        settings.defaultPaths.length ? e('ul', { style: { paddingLeft: 20, overflowWrap: 'anywhere' } },
          settings.defaultPaths.map(value => e('li', { key: value }, value))) : e('p', null, t('当前系统不自动查找，请指定字体文件。'))) : null,
      e('label', { className: 'qxsim-field' }, t('应用范围'),
        e('select', { 'aria-label': t('应用范围'), value: scope, disabled: busy,
          onChange: event => { setScope(event.target.value); setNotice('') } },
          e('option', { value: 'game' }, t('仅游戏内文本')), e('option', { value: 'all' }, t('整体 UI'))),
        e('small', null, t('仅游戏内文本：用于画布、试玩和截图；整体 UI：同时替换工具栏、面板、代码和日志字体。'))),
      settings.restartRequired && !notice ? e('p', { role: 'status' }, t('有已保存的字体设置，重启宿主并刷新页面后生效。')) : null,
    ) : !error ? e('p', null, t('正在读取设置…')) : null,
    error ? e('p', { role: 'alert' }, t(error)) : null,
    error && !settings ? e('button', { type: 'button', className: 'qxsim-action', onClick: () => setAttempt(value => value + 1) }, t('重试')) : null,
    notice ? e('p', { role: 'status', style: { overflowWrap: 'anywhere' } }, notice) : null,
    e('footer', null, e('button', { type: 'button', className: 'qxsim-action', disabled: busy, onClick: onClose }, t('关闭')),
      e('button', { type: 'submit', className: 'qxsim-action primary', disabled: busy || !settings }, busy ? t('保存中…') : t('保存设置')))))
  }
}
