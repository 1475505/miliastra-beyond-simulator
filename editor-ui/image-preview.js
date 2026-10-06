import { loadBrowserImage, subscribeImageRefresh } from '../studio/assets/browser.js'
import { tintedImage } from '../studio/assets/raster.js'
import { imageFillRect } from '../studio/play/image-fill.js'

function canvas(width, height) {
  const node = document.createElement('canvas')
  node.width = width; node.height = height
  return node
}

export function createImagePreview(React) {
  const e = React.createElement
  return function ImagePreview({ item }) {
    const ref = React.useRef(null)
    const [state, setState] = React.useState({ image: null, error: '' })
    const [revision, setRevision] = React.useState(0)
    React.useEffect(() => subscribeImageRefresh(id => { if (id === item.imageId) setRevision(v => v + 1) }), [item.imageId])
    React.useEffect(() => {
      let active = true
      setState({ image: null, error: '' })
      loadBrowserImage(item.imageId).then(image => { if (active) setState({ image, error: '' }) }, error => {
        if (active) setState({ image: null, error: error.message })
      })
      return () => { active = false }
    }, [item.imageId, revision])
    React.useEffect(() => {
      const el = ref.current
      if (!state.image || !el) return
      const image = tintedImage(state.image, item.imageColor, canvas)
      el.width = image.width; el.height = image.height
      const ctx = el.getContext('2d')
      const fill = item.enableFill ? imageFillRect(item, el.width, el.height) : null
      if (fill) { ctx.beginPath(); ctx.rect(fill.x + el.width / 2, fill.y + el.height / 2, fill.width, fill.height); ctx.clip() }
      ctx.globalAlpha = ((Number(item.imageColor ?? 0xffffffff) >>> 24) & 255) / 255
      ctx.drawImage(image, 0, 0)
    }, [state.image, item.imageColor, item.enableFill, item.fillType, item.fillHorizontalType, item.fillVerticalType, item.fillAmount])
    if (!state.image) return e('span', { className: 'qxsim-box-label', title: state.error, role: state.error ? 'status' : undefined }, state.error ? `图片 ${item.imageId} 加载失败` : `加载图片 ${item.imageId}…`)
    return e('canvas', { ref, 'data-image-id': item.imageId, 'aria-label': `图片 ${item.imageId}`, style: { display: 'block', position: 'absolute', inset: 0, width: '100%', height: '100%' } })
  }
}
