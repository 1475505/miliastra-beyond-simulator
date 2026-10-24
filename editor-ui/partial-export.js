import { t } from '../studio/i18n.js'

export const PARTIAL_EXPORT_CSS = `
.qxsim-modal.qxsim-export-dialog{width:min(1080px,94vw);max-width:94vw;padding:0;overflow:hidden}
.qxsim-export-dialog[open]{display:flex;flex-direction:column;max-height:90vh}
.qxsim-export-dialog header{padding:18px 20px;border-bottom:1px solid var(--line);flex-shrink:0}
.qxsim-export-dialog h2{margin:0 0 6px}.qxsim-export-dialog p{margin:4px 0;color:var(--muted)}
.qxsim-export-body{display:grid;grid-template-columns:minmax(220px,36%) minmax(0,1fr);min-height:0;max-height:52vh;overflow:hidden}
.qxsim-export-list{min-height:0;overflow:auto;border-right:1px solid var(--line);padding:8px}
.qxsim-export-row{display:flex;align-items:center;gap:8px;min-height:42px;padding:5px 8px;border:1px solid transparent;border-radius:5px}
.qxsim-export-row.active{background:var(--hover);border-color:var(--blue)}.qxsim-export-row input{flex:0 0 auto;accent-color:var(--blue)}
.qxsim-export-row button{min-width:0;flex:1;border:0;background:transparent;text-align:left;padding:0}
.qxsim-export-row strong,.qxsim-export-row small{display:block;overflow-wrap:anywhere}.qxsim-export-row small{color:var(--muted);font-size:10px}
.qxsim-export-preview{display:flex;flex-direction:column;min-width:0;min-height:0;padding:12px;overflow:hidden;background:var(--workspace)}
.qxsim-export-canvas{display:flex;align-items:center;justify-content:center;flex:1;height:min(32vh,360px);min-height:40px;width:100%;margin-top:8px}
.qxsim-export-preview .qxsim-stage{max-width:100%;flex-shrink:0}
.qxsim-export-dialog footer{flex-shrink:0;margin:0;padding:12px 20px;display:flex;align-items:center;flex-wrap:wrap;gap:8px;border-top:1px solid var(--line)}
.qxsim-export-dialog .spacer{flex:1}.qxsim-export-options{display:flex;flex-shrink:0;flex-wrap:wrap;gap:12px;padding:10px 20px}
.qxsim-export-error{color:var(--danger);padding:8px 20px;overflow-wrap:anywhere}
.qxsim-export-warnings{padding:0 20px;font-size:11px;max-height:76px;overflow:auto;flex-shrink:0}.qxsim-export-warnings p{margin:4px 0}
.qxsim-export-single{margin-top:8px;width:100%}
@media(max-width:680px){.qxsim-export-body{grid-template-columns:1fr;overflow:auto}.qxsim-export-list{max-height:22vh;border-right:0}.qxsim-export-preview{min-height:180px}}
`

