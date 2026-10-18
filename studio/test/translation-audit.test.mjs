import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import en from '../locales/en.js'
import { translate } from '../i18n.js'
import { createStudio } from '../index.js'
import { queryTranslationTerms, TERMS_ENDPOINT } from '../../scripts/query-translation-terms.mjs'

const audit = JSON.parse(readFileSync(new URL('../docs/english-translation-audit.json', import.meta.url), 'utf8'))

test('every English message has current API lookup evidence and an explicit reviewed decision', () => {
  assert.equal(audit.messages.length, Object.keys(en).length)
  assert.deepEqual(audit.messages.map(row => row.zh).sort(), Object.keys(en).sort())
  const counts = { apiMatches: 0, apiAligned: 0, contextOverrides: 0, noExactApiMatch: 0, changed: 0 }
  for (const row of audit.messages) {
    assert.equal(en[row.zh], row.en, 'Translation changed without renewed review: ' + row.zh)
    assert.equal(typeof row.api.matched, 'boolean')
    if (row.api.matched) {
      counts.apiMatches++
      assert.ok(row.api.translation)
      if (row.review.kind === 'context-override') {
        counts.contextOverrides++
        assert.ok(row.review.reason && row.review.references.length)
        assert.notEqual(row.en, row.api.translation)
      } else {
        counts.apiAligned++
        assert.equal(row.review.kind, 'api-exact')
        assert.equal(row.en, row.api.translation)
      }
    } else {
      counts.noExactApiMatch++
      assert.equal(row.review.kind, 'manual')
      assert.ok(row.review.reason)
    }
    if (row.previous !== undefined) counts.changed++
  }
  for (const [key, value] of Object.entries(counts)) assert.equal(audit.summary[key], value)
  assert.equal(audit.summary.queried, audit.messages.length)
  assert.equal(audit.summary.reviewed, audit.messages.length)
  for (const term of audit.glossary) {
    if (Object.hasOwn(en, term.zh)) assert.equal(en[term.zh], term.en, term.zh)
    if (term.basis === 'terms-api') {
      assert.equal(term.api.matched, true)
      assert.equal(term.api.source_term, term.zh)
      assert.equal(term.api.chs, term.zh)
      assert.equal(term.api.translation, term.en)
    }
    if (term.propagate) for (const [zh, english] of Object.entries(en)) {
      if (zh.includes(term.zh)) assert.ok(english.toLowerCase().includes(term.en.toLowerCase()), 'Inconsistent term: ' + zh)
    }
  }
})

test('reviewed control names and fill enums reach real inspector metadata without changing enum values', () => {
  // Terminology follows the documented TextWindowControl / GridScrollerControl
  // types and the captured API Radial90/180/360 entries, not renderer output.
  const studio = createStudio()
  for (const [id, expected] of [['n1', 'Container Control'], ['n5', 'Grid Scroller'], ['n7', 'Text Window']]) {
    const snapshot = studio.patch({ op: 'select', id })
    assert.equal(translate('en', snapshot.inspector.label), expected)
  }
  const image = studio.patch({ op: 'select', id: 'n9' })
  const shape = image.inspector.fields.find(field => field.key === 'fillType')
  assert.deepEqual(shape.options.map(option => option.value), ['Horizontal', 'Vertical', 'Radial90', 'Radial180', 'Radial360'])
  assert.deepEqual(shape.options.slice(2).map(option => translate('en', option.label)), ['Radial90', 'Radial180', 'Radial360'])
  assert.equal(translate('en', '边缘羽化'), 'Soft Edge')
  assert.equal(translate('en', '中心'), 'Pivot')
  assert.equal(translate('en', '居中'), 'Center')
  assert.equal(translate('en', '关闭'), 'Close')
  assert.equal(translate('en', 'ClientUIGridScrollerControl'), 'ClientUIGridScrollerControl')
})

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
