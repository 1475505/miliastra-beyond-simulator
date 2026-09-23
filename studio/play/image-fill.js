/**
 * Horizontal/vertical image fill in the renderers' centered, Y-down space.
 * Runtime keeps EnumItems; the scene boundary publishes their names.
 * Radial fill is not implemented by either renderer.
 */
export function imageFillRect(item, width, height) {
  if (item.fillType !== 'Horizontal' && item.fillType !== 'Vertical') return null
  const raw = Number(item.fillAmount ?? 1)
  // Invalid/missing amounts retain the complete proxy; finite progress clamps
  // to its visible range. This is a simulator rendering policy.
  const amount = Number.isFinite(raw) ? Math.max(0, Math.min(1, raw)) : 1
  if (item.fillType === 'Horizontal') {
    const filledWidth = width * amount
    return {
      x: item.fillHorizontalType === 'Right' ? width / 2 - filledWidth : -width / 2,
      y: -height / 2,
      width: filledWidth,
      height,
    }
  }
  const filledHeight = height * amount
  return {
    x: -width / 2,
    y: item.fillVerticalType === 'Top' ? -height / 2 : height / 2 - filledHeight,
    width,
    height: filledHeight,
  }
}
