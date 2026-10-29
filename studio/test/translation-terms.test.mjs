import test from 'node:test'
import assert from 'node:assert/strict'
import { queryTranslationTerms, TERMS_ENDPOINT } from '../../scripts/query-translation-terms.mjs'

test('batch lookup accepts only equal source terms and distinguishes no match from failed queries', async () => {
  const record = term => ({ source_term: term, source_lang: 'chs', target_lang: 'en', translation: term === '元件' ? 'Prefab' : null,
    chs: term === '元件' ? term : null, matched: term === '元件' })
  const requests = []
  const fetch = async (url, options) => {
    assert.equal(url, TERMS_ENDPOINT)
    const request = JSON.parse(options.body)
    requests.push(request)
    return { ok: true, json: async () => ({ success: true, data: request.terms.map(record).reverse() }) }
  }
  const result = await queryTranslationTerms(['元件', '字体设置', '元件'], { fetch, batchSize: 1 })
  assert.equal(requests.length, 2)
  assert.deepEqual(result.records.map(row => row.source_term), ['元件', '字体设置'])
  assert.equal(result.records[0].translation, 'Prefab')
  assert.equal(result.records[1].matched, false)
  const wrong = record('元件'); wrong.chs = '元件名称'
  await assert.rejects(queryTranslationTerms(['元件'], { fetch: async () => ({ ok: true, json: async () => ({ success: true, data: [wrong] }) }) }), /not an exact equivalent/)
  await assert.rejects(queryTranslationTerms(['元件'], { fetch: async () => ({ ok: false, status: 503 }) }), /HTTP 503/)
  await assert.rejects(queryTranslationTerms(['元件'], { fetch: async () => ({ ok: true, json: async () => ({ success: true, data: [] }) }) }), /Incomplete/)
})
