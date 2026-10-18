import { t } from '../studio/i18n.js'
export function createControlGuidSyncPanel(React) {
  const e = React.createElement
  return function ControlGuidSyncPanel({ snap, prepare, patch, copy, onScripts, onError, reloadArchive }) {
    const [busy, setBusy] = React.useState(false)
    const [plan, setPlan] = React.useState(null)
    const [result, setResult] = React.useState(null)
    const [prompt, setPrompt] = React.useState('')
    const [collapsed, setCollapsed] = React.useState(false)
    const panelRef = React.useRef(null)
    const pending = snap.controlGuidChanges || []
    const latestChangeId = pending.at(-1)?.id || ''
    React.useEffect(() => { setPlan(null); setPrompt('') }, [snap.version, snap.save?.name])
    React.useEffect(() => { setCollapsed(false) }, [latestChangeId, snap.save?.name])
    React.useLayoutEffect(() => { if (prompt && panelRef.current) panelRef.current.scrollTop = 0 }, [prompt])
    const run = fn => async () => {
      setBusy(true)
      try { await fn() } catch (error) { onError(error?.message || String(error)) }
      finally { setBusy(false) }
    }
    const handoff = run(async () => {
      setPrompt(await copy()); setPlan(null)
      if (panelRef.current) panelRef.current.scrollTop = 0
    })
    if (!pending.length && !result) return null
    if (collapsed) return e('div', { style: { flexShrink: 0, padding: '2px 10px' } },
      e('button', { className: 'qxsim-action', onClick: () => setCollapsed(false) }, t`Lua 索引待同步（${pending.length} 项）· 展开`))
    return e('section', { ref: panelRef, className: 'qxsim-note', 'aria-label': t('Lua 索引同步'), style: { flexShrink: 0, maxHeight: 270, overflow: 'auto', overflowWrap: 'anywhere' } },
      e('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 } },
        e('strong', null, pending.length ? t`下一步：同步 Lua 索引引用（${pending.length} 项）` : t('脚本全量替换已完成')),
        e('button', { className: 'qxsim-action', 'aria-label': t('关闭索引同步提示'), title: t('收起提示，保留待同步记录'), disabled: busy,
          onClick: () => { if (pending.length) setCollapsed(true); else setResult(null) } }, t('关闭'))),
      prompt ? e('details', { open: true }, e('summary', null, t('同步任务（粘贴给当前项目的 AI）')), e('textarea', { 'aria-label': t('AI 索引同步任务'), readOnly: true, value: prompt, rows: 5, style: { width: '100%', boxSizing: 'border-box' } }),
        e('button', { className: 'qxsim-action', disabled: busy, onClick: run(reloadArchive) }, t('AI 已处理，重新载入存档'))) : null,
      e('div', null, pending.length ? t('控件索引已修改，请选择一种方式同步脚本。') : t('请检查替换结果并保存存档，再到「Lua 脚本 → 实机脚本同步」更新游戏里的文件并重新试玩。')),
      pending.length ? e(React.Fragment, null,
        e('div', { role: 'group', 'aria-label': t('索引同步方式'), style: { display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 5 } },
          e('div', { style: { flex: '1 1 280px' } },
          e('button', { className: 'qxsim-action', disabled: busy, onClick: run(async () => {
            await prepare()
            const next = await patch({ op: 'previewControlGuidSync' })
            const preview = next.controlGuidSyncPreview
            setResult(null); setPrompt('')
            if (!preview.canApply) { setPlan(preview); return }
            const applied = await patch({ op: 'syncControlGuidReferences', planId: preview.id })
            setResult(applied.controlGuidSyncResult); setPlan(null)
          }) }, t('全量替换脚本索引')),
          e('div', null, e('strong', null, t('可能错误地替换非索引内容。')), t('按完整十进制数字替换所有已登记脚本，包括配置表、字符串和注释；同时更新内容一致的工作区源文件，替换前自动备份。'))),
          e('div', { style: { flex: '1 1 280px' } },
          e('button', { className: 'qxsim-action', disabled: busy, onClick: handoff }, t('复制提示词给 AI')),
          e('div', null, t('先保存最新存档，再复制包含映射读取方式和脚本位置的提示词，由 AI 判断哪些引用需要更新。')))),
        e('details', null, e('summary', null, t`查看索引变更（${pending.length} 项）`),
          e('ul', null, pending.slice(0, 20).map(row => e('li', { key: row.id }, `${row.controlName}：${row.oldGuid} → ${row.newGuid}`))),
          pending.length > 20 ? e('div', null, t('这里显示前 20 项；完整映射随存档保存，复制的任务会引导 AI 读取全部。')) : null)) : null,
      plan ? e('div', { 'aria-label': t('Lua 索引同步问题') },
        e('p', null, t('源码文件或索引映射存在冲突，本次没有修改脚本。可复制提示词给 AI 处理。')),
        plan.issues.map((issue, i) => e('div', { key: i }, issue)),
        plan.rows.filter(row => row.issues.length).map(row => e('details', { key: row.id, open: true },
          e('summary', null, row.path || t('内联脚本')),
          row.issues.slice(0, 12).map((issue, i) => e('div', { key: `i${i}` }, `${issue.line ? t`第 ${issue.line} 行：` : ''}${issue.reason}`)),
          row.issues.length > 12 ? e('div', null, t('其余问题请由 AI 核对。')) : null))) : null,
      result && !pending.length ? e(React.Fragment, null,
        e('div', null, t`已替换 ${result.scripts} 个脚本的 ${result.replacements} 处文本，更新 ${result.projectFiles} 个项目文件。备份：${result.backupRoot}`),
        e('button', { className: 'qxsim-action', onClick: onScripts }, t('前往 Lua 脚本'))) : null)
  }
}
