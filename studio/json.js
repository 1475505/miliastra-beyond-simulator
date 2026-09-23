/** Lossless JSON helpers. Invalid state is rejected instead of being coerced. */

export function assertLosslessJson(value, path = '$', seen = new Set()) {
  if (value === undefined) throw new Error(`undefined at ${path}`)
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new Error(`non-finite number at ${path}`)
  }
  if (typeof value === 'bigint' || typeof value === 'function' || typeof value === 'symbol') {
    throw new Error(`non-JSON value at ${path}`)
  }
  if (value === null || typeof value !== 'object') return
  if (seen.has(value)) throw new Error(`circular value at ${path}`)
  seen.add(value)
  if (Array.isArray(value)) {
    value.forEach((item, i) => assertLosslessJson(item, `${path}[${i}]`, seen))
  } else {
    for (const [key, item] of Object.entries(value)) {
      assertLosslessJson(item, `${path}.${key}`, seen)
    }
  }
  seen.delete(value)
}

export function toJson(value) {
  assertLosslessJson(value)
  return JSON.parse(JSON.stringify(value))
}

export function assertNoUndefined(value, path = '$') {
  assertLosslessJson(value, path)
}
