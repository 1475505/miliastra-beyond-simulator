import { localizePage, subscribeLocale, loadSystemLanguage } from '../../studio/i18n.js'
import React from 'react'
import { createRoot } from 'react-dom/client'
import { createEditor } from 'qxqy-editor-ui'
import manifest from '../package.json' with { type: 'json' }

await loadSystemLanguage('/editor/api/locale')
localizePage()
subscribeLocale(() => localizePage())

const key = 'qxqy-editor-session'
let sessionId = sessionStorage.getItem(key)
if (!sessionId) {
  sessionId = Array.from(crypto.getRandomValues(new Uint8Array(16)), value => value.toString(16).padStart(2, '0')).join('')
  sessionStorage.setItem(key, sessionId)
}
const editor = createEditor(React, {
  version: manifest.version,
  async api(sessionId, action, body = {}) {
    const response = await fetch(`/editor/api/${action}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId, ...body }),
      ...(action === 'play' ? { signal: AbortSignal.timeout(15_000) } : {}),
    })
    const envelope = await response.json()
    if (!response.ok || !envelope.ok) throw new Error(envelope.error || '请求失败')
    return envelope.value
  },
  playUrl: id => `/editor/play#${encodeURIComponent(id)}`,
  saveToWorkspace: true,
})
editor.ensureStyle()
createRoot(document.getElementById('editor')).render(React.createElement(editor.SimulatorView, { sessionId }))
