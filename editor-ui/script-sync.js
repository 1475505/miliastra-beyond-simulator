import { t } from '../studio/i18n.js'
export function createScriptSyncPanel(React) {
  const e = React.createElement
  return function ScriptSyncPanel({ snap, request, patch, prepare, refresh }) {
    const empty = { version: 1, workspaceDir: '', clientImportRoot: '', clientSubdir: '' }
    const [config, setConfig] = React.useState(snap.scriptSync || empty)
    const [archivePath, setArchivePath] = React.useState(snap.storage?.path || 'qxqy-simulator.save.json')
    const [candidates, setCandidates] = React.useState([])
    const [plan, setPlan] = React.useState(null)
    const [selected, setSelected] = React.useState([])
    const [result, setResult] = React.useState(null)
    const [notice, setNotice] = React.useState('')
    const [error, setError] = React.useState('')
    const [busy, setBusy] = React.useState(false)
    const fieldId = React.useId()
    React.useEffect(() => { setConfig(snap.scriptSync || empty); setPlan(null) }, [JSON.stringify(snap.scriptSync), snap.storage?.path])
    React.useEffect(() => { setPlan(null) }, [snap.version, snap.asset?.type])
    React.useEffect(() => { if (snap.storage?.path) setArchivePath(snap.storage.path) }, [snap.storage?.path])
    const run = async task => { setBusy(true); setError(''); setNotice(''); try { await task() } catch (reason) { setError(reason.message || String(reason)) } finally { setBusy(false) } }
    const sync = (action, args = {}) => request('script-sync', { action, args })
    async function preview() {
      setPlan(null); setResult(null)
      const current = await prepare()
      await request('save', { path: archivePath, expectedRevision: current.version })
      await refresh()
      const next = await sync('preview')
      setPlan(next)
      setSelected(next.rows.filter(row => !row.error && row.status !== '未变化').map(row => row.id))
    }
    const configDirty = JSON.stringify(config) !== JSON.stringify(snap.scriptSync || empty)
    const field = (key, label, placeholder, help) => e('label', { className: 'qxsim-field', key },
      e('span', null, label),
      e('input', { type: 'text', value: config[key], placeholder, 'aria-label': label, 'aria-describedby': `${fieldId}-${key}`, disabled: busy, onChange: event => { setConfig({ ...config, [key]: event.target.value }); setPlan(null); setNotice('') } }),
      e('small', { id: `${fieldId}-${key}` }, help))
    const identity = config.clientImportRoot.replaceAll('\\', '/').match(/BeyondLocal\/([^/]+)\/Beyond_Local_Save_Level\/([^/]+)/)
    const relativeFolder = value => value.trim().replaceAll('\\', '/').replace(/^\.$/, '')
    const prefix = relativeFolder(config.workspaceDir) ? `${relativeFolder(config.workspaceDir)}/` : ''
    const exampleScript = snap.scripts?.find(row => row.path.replaceAll('\\', '/').startsWith(prefix) && row.path.toLowerCase().endsWith('.lua'))?.path.replaceAll('\\', '/') || `${prefix}main.lua`
    const exampleTarget = [config.clientImportRoot.trim().replaceAll('\\', '/').replace(/\/+$/, '') || t('【千星沙箱脚本文件夹】'), relativeFolder(config.clientSubdir), exampleScript.slice(prefix.length)].filter(Boolean).join('/')
    const statusLabel = { 新增: t('新增文件'), 覆盖: t('更新已有文件'), 未变化: t('内容相同，无需更新'), 错误: t('无法复制') }
    const sourceLabel = { 存档源码: t('存档里编辑的代码'), 工作区文件: t('项目中的 .lua 文件') }
    const button = (text, task, disabled = false) => e('button', { type: 'button', className: 'qxsim-action', disabled: busy || disabled, onClick: () => void run(task) }, text)
    return e('details', { className: 'qxsim-section', style: { flexShrink: 0, maxHeight: '55%', overflow: 'auto', margin: '5px 10px' } },
      e('summary', null, t`实机脚本同步 · ${snap.scriptSync ? t('已设置文件夹') : t('先设置文件夹')}`),
      e('div', { className: 'qxsim-section-body' },
        e('p', null, t('把当前存档里的 Lua 脚本复制到千星沙箱，用于游戏内测试。操作顺序：填写脚本位置 → 保存设置 → 保存存档并查看更新 → 确认复制。')),
        field('workspaceDir', t('项目脚本文件夹'), t('例如 workspace/my-game；也可以留空'), t('填写在工作区里的位置，例如 workspace/my-game；留空表示使用工作区本身。')),
        field('clientImportRoot', t('千星沙箱脚本文件夹'), t('粘贴以 default_import_file 结尾的完整路径'), t('关卡存放外部 Lua 脚本的文件夹，可点击「发现本机目录」查找。请填写运行模拟器那台电脑上的完整路径。')),
        field('clientSubdir', t('游戏里的项目子文件夹'), t('例如 workspace/my-game；也可以留空'),
          e(React.Fragment, null, t('一般和“项目脚本文件夹”填一样的内容，保留原来的文件位置。留空则直接放进千星沙箱脚本文件夹。'),
            e('span', { 'aria-label': t('复制路径示例'), style: { display: 'block', overflowWrap: 'anywhere' } }, t('复制示例：'), e('code', null, exampleScript), ' → ', e('code', null, exampleTarget)))),
        identity ? e('p', null, t`游戏账号 UID：${identity[1]} · 关卡目录编号：${identity[2]}`) : null,
        e('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
          button(t('发现本机目录'), async () => { const found = await sync('discover'); setCandidates(found.candidates); if (!found.candidates.length) setError(t('没有找到游戏脚本文件夹。可以手动粘贴 default_import_file 文件夹的完整路径；如果还没导入脚本，请先在千星沙箱完成导入。')); else setNotice(t`找到 ${found.candidates.length} 个游戏脚本文件夹，请选择要更新的账号和关卡。`) }),
          button(t('保存设置'), async () => { await prepare(); const current = await patch({ op: 'setScriptSync', config }); await request('save', { path: archivePath, expectedRevision: current.version }); await refresh(); setPlan(null); setResult(null); setNotice(t('脚本位置已保存。下一步点击「保存存档并查看更新」。')) }, !config.clientImportRoot.trim() || !archivePath.trim()),
          button(t('清除设置'), async () => { await prepare(); const current = await patch({ op: 'setScriptSync', config: null }); await request('save', { path: archivePath, expectedRevision: current.version }); await refresh(); setPlan(null); setResult(null); setNotice(t('已清除脚本位置设置。游戏里的脚本文件仍然保留。')) }, !snap.scriptSync || !archivePath.trim())),
        candidates.length ? e('label', { className: 'qxsim-field' }, t('选择要更新的账号和关卡'), e('select', { value: '', disabled: busy, onChange: event => { setConfig({ ...config, clientImportRoot: event.target.value }); setPlan(null); setNotice('') } }, e('option', { value: '' }, t('请选择游戏账号和关卡文件夹…')), candidates.map(row => e('option', { key: row.path, value: row.path }, t`账号 ${row.uid} / 关卡目录 ${row.editorId} · ${row.path}`)))) : null,
        e('label', { className: 'qxsim-field', style: { marginTop: 8 } },
          e('span', null, t('模拟器存档文件')),
          e('input', { type: 'text', value: archivePath, placeholder: t('例如 my-game.save.json'), 'aria-label': t('模拟器存档文件'), 'aria-describedby': `${fieldId}-archive`, disabled: busy, onChange: event => { setArchivePath(event.target.value); setPlan(null); setNotice('') } }),
          e('small', { id: `${fieldId}-archive` }, t('填写工作区里的存档文件名或路径。保存设置时会一起保存项目，下次打开存档即可复用。'))),
        button(t('保存存档并查看更新'), preview, !snap.scriptSync || configDirty || !archivePath.trim()),
        !snap.scriptSync ? e('p', null, t('请先填写千星沙箱脚本文件夹，并点击「保存设置」。')) : configDirty ? e('p', null, t('脚本位置已改动，请先点击「保存设置」。')) : !archivePath.trim() ? e('p', null, t('请先填写模拟器存档文件名。')) : null,
        busy ? e('p', { role: 'status' }, t('正在处理，请稍候…')) : notice ? e('p', { role: 'status' }, notice) : null,
        error ? e('p', { role: 'alert', style: { color: 'var(--danger)' } }, t(error)) : null,
        plan ? e('section', { 'aria-label': t('脚本同步确认') },
          e('p', { style: { overflowWrap: 'anywhere' } }, t`本次更新到：${plan.root}`),
          !plan.rows.length ? e('p', null, t('这个存档还没有 Lua 脚本。请先在下方添加脚本，再查看更新。')) : plan.rows.every(row => row.status === '未变化') ? e('p', { role: 'status' }, t('所有脚本都与游戏文件夹里的内容相同，无需复制。')) : null,
          plan.pendingGuidChanges ? e('p', { role: 'alert' }, t('有控件索引尚未同步到 Lua。请先在上方「全量替换脚本索引」，或「复制提示词给 AI」；处理完成后再查看游戏脚本更新。')) : null,
          plan.rows.map(row => e('div', { key: row.id, style: { borderTop: '1px solid var(--line)', padding: 6 } },
            e('label', { style: { overflowWrap: 'anywhere' } }, e('input', { type: 'checkbox', disabled: busy || Boolean(row.error) || row.status === '未变化', checked: selected.includes(row.id), onChange: event => setSelected(event.target.checked ? [...selected, row.id] : selected.filter(id => id !== row.id)) }), ` ${row.path} · ${statusLabel[row.status] || row.status}`),
            e('div', null, t`复制的代码来自：${sourceLabel[row.sourceKind] || row.sourceKind}`),
            e('div', { style: { overflowWrap: 'anywhere' } }, row.error ? t`无法复制：${row.error}` : t`复制到：${row.target}`),
            row.sourceMismatch ? e('div', { className: 'qxsim-note' }, t('这个脚本在存档里和项目文件里的代码不同。本次会复制存档里的代码；如果要使用项目文件，请点击「改用项目文件里的代码」，然后重新查看更新。'),
              e('details', null, e('summary', null, t('查看项目文件里的代码')), e('pre', { style: { maxHeight: 200, overflow: 'auto' } }, row.diskSource)),
              button(t('改用项目文件里的代码'), async () => { await prepare(); await patch({ op: 'updateScript', id: row.id, source: row.diskSource }); setPlan(null) })) : null,
            !row.error && row.status !== '未变化' ? e('details', null, e('summary', null, t('对比更新前后的代码')),
              e('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 } },
                e('div', { style: { minWidth: 0 } }, t('游戏里现在的代码'), e('pre', { style: { maxHeight: 240, overflow: 'auto' } }, row.status === '新增' ? t('（游戏里还没有这个文件）') : row.beforeSource)),
                e('div', { style: { minWidth: 0 } }, t('本次要复制的代码'), e('pre', { style: { maxHeight: 240, overflow: 'auto' } }, row.source)))) : null)),
          plan.rows.some(row => row.status === '新增') ? e('p', null, t('新增脚本复制后，还需要在千星沙箱里关联对应的脚本文件；需要直接运行的脚本还要挂到控件上。')) : null,
          selected.length ? e('p', null, t`已选 ${selected.length} 个脚本，其中 ${plan.rows.filter(row => selected.includes(row.id) && row.status === '覆盖').length} 个会替换游戏里的旧文件。替换前会自动备份旧文件，游戏里的其他文件会保留。`) : null,
          e('div', { style: { display: 'flex', gap: 6 } }, button(t('暂不复制'), async () => setPlan(null)),
            button(t`确认复制 ${selected.length} 个脚本`, async () => {
              const pending = plan
              setPlan(null)
              await prepare()
              setResult(await request('script-sync-apply', { planId: pending.id, scriptIds: selected, confirmed: true }))
            }, !selected.length || Boolean(plan.pendingGuidChanges)))) : null,
        result ? e('div', { role: 'status' }, e('strong', null, result.completed ? t('脚本已复制到千星沙箱') : t('有些脚本未复制成功')),
          e('p', null, result.completed ? t('下一步：回到千星沙箱，保存关卡并重新试玩，让游戏加载更新后的脚本。') : t('请按下方提示处理失败的文件，再重新查看更新并复制。')),
          e('p', { style: { overflowWrap: 'anywhere' } }, t`复制时间：${new Date(result.at).toLocaleString()} · 旧文件备份保存在：${result.backupRoot}`),
          e('ul', { style: { overflowWrap: 'anywhere' } }, result.results.map(row => e('li', { key: row.id }, `${row.target}：${row.status === '成功' ? t('已复制') : t('未复制')}${row.error ? ` · ${row.error}` : ''}`)))) : null))
  }
}