export function createPartialExportDialog(React) {
  const e = React.createElement
  return function PartialExportDialog({ sessionId, api, initialId, onExport, onClose, renderPreview }) {
    const ref = React.useRef(null)
    const [listing, setListing] = React.useState(null)
    const [selected, setSelected] = React.useState([])
    const [focused, setFocused] = React.useState('')
    const [preview, setPreview] = React.useState(null)
    const [includeScripts, setIncludeScripts] = React.useState(true)
    const [busy, setBusy] = React.useState(false)
    const [error, setError] = React.useState('')
    const lifetime = React.useRef({ busy, onClose })
    lifetime.current = { busy, onClose }
    React.useEffect(() => {
      let active = true
      const dialog = ref.current
      const previous = document.activeElement
      const cancel = event => { event.preventDefault(); if (!lifetime.current.busy) lifetime.current.onClose() }
      const keydown = event => { if (event.key === 'Escape') { event.stopPropagation(); cancel(event) } }
      dialog.addEventListener('cancel', cancel)
      dialog.addEventListener('keydown', keydown)
      dialog.showModal()
      api(sessionId, 'export-list').then(value => {
        if (!active) return
        setListing(value)
        const id = value.rows.some(row => row.id === initialId) ? initialId : value.rows[0]?.id || ''
        setFocused(id)
        setSelected(initialId && id === initialId ? [id] : [])
      }, reason => { if (active) setError(reason.message) })
      return () => {
        active = false
        dialog.removeEventListener('cancel', cancel)
        dialog.removeEventListener('keydown', keydown)
        dialog.close()
        if (previous?.isConnected) previous.focus()
      }
    }, [sessionId, api, initialId])
    React.useEffect(() => {
      let active = true
      setPreview(null)
      if (!listing || !focused) return
      const timer = setTimeout(() => {
        api(sessionId, 'export-preview', { controlIds: [focused], includeScripts, expectedRevision: listing.revision })
          .then(value => { if (active) { setPreview(value); setError('') } }, reason => { if (active) setError(reason.message) })
      }, 100)
      return () => { active = false; clearTimeout(timer) }
    }, [listing, focused, includeScripts, sessionId, api])
    const rows = listing?.rows || []
    const checked = new Set(selected)
    const effective = rows.filter(row => checked.has(row.id) && !row.ancestorIds.some(id => checked.has(id)))
    function toggle(row, enabled) {
      setFocused(row.id)
      setSelected(previous => enabled
        ? [...previous.filter(id => id !== row.id && !rows.find(candidate => candidate.id === id)?.ancestorIds.includes(row.id)), row.id]
        : previous.filter(id => id !== row.id))
    }
    async function submit() {
      setBusy(true); setError('')
      try {
        await onExport({ controlIds: effective.map(row => row.id), includeScripts, expectedRevision: listing.revision })
        onClose()
      } catch (reason) { setError(reason.message) }
      finally { setBusy(false) }
    }
    return e('dialog', { ref, className: 'qxsim-modal qxsim-export-dialog', 'aria-label': t('部分组合导出') },
      e('header', null, e('h2', null, t('部分组合导出')), e('p', null, t('勾选客户端控件及其子树，组合为一个 GIA 文件。父子同时选中时只导出一次。'))),
      e('div', { className: 'qxsim-export-body' },
        e('div', { className: 'qxsim-export-list', 'aria-label': t('可导出的客户端控件') }, rows.length ? rows.map(row => {
          const covered = row.ancestorIds.some(id => checked.has(id))
          return e('div', { key: row.id, className: `qxsim-export-row${focused === row.id ? ' active' : ''}`, style: { paddingLeft: 8 + row.depth * 14 } },
            e('input', { type: 'checkbox', checked: covered || checked.has(row.id), disabled: busy || covered,
              'aria-label': t('导出 {0}', row.name), onChange: event => toggle(row, event.target.checked) }),
            e('button', { type: 'button', onClick: () => setFocused(row.id), 'aria-label': t('预览 {0}', row.name) },
              e('strong', null, row.name), e('small', null, `#${row.guid} · `, t('{0} 个控件', row.controlCount))))
        }) : e('p', null, listing ? t('没有可导出的客户端控件') : t('正在加载…'))),
        e('section', { className: 'qxsim-export-preview', 'aria-label': t('导出预览') },
          e('strong', null, rows.find(row => row.id === focused)?.name || t('请选择一个控件')),
          e('p', null, t('预览当前项独立导出后的布局，不改变原项目。')),
          preview ? renderPreview(preview.snapshot) : e('p', null, t('正在加载…')))),
      e('div', { className: 'qxsim-export-options' }, e('label', null,
        e('input', { type: 'checkbox', checked: includeScripts, disabled: busy, onChange: event => setIncludeScripts(event.target.checked) }), ' ', t('包含挂载脚本及未挂载模块'))),
      preview?.warnings?.length ? e('div', { className: 'qxsim-export-warnings' }, preview.warnings.map(line => e('p', { key: line }, t(line)))) : null,
      error ? e('div', { role: 'alert', className: 'qxsim-export-error' }, t(error)) : null,
      e('footer', null,
        e('button', { className: 'qxsim-action', disabled: busy || !rows.length, onClick: () => setSelected(rows.filter(row => !row.parentId).map(row => row.id)) }, t('全选')),
        e('button', { className: 'qxsim-action', disabled: busy || !selected.length, onClick: () => setSelected([]) }, t('清除')),
        e('span', null, t('已选 {0} 项', effective.length)), e('span', { className: 'spacer' }),
        e('button', { className: 'qxsim-action', disabled: busy, onClick: onClose }, t('取消')),
        e('button', { className: 'qxsim-action primary', disabled: busy || !effective.length, onClick: () => void submit() }, busy ? t('正在导出…') : t('导出 GIA'))))
  }
}
