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
    const [error, setError] = React.useState('')
    const [busy, setBusy] = React.useState(false)
    React.useEffect(() => { setConfig(snap.scriptSync || empty); setPlan(null) }, [JSON.stringify(snap.scriptSync), snap.storage?.path])
    React.useEffect(() => { setPlan(null) }, [snap.version, snap.asset?.type])
    React.useEffect(() => { if (snap.storage?.path) setArchivePath(snap.storage.path) }, [snap.storage?.path])
    const run = async task => { setBusy(true); setError(''); try { await task() } catch (reason) { setError(reason.message || String(reason)) } finally { setBusy(false) } }
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
    const field = (key, label) => e('label', { className: 'qxsim-field', key }, e('span', null, label), e('input', { type: 'text', value: config[key], disabled: busy, onChange: event => { setConfig({ ...config, [key]: event.target.value }); setPlan(null) } }))
    const identity = config.clientImportRoot.replaceAll('\\', '/').match(/BeyondLocal\/([^/]+)\/Beyond_Local_Save_Level\/([^/]+)/)
    const button = (text, task, disabled = false) => e('button', { type: 'button', className: 'qxsim-action', disabled: busy || disabled, onClick: () => void run(task) }, text)
    return e('details', { className: 'qxsim-section', style: { flexShrink: 0, maxHeight: '55%', overflow: 'auto', margin: '5px 10px' } },
      e('summary', null, `实机脚本同步 · ${snap.scriptSync ? '已配置（手动复制）' : '未配置'}`),
      e('div', { className: 'qxsim-section-body' },
        e('p', null, '目录位于模拟器宿主机器。保存存档后检查差异，确认才复制；之后请在千星沙箱保存并试玩。新增脚本仍需建立映射。'),
        field('workspaceDir', '工作区脚本目录（相对路径；留空表示工作区根目录）'),
        field('clientImportRoot', '实机导入根目录（default_import_file 的完整路径）'),
        field('clientSubdir', '实机对应子目录（通常与工作区脚本目录相同，保留 GIA 路径）'),
        identity ? e('p', null, `UID：${identity[1]} · 编辑器 ID：${identity[2]}`) : null,
        e('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
          button('发现本机目录', async () => { const found = await sync('discover'); setCandidates(found.candidates); if (!found.candidates.length) setError('未发现目录，可粘贴完整路径。') }),
          button('保存目录配置', async () => { await prepare(); const current = await patch({ op: 'setScriptSync', config }); await request('save', { path: archivePath, expectedRevision: current.version }); await refresh(); setPlan(null) }, !config.clientImportRoot || !archivePath.trim()),
          button('清除配置', async () => { await prepare(); const current = await patch({ op: 'setScriptSync', config: null }); await request('save', { path: archivePath, expectedRevision: current.version }); await refresh(); setPlan(null) }, !snap.scriptSync || !archivePath.trim())),
        candidates.length ? e('label', { className: 'qxsim-field' }, '发现的目录', e('select', { value: '', disabled: busy, onChange: event => { setConfig({ ...config, clientImportRoot: event.target.value }); setPlan(null) } }, e('option', { value: '' }, '选择 UID / 编辑器…'), candidates.map(row => e('option', { key: row.path, value: row.path }, `${row.uid} / ${row.editorId} · ${row.path}`)))) : null,
        e('label', { className: 'qxsim-field', style: { marginTop: 8 } }, e('span', null, '完整存档保存路径'), e('input', { type: 'text', value: archivePath, disabled: busy, onChange: event => { setArchivePath(event.target.value); setPlan(null) } })),
        button('保存存档并检查差异', preview, !snap.scriptSync || configDirty || !archivePath.trim()),
        configDirty ? e('p', null, '目录配置已修改，请先保存目录配置。') : null,
        error ? e('p', { role: 'alert', style: { color: 'var(--danger)' } }, error) : null,
        plan ? e('section', { 'aria-label': '脚本同步确认' },
          e('p', null, `目标目录：${plan.root}`),
          plan.pendingGuidChanges ? e('p', { role: 'alert' }, '尚有控件索引引用待核对，请处理并确认记录后再同步。') : null,
          plan.rows.map(row => e('div', { key: row.id, style: { borderTop: '1px solid var(--line)', padding: 6 } },
            e('label', null, e('input', { type: 'checkbox', disabled: busy || Boolean(row.error) || row.status === '未变化', checked: selected.includes(row.id), onChange: event => setSelected(event.target.checked ? [...selected, row.id] : selected.filter(id => id !== row.id)) }), ` ${row.path} · ${row.sourceKind} · ${row.status}`),
            e('div', { style: { overflowWrap: 'anywhere' } }, row.error || `→ ${row.target}`),
            row.sourceMismatch ? e('div', { className: 'qxsim-note' }, '存档源码与工作区文件不同；当前使用存档源码。',
              e('details', null, e('summary', null, '查看工作区文件'), e('pre', { style: { maxHeight: 200, overflow: 'auto' } }, row.diskSource)),
              button('从工作区文件更新存档源码', async () => { await prepare(); await patch({ op: 'updateScript', id: row.id, source: row.diskSource }); setPlan(null) })) : null,
            !row.error && row.status !== '未变化' ? e('details', null, e('summary', null, '查看复制前后内容'),
              e('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 } },
                e('div', null, '实机当前内容', e('pre', { style: { maxHeight: 240, overflow: 'auto' } }, row.beforeSource)),
                e('div', null, '将写入的内容', e('pre', { style: { maxHeight: 240, overflow: 'auto' } }, row.source)))) : null)),
          e('p', null, `确认复制 ${selected.length} 个脚本，其中覆盖 ${plan.rows.filter(row => selected.includes(row.id) && row.status === '覆盖').length} 个。覆盖前备份，不删除实机额外文件。`),
          e('div', { style: { display: 'flex', gap: 6 } }, button('取消', async () => setPlan(null)),
            button(`确认复制 ${selected.length} 个脚本`, async () => {
              const pending = plan
              setPlan(null)
              await prepare()
              setResult(await request('script-sync-apply', { planId: pending.id, scriptIds: selected, confirmed: true }))
            }, !selected.length || Boolean(plan.pendingGuidChanges)))) : null,
        result ? e('div', { role: 'status' }, e('strong', null, result.completed ? '同步完成' : '部分文件同步失败'),
          e('p', null, `${result.at} · 备份位置：${result.backupRoot}`),
          e('ul', null, result.results.map(row => e('li', { key: row.id }, `${row.target}：${row.status}${row.error ? ` · ${row.error}` : ''}`)))) : null))
  }
}
