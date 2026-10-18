import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveLocale, translate, loadSystemLanguage, getLocale, getSystemLanguage, setLanguagePreference } from '../i18n.js'
import en from '../locales/en.js'

test('Chinese language families use Chinese; other system languages default to English; manual choice wins', () => {
  for (const language of ['zh-CN', 'zh-TW', 'zh-Hant-HK', 'zh_SG', 'cmn-Hans', 'yue-HK']) {
    assert.equal(resolveLocale('auto', language), 'zh', language)
    assert.equal(resolveLocale('en', language), 'en')
  }
  for (const language of ['en-US', 'ja-JP', 'de-DE', 'ko-KR', 'fr', '']) {
    assert.equal(resolveLocale('auto', language), 'en', language)
    assert.equal(resolveLocale('zh', language), 'zh')
  }
  assert.equal(resolveLocale('auto', 'en-US', 'zh-CN'), 'zh')
  assert.equal(resolveLocale('auto', 'zh-CN', 'en-US'), 'en')
  assert.equal(resolveLocale('en', 'en-US', 'zh-CN'), 'en')
  assert.equal(resolveLocale('zh', 'en-US', 'en-US'), 'zh')
})

test('an English embedded browser follows the host UI language while manual selection still wins', async t => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  Object.defineProperty(globalThis, 'window', { configurable: true, value: new EventTarget() })
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { language: 'en-US', languages: ['en-US'] } })
  t.after(() => {
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow); else delete globalThis.window
    if (previousNavigator) Object.defineProperty(globalThis, 'navigator', previousNavigator); else delete globalThis.navigator
    setLanguagePreference('auto')
  })
  setLanguagePreference('auto')
  await loadSystemLanguage('/legacy', async () => ({ ok: false, status: 400 }))
  assert.equal(getLocale(), 'en', 'old hosts must keep the browser fallback')
  await loadSystemLanguage('/locale', async () => ({ ok: true, json: async () => ({ ok: true, value: { language: 'zh-CN', source: 'windows-ui' } }) }))
  assert.equal(getLocale(), 'zh')
  assert.deepEqual(getSystemLanguage(), { language: 'zh-CN', source: 'windows-ui' })
  setLanguagePreference('en')
  assert.equal(getLocale(), 'en')
  setLanguagePreference('auto')
  assert.equal(getLocale(), 'zh')
})

test('UI terminology and parameter substitution preserve content, paths and API identifiers', () => {
  assert.equal(translate('en', '千星沙箱'), 'Miliastra Sandbox')
  assert.equal(translate('en', '千星奇域'), 'Miliastra Wonderland')
  assert.equal(translate('en', '元件'), 'Prefab')
  assert.equal(translate('en', '客户端控件模板'), 'Client Control Template')
  assert.equal(translate('en', '中心 X'), 'Pivot X')
  assert.equal(translate('en', '存档：{0}', '文本框 {1} <script>'), 'Save: 文本框 {1} <script>')
  assert.equal(translate('en', '图片 42 加载失败'), 'Failed to load image 42')
  assert.equal(translate('zh', '当前字体：{0}', 'E:\\我的字体\\a.ttf'), '当前字体：E:\\我的字体\\a.ttf')
  assert.equal(translate('en', 'game.GetLanguageType'), 'game.GetLanguageType')
  assert.equal(translate('en', '任意玩家内容'), '任意玩家内容')
  const parts = ['索引范围：', '–', '']; parts.raw = [...parts]
  assert.equal(translate('en', parts, 12, 99), 'Index range: 12–99')
})

test('every translation retains the original parameter slots', () => {
  const slots = message => [...new Set(message.match(/\{\d+\}/g) || [])].sort()
  for (const [key, value] of Object.entries(en)) {
    assert.ok(value && !/[\p{Script=Han}]/u.test(value), key)
    assert.deepEqual(slots(value), slots(key), key)
  }
})
