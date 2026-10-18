import { createEditor } from 'qxqy-editor-ui'
import manifest from '../../package.json' with { type: 'json' }
import { loadSystemLanguage, subscribeLocale, t } from '../../studio/i18n.js'

void loadSystemLanguage('/qxqy-simulator/api/locale')

window.__ModuleLoader__.load({
  id: 'dsh-plugin-beyond-simulator',
  factory: require => {
    const exports = {}
    const React = require('react')
    const editor = createEditor(React, {
      version: manifest.version,
      async api(sessionId, action, body) {
        const response = await fetch('/qxqy-simulator/api/' + action, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId, ...(body || {}) }), ...(action === 'play' ? { signal: AbortSignal.timeout(15_000) } : {}) })
        const envelope = await response.json()
        if (!response.ok || !envelope.ok) throw new Error(envelope.error || 'Request failed')
        return envelope.value
      },
      playUrl: sessionId => '/qxqy-simulator/play#' + encodeURIComponent(sessionId),
    })
    exports.inject = ['slots']
    exports.apply = ctx => {
      editor.ensureStyle()
      ctx.effect(() => editor.removeStyle, 'qxqy-simulator: style cleanup')
      let title = () => t('模拟器')
      // Harness caches tab labels and refreshes them on its locale registry's
      // revision. Publish the plugin's selected language through that registry
      // without changing the host preference or re-registering the editor slot.
      // Optional injection keeps hosts without a locale service usable.
      ctx.inject(['locale'], scope => {
        let removeDictionary, previous
        const translate = scope.locale.bind('qxqy-simulator')
        title = () => translate('title')
        const publish = () => {
          const value = t('模拟器')
          if (value === previous) return
          previous = value
          removeDictionary?.()
          removeDictionary = scope.locale.register('qxqy-simulator', { en: { title: value }, zh: { title: value } })
        }
        scope.effect(() => {
          publish()
          const unsubscribe = subscribeLocale(publish)
          return () => { unsubscribe(); title = () => t('模拟器'); removeDictionary?.() }
        }, 'qxqy-simulator: tab language')
      })
      ctx.slots.inject('conversation.view', () => ctx.slots.register({ name: 'conversation.view', id: 'qxqy-simulator', order: 20, label: () => title() }, editor.SimulatorView))
    }
    return exports
  },
})
