import { keyHintSize, paintKeyHintCanvas } from '../studio/play/key-hint-paint.js'

export function createKeyHintPreview(React) {
  return function KeyHintPreview({ item, zoom }) {
    const ref = React.useRef(null)
    const size = keyHintSize(item, item.width, item.height)
    React.useLayoutEffect(() => {
      if (ref.current) paintKeyHintCanvas(ref.current, item, item.width, item.height,
        Math.min(2, window.devicePixelRatio || 1) * zoom)
    }, [item, zoom])
    return React.createElement('canvas', { ref, className: 'qxsim-key-hint', role: 'img',
      'aria-label': item.keyHint?.label || '',
      style: { position: 'absolute', left: '50%', top: 0, transform: 'translateX(-50%)',
        width: `${item.width > 0 ? size.width / item.width * 100 : 0}%`, height: '100%' } })
  }
}
