// Geometric proxies shared by images and masks, aligned with the image editor
// 103025f (GPL-3.0, frontend/src/maskShapes.ts). Coordinates use Y down.
export const PRIMITIVE_POINTS = {
  triangle: [0, -.5, -.5, .5, .5, .5],
  fourstar: [0, -.5, .12, -.12, .5, 0, .12, .12, 0, .5, -.12, .12, -.5, 0, -.12, -.12],
  fivestar: [0, -.5, .11, -.15, .48, -.15, .18, .07, .29, .42, 0, .21, -.29, .42, -.18, .07, -.48, -.15, -.11, -.15],
}

export function drawPrimitiveShape(ctx, primitive, width, height) {
  if (primitive === 'rect') { ctx.fillRect(-width / 2, -height / 2, width, height); return }
  ctx.beginPath()
  if (primitive === 'circle' || primitive === 'ring') {
    ctx.ellipse(0, 0, width / 2, height / 2, 0, 0, Math.PI * 2)
    if (primitive === 'ring') {
      ctx.moveTo(width * .4, 0)
      ctx.ellipse(0, 0, width * .4, height * .4, 0, 0, Math.PI * 2)
    }
  } else {
    const points = PRIMITIVE_POINTS[primitive] || []
    for (let i = 0; i < points.length; i += 2) {
      if (i) ctx.lineTo(points[i] * width, points[i + 1] * height)
      else ctx.moveTo(points[i] * width, points[i + 1] * height)
    }
    ctx.closePath()
  }
  ctx.fill('evenodd')
}
