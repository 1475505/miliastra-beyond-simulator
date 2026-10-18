import { t } from '../studio/i18n.js'
import { loadBrowserImageAsset, loadBrowserImageMetadata, subscribeImageRefresh } from '../studio/assets/browser.js'
import { tintedImage } from '../studio/assets/raster.js'
import { rasterizeSlices, resolveImageType, supportsImageStretch } from '../studio/assets/image-stretch.js'
import { imageFillRect } from '../studio/play/image-fill.js'
import { imageAssetKey, imageSourceName } from '../studio/assets/catalog.js'

function canvas(width, height) {
  const node = document.createElement('canvas')
  node.width = width; node.height = height
  return node
}

export function createImagePreview(React) {
  const e = React.createElement
  return function ImagePreview({ item }) {
    const key = imageAssetKey(item.imageId, item.imageSource)
    const ref = React.useRef(null)
    const [state, setState] = React.useState({ image: null, meta: null, error: '' })
    const [revision, setRevision] = React.useState(0)
    React.useEffect(() => subscribeImageRefresh(changedKey => { if (changedKey === key) setRevision(v => v + 1) }), [key])
    React.useEffect(() => {
      let active = true
      setState({ image: null, error: '' })
      loadBrowserImageAsset(item.imageId, item.imageSource).then(({ image, meta, error }) => { if (active) setState({ image, meta, error }) }, error => {
        if (active) setState({ image: null, error: error.message })
      })
      return () => { active = false }
    }, [key, revision])
    React.useEffect(() => {
      const el = ref.current
      if (!state.image || !el) return
      const raster = resolveImageType(state.meta, item.imageType) === 'Stretch'
        ? rasterizeSlices(state.image, state.meta, item.width, item.height, canvas) : state.image
      const image = tintedImage(raster, item.imageColor, canvas)
      el.width = image.width; el.height = image.height
      const ctx = el.getContext('2d')
      const fill = item.enableFill ? imageFillRect(item, el.width, el.height) : null
      if (fill) { ctx.beginPath(); ctx.rect(fill.x + el.width / 2, fill.y + el.height / 2, fill.width, fill.height); ctx.clip() }
      ctx.globalAlpha = ((Number(item.imageColor ?? 0xffffffff) >>> 24) & 255) / 255
      ctx.drawImage(image, 0, 0)
    }, [state.image, state.meta, item.imageType, item.width, item.height, item.imageColor, item.enableFill, item.fillType, item.fillHorizontalType, item.fillVerticalType, item.fillAmount])
    if (!state.image) return e('span', { className: 'qxsim-box-label', title: state.error, role: state.error ? 'status' : undefined }, state.error ? t`图片 ${item.imageId} 加载失败` : t`加载图片 ${item.imageId}…`)
    return e('canvas', { ref, title: state.error, 'data-image-id': item.imageId, 'data-image-source': imageSourceName(item.imageSource), 'data-image-type': resolveImageType(state.meta, item.imageType), 'aria-label': t`图片 ${item.imageId}`, style: { display: 'block', position: 'absolute', inset: 0, width: '100%', height: '100%' } })
  }
}

export function createImageTypeField(React) {
  const e = React.createElement
  return function ImageTypeField({ imageId, imageSource, value, commit }) {
    const key = imageAssetKey(imageId, imageSource)
    const [state, setState] = React.useState({ key: '', meta: undefined, error: '' })
    const [revision, setRevision] = React.useState(0)
    React.useEffect(() => subscribeImageRefresh(changed => { if (changed === key) setRevision(v => v + 1) }), [key])
    React.useEffect(() => {
      let active = true
      setState({ key, meta: undefined, error: '' })
      loadBrowserImageMetadata(imageId, imageSource).then(meta => { if (active) setState({ key, meta, error: '' }) }, error => {
        if (active) setState({ key, meta: undefined, error: error.message })
      })
      return () => { active = false }
    }, [key, revision])
    const ready = state.key === key && state.meta !== undefined
    const stretch = ready && supportsImageStretch(state.meta)
    return e('label', { className: 'qxsim-field' }, e('span', { className: 'qxsim-field-label' }, t('图片类型')),
      e('select', { 'aria-label': t('图片类型'), disabled: !stretch, value: ready ? resolveImageType(state.meta, value) : '', onChange: event => commit('imageType', event.target.value) },
        !ready ? e('option', { value: '' }, state.error ? t('元数据加载失败') : t('读取素材边界…')) : e('option', { value: 'Basic' }, t('基础')),
        stretch ? e('option', { value: 'Stretch' }, t('拉伸')) : null),
      state.error ? e('small', { role: 'status' }, state.error) : null)
  }
}
