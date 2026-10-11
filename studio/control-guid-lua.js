import { createHash } from 'node:crypto'

// Retained in the ledger as context for AI review, not a semantic guarantee.
export const scriptGuidSignature = scripts => createHash('sha256').update(JSON.stringify(
  scripts.map(({ id, path, source }) => ({ id, path, source })),
)).digest('hex')

export function composeControlGuidChanges(changes) {
  const identities = new Map()
  for (const row of changes) {
    const key = `${row.controlAsset}:${row.controlId}`
    const previous = identities.get(key)
    if (previous && previous.newGuid !== row.oldGuid) throw new Error('索引变更记录不连续，请交给 AI 核对')
    identities.set(key, { oldGuid: previous?.oldGuid ?? row.oldGuid, newGuid: row.newGuid })
  }
  const mapping = new Map()
  for (const { oldGuid, newGuid } of identities.values()) {
    if (mapping.has(oldGuid)) throw new Error('多个控件共用旧索引，请交给 AI 按控件身份核对')
    mapping.set(oldGuid, newGuid)
  }
  return new Map([...mapping].filter(([before, after]) => before !== after))
}

export function planLuaGuidReplacements(source, mapping) {
  const edits = []
  const values = new Map([...mapping].map(([before, after]) => [String(before), after]))
  let line = 1, scanned = 0, lineStart = 0
  // Deliberate full-source text replacement: includes constants, strings and
  // comments, regardless of purpose. Complete digit runs avoid cutting a
  // longer decimal number. One pass prevents cascading overlapping mappings.
  const updated = source.replace(/\d+/g, (digits, start) => {
    if (!values.has(digits)) return digits
    for (; scanned < start; scanned++) {
      if (source[scanned] === '\n') { line++; lineStart = scanned + 1 }
    }
    const newGuid = values.get(digits)
    const end = start + digits.length
    const lineEnd = source.indexOf('\n', end)
    edits.push({ start, end, oldGuid: Number(digits), newGuid, line,
      before: source.slice(lineStart, lineEnd < 0 ? source.length : lineEnd).trim() })
    return String(newGuid)
  })
  return { source: updated, edits, issues: [] }
}
