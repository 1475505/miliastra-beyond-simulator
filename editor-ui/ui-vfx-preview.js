import { BrowserUIVfxPlayer } from '../studio/play/ui-vfx-player.js'
import { UI_VFX_CATALOG, uiVfxAsset, uiVfxUrl } from '../studio/assets/ui-vfx-catalog.js'
import { centerMaskMatrix } from '../studio/play/image-mask.js'
import { getLocale, t } from '../studio/i18n.js'

const commandEvent = 'qxqy-ui-vfx-preview'
export function createUIVfxComponents(React) {
  const { createElement: e, useEffect, useRef, useState } = React
  function Effects({ boxes, canvasWidth, canvasHeight }) {
    const ref = useRef(null), latest = useRef(null)
    latest.current = { boxes, canvasWidth, canvasHeight }
    useEffect(() => {
      const player = new BrowserUIVfxPlayer(ref.current)
      ref.current.parentElement.style.isolation = 'isolate'
      const started = performance.now(), states = new Map()
      const command = event => {
        const state = states.get(event.detail.id)
        if (state) { state.stopped = event.detail.stop; state.startedAt = (performance.now() - started) / 1000; state.generation++ }
      }
      const scope = ref.current.closest('.qxsim') || ref.current.parentElement
      scope.addEventListener(commandEvent, command)
      const tick = () => {
        const { boxes, canvasWidth, canvasHeight } = latest.current
        const time = (performance.now() - started) / 1000, effects = [], keep = new Set()
        for (const box of boxes) {
          if (!['animation', 'fullscreen'].includes(box.kind) || box.animationId == null || String(box.animationId).trim() === '' || Number(box.animationId) === 0) continue
          keep.add(box.id)
          let state = states.get(box.id)
          if (!state || state.animationId !== box.animationId) {
            state = { animationId: box.animationId, startedAt: time, generation: (state?.generation || 0) + 1, stopped: false }
            states.set(box.id, state)
          }
          if (!state.stopped && box.visibleInHierarchy !== false && box.visible !== false) effects.push({ ...state, id: box.id, kind: box.kind,
            layer: box.layer, matrix: centerMaskMatrix(box.renderMatrix, box.centerX, box.centerY), masks: box.masks || [] })
        }
        for (const id of states.keys()) if (!keep.has(id)) states.delete(id)
        player.sync({ effects, time, canvasWidth, canvasHeight, running: true })
      }
      const timer = setInterval(tick, 50)
      tick()
      return () => { clearInterval(timer); scope.removeEventListener(commandEvent, command); player.destroy() }
    }, [])
    return e('div', { ref, style: { display: 'contents' } })
  }

  function Picker({ item, commit }) {
    const ref = useRef(null)
    const [search, setSearch] = useState('')
    const [open, setOpen] = useState(false)
    const [failure, setFailure] = useState('')
    const english = getLocale() === 'en'
    const asset = uiVfxAsset(item.animationId, item.kind)
    const matches = UI_VFX_CATALOG.filter(row => row.scope === (item.kind === 'fullscreen' ? 'screen' : 'ui')
      && `${row.id} ${row.name} ${row.nameEn}`.toLowerCase().includes(search.toLowerCase()))
    const command = stop => ref.current.dispatchEvent(new CustomEvent(commandEvent, { bubbles: true, detail: { id: item.id, stop } }))
    return e('div', { ref, className: 'qxsim-section-body', 'data-ui-vfx-picker': '' },
      e('strong', null, asset ? `${asset.id} · ${english ? asset.nameEn : asset.name}` : t('请选择动效素材')),
      e('p', { className: 'qxsim-muted' }, t('画布预览静音；加载失败只跳过当前动效。')),
      e('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
        e('button', { className: 'qxsim-action', onClick: () => setOpen(!open) }, t('选择素材')),
        e('button', { className: 'qxsim-action', onClick: () => command(false) }, t('重播 / 重试')),
        e('button', { className: 'qxsim-action', onClick: () => command(true) }, t('停止预览'))),
      failure ? e('p', { role: 'status' }, failure) : null,
      open ? e('div', null,
        e('input', { value: search, placeholder: t('搜索 ID / 名称'), 'aria-label': t('搜索动效'),
          onChange: event => setSearch(event.target.value), style: { width: '100%', margin: '8px 0' } }),
        e('div', { style: { maxHeight: 310, overflow: 'auto', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5 } },
          matches.map(row => e('button', { key: row.id, className: 'qxsim-action', title: english ? row.nameEn : row.name,
            style: { height: 'auto', minHeight: 80, whiteSpace: 'normal' },
            onClick: () => { setFailure(''); Promise.resolve().then(() => commit('animationId', String(row.id))).then(() => setOpen(false)).catch(error => setFailure(error.message)) } },
          e('img', { src: uiVfxUrl(row.icon), loading: 'lazy', alt: '', width: 48, height: 48, style: { objectFit: 'contain', display: 'block', margin: 'auto' },
            onError: event => { event.currentTarget.style.visibility = 'hidden' } }),
          e('div', null, row.id), e('small', null, english ? row.nameEn : row.name))))) : null)
  }
  return { Effects, Picker }
}
