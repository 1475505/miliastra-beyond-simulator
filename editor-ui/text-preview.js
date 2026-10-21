import { DEFAULT_FONT } from '../studio/fonts.js'
import { paintRichTextCanvas } from '../studio/play/rich-text-paint.js'

export function createTextPreview(React) {
  return function TextPreview({ item, zoom, fontFamily }) {
    const ref = React.useRef(null)
    const rich = !!item.textLayout?.richLines
    React.useLayoutEffect(() => {
      if (rich && ref.current) paintRichTextCanvas(ref.current, item, item.width, item.height, fontFamily,
        Math.min(2, window.devicePixelRatio || 1) * zoom)
    }, [item, zoom, fontFamily, rich])
    if (rich) return React.createElement('canvas', { ref, className: 'qxsim-rich-text',
      role: 'img', 'aria-label': item.textLayout.lines.join('\n'),
      style: { position: 'absolute', left: 0, top: 0, width: '100%', height: '100%' } })
    return React.createElement('span', { style: textPreviewStyle(item, zoom, fontFamily) }, textPreviewContent(item))
  }
}

export function textPreviewContent(item) {
  const layout = item.textLayout
  return layout ? layout.lines.slice(0, layout.visibleLineCount ?? layout.lines.length).join('\n') : item.text ?? ''
}

export function textPreviewStyle(item, zoom, fontFamily) {
  const layout = item.textLayout
  return {
    flex: '0 0 auto', width: `${(layout?.textWidth ?? Math.max(0, item.width - 4)) * zoom}px`,
    margin: `0 ${2 * zoom}px`, whiteSpace: 'pre',
    fontFamily: fontFamily || DEFAULT_FONT,
    fontSize: `${(layout?.fontSize ?? item.fontSize ?? 20) * zoom}px`,
    lineHeight: `${(layout?.lineHeight ?? (item.fontSize ?? 20) * 1.2) * zoom}px`,
    textAlign: item.horizontalAlignment === 'Right' ? 'right' : item.horizontalAlignment === 'Middle' ? 'center' : 'left',
  }
}
