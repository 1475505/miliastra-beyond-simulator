import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const TERMS_ENDPOINT = 'https://ugc.070077.xyz/api/v1/translate/terms/batch'

// The GET endpoint's exact_match flag can also mean a containing phrase.
// Audit evidence must come from equal Chinese terms, never fuzzy candidates.
export async function queryTranslationTerms(terms, { fetch: fetcher = globalThis.fetch, batchSize = 80, onProgress = () => {} } = {}) {
  if (!Array.isArray(terms) || !terms.length || terms.some(term => typeof term !== 'string' || !term)) {
    throw new Error('Nonempty terms are required')
  }
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 80) throw new Error('batchSize must be from 1 to 80')
  const unique = [...new Set(terms)]
  const records = []
  for (let offset = 0; offset < unique.length; offset += batchSize) {
    const batch = unique.slice(offset, offset + batchSize)
    const response = await fetcher(TERMS_ENDPOINT, { method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ terms: batch, source_lang: 'chs', target_lang: 'en' }),
      signal: AbortSignal.timeout(45_000) })
    if (!response.ok) throw new Error('Term query failed (HTTP ' + response.status + ')')
    const body = await response.json()
    if (!body.success || !Array.isArray(body.data) || body.data.length !== batch.length) throw new Error('Incomplete term response')
    const received = new Map()
    for (const record of body.data) {
      if (!batch.includes(record.source_term) || received.has(record.source_term)
        || record.source_lang !== 'chs' || record.target_lang !== 'en' || typeof record.matched !== 'boolean') {
        throw new Error('Invalid term response identity')
      }
      if (record.matched && (record.chs !== record.source_term || typeof record.translation !== 'string' || !record.translation.trim())) {
        throw new Error('Term response is not an exact equivalent: ' + record.source_term)
      }
      received.set(record.source_term, record)
    }
    records.push(...batch.map(term => received.get(term)))
    onProgress({ completed: records.length, total: unique.length })
  }
  return { endpoint: TERMS_ENDPOINT, checkedAt: new Date().toISOString(), source_lang: 'chs', target_lang: 'en', records }
}

async function main() {
  const output = process.argv[2]
  if (!output) throw new Error('Usage: node scripts/query-translation-terms.mjs <output.json>')
  const { default: en } = await import('../studio/locales/en.js')
  const result = await queryTranslationTerms(Object.keys(en), { onProgress: value => process.stdout.write(JSON.stringify(value) + '\n') })
  await writeFile(resolve(output), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' })
  process.stdout.write('Query evidence saved. Review results before editing translations or the audit record.\n')
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 1 })
}
