import { groupMaskedPaint, isHardRectMask, paintMaskCanvas } from '../studio/play/image-mask.js'
import { hasPlaneArea } from '../studio/ui/layout.js'
import { loadBrowserImageAsset, subscribeImageRefresh } from '../studio/assets/browser.js'
import { imageAssetKey } from '../studio/assets/catalog.js'

// Groups stay in stage coordinates, so existing DOM controls retain their full
// world transforms. The mask image alone maps local image coordinates to stage.
// A single mask on the composited group avoids fading overlapping children twice.
export function createMaskedControls(React) {
  const e = React.createElement
  function MaskGroup({ mask, canvasWidth, canvasHeight, children }) {
    const { width, height, featherX, featherY, matrix: m } = mask
    const key = imageAssetKey(mask.imageId, mask.imageSource)
    const [loaded, setLoaded] = React.useState(null)
    const [revision, setRevision] = React.useState(0)
    React.useEffect(() => subscribeImageRefresh(changed => { if (changed === key) setRevision(v => v + 1) }), [key])
    React.useEffect(() => {
      let active = true
      setLoaded(null)
      if (mask.primitive === 'sprite') loadBrowserImageAsset(mask.imageId, mask.imageSource).then(
        asset => { if (active) setLoaded({ key, revision, asset }) },
        () => { /* The image preview reports the load failure; coverage stays empty. */ })
      return () => { active = false }
    }, [key, revision, mask.primitive])
    const asset = loaded?.key === key && loaded.revision === revision ? loaded.asset : null
    const hard = isHardRectMask(mask)
    const empty = !(width > 0 && height > 0) || !hasPlaneArea(m) || (hard && mask.reverseMaskArea)
    const raster = React.useMemo(() => {
      if (empty || hard) return ''
      const canvas = document.createElement('canvas')
      const scale = Math.min(2, 2048 / Math.max(width, height))
      canvas.width = Math.max(1, Math.ceil(width * scale))
      canvas.height = Math.max(1, Math.ceil(height * scale))
      paintMaskCanvas(canvas, mask, asset)
      return canvas.toDataURL('image/png')
    }, [empty, hard, width, height, featherX, featherY, mask.primitive, mask.imageType, mask.reverseMaskArea, asset])
    if (empty) return null
    const tx = m.tx - m.a * width / 2 + m.c * height / 2
    const ty = canvasHeight - m.ty + m.b * width / 2 - m.d * height / 2
    const transform = `matrix(${m.a} ${-m.b} ${-m.c} ${m.d} ${tx} ${ty})`
    const shape = raster
      ? `<image width="${width}" height="${height}" preserveAspectRatio="none" href="${raster}" transform="${transform}"/>`
      : `<rect width="${width}" height="${height}" fill="white" transform="${transform}"/>`
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${canvasWidth}" height="${canvasHeight}" viewBox="0 0 ${canvasWidth} ${canvasHeight}">${shape}</svg>`
    return e('div', { className: 'qxsim-mask-group', 'data-mask-id': mask.id,
      style: { position: 'absolute', inset: 0, pointerEvents: 'none',
        maskImage: `url("data:image/svg+xml,${encodeURIComponent(svg)}")`, maskMode: 'alpha', maskSize: '100% 100%', maskRepeat: 'no-repeat' } }, children)
  }
  return function MaskedControls({ boxes, canvasWidth, canvasHeight, renderControl }) {
    const render = entries => entries.map(entry => entry.item ? renderControl(entry.item)
      : e(MaskGroup, { key: `mask:${entry.mask.id}`, mask: entry.mask, canvasWidth, canvasHeight }, render(entry.children)))
    return render(groupMaskedPaint(boxes))
  }
}
