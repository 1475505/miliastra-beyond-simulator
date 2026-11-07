import { createEditor } from 'qxqy-editor-ui'
import manifest from '../../package.json' with { type: 'json' }
import { loadSystemLanguage, subscribeLocale, t } from '../../studio/i18n.js'

void loadSystemLanguage('/qxqy-simulator/api/locale')

window.__ModuleLoader__.load({
  id: 'dsh-plugin-beyond-simulator',
  factory: require => {
    const exports = {}
    const React = require('react')
    async function api(sessionId, action, body) {
      const response = await fetch('/qxqy-simulator/api/' + action, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId, ...(body || {}) }), ...(action === 'play' ? { signal: AbortSignal.timeout(15_000) } : {}) })
      const envelope = await response.json()
      if (!response.ok || !envelope.ok) throw new Error(envelope.error || 'Request failed')
      return envelope.value
    }
    const options = {
      version: manifest.version,
      api,
      playUrl: sessionId => '/qxqy-simulator/play#' + encodeURIComponent(sessionId),
    }
    const editor = createEditor(React, options)
    function SimulatorSession({ sessionId }) {
      const [state, setState] = React.useState(null)
      const [error, setError] = React.useState(''), [attempt, setAttempt] = React.useState(0)
      React.useEffect(() => {
        let active = true
        setError('')
        Promise.all([api(sessionId, 'get'), api(sessionId, 'quick-start-info')]).then(([snapshot, info]) => {
          if (active) setState({ sessionId, info, lesson: Boolean(snapshot.quickStart) })
        }, reason => { if (active) setError(reason?.message || String(reason)) })
        return () => { active = false }
      }, [sessionId, attempt])
      const info = state?.sessionId === sessionId ? state.info : null
      const scoped = React.useMemo(() => createEditor(React, {
        ...options,
        // The conversation identity stays real. Only the local progress key
        // distinguishes the lesson; HTTP, AI tools and play share its active copy.
        api: (_id, action, body) => api(sessionId, action, body),
        playUrl: () => options.playUrl(sessionId),
        quickStart: info?.enabled ? {
          ...info,
          async open() {
            await api(sessionId, 'quick-start-open')
            setState(previous => previous?.sessionId === sessionId ? { ...previous, lesson: true } : previous)
          },
          async back() {
            await api(sessionId, 'quick-start-back')
            setState(previous => previous?.sessionId === sessionId ? { ...previous, lesson: false } : previous)
          },
        } : null,
      }), [sessionId, info])
      if (!info) return React.createElement('div', { className: 'qxsim' }, error
        ? React.createElement('button', { onClick: () => setAttempt(n => n + 1) }, error + ' · ' + t('重试'))
        : t('正在载入千星沙箱…'))
      const id = sessionId + (state.lesson ? ':quick-start' : '')
      return React.createElement(scoped.SimulatorView, { key: id, sessionId: id })
    }
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
      ctx.slots.inject('conversation.view', () => ctx.slots.register({ name: 'conversation.view', id: 'qxqy-simulator', order: 20, label: () => title() }, SimulatorSession))
    }
    return exports
  },
})
