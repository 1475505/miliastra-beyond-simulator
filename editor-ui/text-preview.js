import { DEFAULT_FONT } from '../studio/fonts.js'

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
