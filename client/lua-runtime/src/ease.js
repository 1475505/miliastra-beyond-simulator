/** Penner-style easings. Linear is observed; others are simulator policy. */

function bounceOut(t) {
  const n1 = 7.5625
  const d1 = 2.75
  if (t < 1 / d1) return n1 * t * t
  if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75
  if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375
  return n1 * (t -= 2.625 / d1) * t + 0.984375
}

const fns = {
  Linear: (t) => t,
  InSine: (t) => 1 - Math.cos((t * Math.PI) / 2),
  OutSine: (t) => Math.sin((t * Math.PI) / 2),
  InOutSine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
  InQuad: (t) => t * t,
  OutQuad: (t) => 1 - (1 - t) * (1 - t),
  InOutQuad: (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2),
  InCubic: (t) => t * t * t,
  OutCubic: (t) => 1 - (1 - t) ** 3,
  InOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
  InQuart: (t) => t ** 4,
  OutQuart: (t) => 1 - (1 - t) ** 4,
  InOutQuart: (t) => (t < 0.5 ? 8 * t ** 4 : 1 - (-2 * t + 2) ** 4 / 2),
  InQuint: (t) => t ** 5,
  OutQuint: (t) => 1 - (1 - t) ** 5,
  InOutQuint: (t) => (t < 0.5 ? 16 * t ** 5 : 1 - (-2 * t + 2) ** 5 / 2),
  InExpo: (t) => (t === 0 ? 0 : 2 ** (10 * t - 10)),
  OutExpo: (t) => (t === 1 ? 1 : 1 - 2 ** (-10 * t)),
  InOutExpo: (t) => {
    if (t === 0 || t === 1) return t
    return t < 0.5 ? 2 ** (20 * t - 10) / 2 : (2 - 2 ** (-20 * t + 10)) / 2
  },
  InCirc: (t) => 1 - Math.sqrt(1 - t ** 2),
  OutCirc: (t) => Math.sqrt(1 - (t - 1) ** 2),
  InOutCirc: (t) =>
    t < 0.5
      ? (1 - Math.sqrt(1 - (2 * t) ** 2)) / 2
      : (Math.sqrt(1 - (-2 * t + 2) ** 2) + 1) / 2,
  InBack: (t) => {
    const c1 = 1.70158
    return (c1 + 1) * t * t * t - c1 * t * t
  },
  OutBack: (t) => {
    const c1 = 1.70158
    const c3 = c1 + 1
    return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2
  },
  InOutBack: (t) => {
    const c1 = 1.70158
    const c2 = c1 * 1.525
    return t < 0.5
      ? ((2 * t) ** 2 * ((c2 + 1) * 2 * t - c2)) / 2
      : ((2 * t - 2) ** 2 * ((c2 + 1) * (t * 2 - 2) + c2) + 2) / 2
  },
  InElastic: (t) => {
    if (t === 0 || t === 1) return t
    return -(2 ** (10 * t - 10)) * Math.sin((t * 10 - 10.75) * ((2 * Math.PI) / 3))
  },
  OutElastic: (t) => {
    if (t === 0 || t === 1) return t
    return 2 ** (-10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1
  },
  InOutElastic: (t) => {
    if (t === 0 || t === 1) return t
    const c = (2 * Math.PI) / 4.5
    return t < 0.5
      ? -(2 ** (20 * t - 10) * Math.sin((20 * t - 11.125) * c)) / 2
      : (2 ** (-20 * t + 10) * Math.sin((20 * t - 11.125) * c)) / 2 + 1
  },
  InBounce: (t) => 1 - bounceOut(1 - t),
  OutBounce: bounceOut,
  InOutBounce: (t) =>
    t < 0.5 ? (1 - bounceOut(1 - 2 * t)) / 2 : (1 + bounceOut(2 * t - 1)) / 2,
}

export function ease(name, t) {
  const f = fns[name] || fns.Linear
  if (t <= 0) return 0
  if (t >= 1) return 1
  return f(t)
}
