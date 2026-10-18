import { t } from '../studio/i18n.js'
const rgbHex = value => `#${(Number(value) & 0xffffff).toString(16).padStart(6, '0').toUpperCase()}`
const alphaPercent = alpha => String(Math.round(alpha / 255 * 100))

export function createColorField(React) {
  const e = React.createElement
  return function ColorField({ field, commit }) {
    const rgb = rgbHex(field.value)
    const alpha = Number(field.value) >>> 24
    const percent = alphaPercent(alpha)
    const [rgbDraft, setRgbDraft] = React.useState(rgb)
    const [alphaDraft, setAlphaDraft] = React.useState(percent)
    const alphaDirty = React.useRef(false)
    const [rgbError, setRgbError] = React.useState('')
    const [alphaError, setAlphaError] = React.useState('')
    React.useEffect(() => { setRgbDraft(rgb); setRgbError('') }, [rgb])
    React.useEffect(() => { if (!alphaDirty.current) { setAlphaDraft(percent); setAlphaError('') } }, [percent])

    function submitRgb(input) {
      const hex = input.trim().replace(/^#/, '')
      if (!/^[0-9a-f]{6}$/i.test(hex)) { setRgbError(t('请输入六位颜色，例如 #FF8800')); return }
      const normalized = `#${hex.toUpperCase()}`
      setRgbDraft(normalized); setRgbError('')
      // Merge with the latest queued snapshot so editing RGB never restores an older alpha.
      commit(field.key, current => ((Number(current) & 0xff000000) | parseInt(hex, 16)) >>> 0)
    }
    function submitAlpha(input) {
      const value = Number(input)
      if (!String(input).trim() || !Number.isInteger(value) || value < 0 || value > 100) {
        setAlphaError(t('透明度请输入 0–100 的整数')); return
      }
      const nextAlpha = Math.round(value / 100 * 255)
      alphaDirty.current = false
      setAlphaDraft(alphaPercent(nextAlpha)); setAlphaError('')
      commit(field.key, current => ((nextAlpha << 24) | (Number(current) & 0xffffff)) >>> 0)
    }
    const alphaTitle = t('Alpha：0% 完全透明，100% 完全不透明')
    const sliderValue = alphaDraft.trim() && Number.isFinite(Number(alphaDraft)) ? Math.max(0, Math.min(100, Number(alphaDraft))) : Number(percent)
    return e('div', { className: 'qxsim-color-editor', role: 'group', 'aria-label': t`${t(field.label)}与透明度` },
      e('div', { className: 'qxsim-field' },
        e('span', { className: 'qxsim-field-label' }, t(field.label)),
        e('span', { className: 'qxsim-color-row' },
          e('span', { className: 'qxsim-color-swatch', title: t('打开取色器') },
            e('input', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(rgbDraft) ? rgbDraft : rgb, disabled: !!field.readonly, 'aria-label': t`${t(field.label)}取色器`, onInput: event => submitRgb(event.target.value) })),
          e('input', {
            type: 'text', value: rgbDraft, spellCheck: false, disabled: !!field.readonly, placeholder: '#RRGGBB',
            'aria-label': `${t(field.label)} RGB`, 'aria-invalid': !!rgbError,
            onChange: event => { setRgbDraft(event.target.value); setRgbError('') },
            onBlur: () => submitRgb(rgbDraft),
            onKeyDown: event => { if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') { setRgbDraft(rgb); setRgbError('') } },
          })),
        rgbError ? e('small', { className: 'qxsim-color-error', role: 'alert' }, rgbError) : null),
      e('div', { className: 'qxsim-field' },
        e('span', { className: 'qxsim-field-label', title: alphaTitle }, t('透明度')),
        e('span', { className: 'qxsim-alpha-row' },
          e('input', { type: 'range', min: 0, max: 100, step: 1, value: sliderValue, disabled: !!field.readonly, title: alphaTitle, 'aria-label': t`${t(field.label)}透明度滑块`, onInput: event => submitAlpha(event.target.value) }),
          e('span', { className: 'qxsim-alpha-value' },
            e('input', {
              type: 'number', min: 0, max: 100, step: 1, inputMode: 'numeric', value: alphaDraft, disabled: !!field.readonly, title: alphaTitle,
              'aria-label': t`${t(field.label)}透明度`, 'aria-invalid': !!alphaError,
              onChange: event => { alphaDirty.current = true; setAlphaDraft(event.target.value); setAlphaError('') },
              // A rounded display is not an edit: keep imported 8-bit alpha on focus/blur.
              onBlur: () => { if (alphaDirty.current) submitAlpha(alphaDraft) },
              onKeyDown: event => { if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') { alphaDirty.current = false; setAlphaDraft(percent); setAlphaError('') } },
            }), e('span', { 'aria-hidden': true }, '%'))),
        alphaError ? e('small', { className: 'qxsim-color-error', role: 'alert' }, alphaError) : null))
  }
}
