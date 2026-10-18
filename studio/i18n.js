import en from './locales/en.js'

const storageKey = 'qxqy-ui-language'
const eventName = 'qxqy-ui-language-change'
const listeners = new Set()
const valid = value => ['auto', 'zh', 'en'].includes(value)
function storedPreference() {
  try { const value = globalThis.localStorage?.getItem(storageKey); return valid(value) ? value : 'auto' }
  catch { return 'auto' }
}
let preference = storedPreference()
let systemHint = null

export function resolveLocale(value = 'auto', browserLanguage = 'zh-CN', systemLanguage = '') {
  if (value === 'zh' || value === 'en') return value
  return /^(?:zh|cmn|yue|wuu|hak|nan|gan|hsn)(?:[-_]|$)/i.test(systemLanguage || browserLanguage) ? 'zh' : 'en'
}
export const getLanguagePreference = () => preference
export const getSystemLanguage = () => systemHint || { language: typeof window === 'undefined' ? 'zh-CN'
  : (globalThis.navigator?.language || globalThis.navigator?.languages?.[0] || Intl.DateTimeFormat().resolvedOptions().locale || 'en'), source: 'browser' }
export const getLocale = () => resolveLocale(preference, getSystemLanguage().language)

export async function loadSystemLanguage(endpoint, fetcher = globalThis.fetch) {
  try {
    const response = await fetcher(endpoint, { method: 'POST', mode: 'same-origin', credentials: 'same-origin', cache: 'no-store',
      headers: { 'content-type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(4000) })
    if (response.ok) {
      const envelope = await response.json()
      const value = envelope.ok ? envelope.value : null
      if (typeof value?.language === 'string' && value.language.length <= 80) {
        const language = Intl.getCanonicalLocales(value.language.replaceAll('_', '-'))[0]
        if (language) {
          systemHint = { language, source: value.source || 'host' }
          for (const listener of listeners) listener()
        }
      }
    }
  } catch { /* Old hosts and failed OS queries retain the browser fallback. */ }
  return getSystemLanguage()
}

function refresh(event) {
  if (event?.type === 'storage' && event.key !== storageKey && event.key !== null) return
  preference = event?.type === eventName ? event.detail : storedPreference()
  for (const listener of listeners) listener()
}
export function setLanguagePreference(value) {
  if (!valid(value)) return
  preference = value
  try { globalThis.localStorage?.setItem(storageKey, value) } catch { /* Keep this session usable if storage is blocked. */ }
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(eventName, { detail: value }))
  else for (const listener of listeners) listener()
}
export function subscribeLocale(listener) {
  if (!listeners.size && typeof window !== 'undefined') {
    preference = storedPreference()
    window.addEventListener('storage', refresh)
    window.addEventListener(eventName, refresh)
    window.addEventListener('languagechange', refresh)
  }
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
    if (!listeners.size && typeof window !== 'undefined') {
      window.removeEventListener('storage', refresh)
      window.removeEventListener(eventName, refresh)
      window.removeEventListener('languagechange', refresh)
    }
  }
}
export function createUseLocale(React) {
  return () => {
    const [, render] = React.useReducer(value => value + 1, 0)
    React.useEffect(() => { const unsubscribe = subscribeLocale(render); render(); return unsubscribe }, [])
    return getLocale()
  }
}

const format = (message, values) => message.replace(/\{(\d+)\}/g, (match, index) => index < values.length ? String(values[index] ?? '') : match)
const patterns = Object.entries(en).filter(([key]) => /\{\d+\}/.test(key)).map(([key, value]) => {
  const slots = []
  const source = key.split(/(\{\d+\})/).map(part => {
    const match = part.match(/^\{(\d+)\}$/)
    if (match) { slots.push(Number(match[1])); return '([\\s\\S]*?)' }
    return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }).join('')
  return { expression: new RegExp(`^${source}$`), value, slots }
})

export function translate(locale, key, ...values) {
  if (Array.isArray(key) && Object.hasOwn(key, 'raw')) key = key.reduce((text, part, i) => text + (i ? `{${i - 1}}` : '') + part, '')
  if (typeof key !== 'string') return key
  if (locale !== 'en') return format(key, values)
  if (Object.hasOwn(en, key)) return format(en[key], values)
  // Only callers marking UI metadata/errors use this path; project text is never passed here.
  if (!values.length && /[\p{Script=Han}]/u.test(key)) for (const pattern of patterns) {
    const match = pattern.expression.exec(key)
    if (!match) continue
    const captured = []
    pattern.slots.forEach((index, i) => { captured[index] = match[i + 1] })
    return format(pattern.value, captured)
  }
  return format(key, values)
}
export const t = (key, ...values) => translate(getLocale(), key, ...values)

export function localizePage(root = document) {
  for (const element of root.querySelectorAll('[data-i18n]')) element.textContent = t(element.dataset.i18n)
  for (const attribute of ['title', 'placeholder', 'aria-label']) for (const element of root.querySelectorAll(`[data-i18n-${attribute}]`)) {
    element.setAttribute(attribute, t(element.getAttribute(`data-i18n-${attribute}`)))
  }
  if (root === document) document.documentElement.lang = getLocale() === 'zh' ? 'zh-CN' : 'en'
}
