import { test } from 'node:test'
import assert from 'node:assert/strict'
import { languageTypeFromClientLog } from '../host/client-language.js'

test('client log language maps to LanguageType and keeps the latest request', () => {
  assert.equal(languageTypeFromClientLog('Request to set language:en\nRequest to set language:zh-cn'), 'LanguageChs')
  assert.equal(languageTypeFromClientLog('Request to set language:ja-jp'), 'LanguageJpn')
  assert.equal(languageTypeFromClientLog('no language here'), null)
})
