import React from 'react'
import { createRoot } from 'react-dom/client'
import { createEditor } from '../../../editor-ui/index.js'

const root = createRoot(document.getElementById('app'))
const editor = createEditor(React, {
  async api(sessionId, action, body = {}) {
    const response = await fetch(`/editor/api/${action}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId, ...body }),
    })
    const envelope = await response.json()
    if (!envelope.ok) throw new Error(envelope.error)
    return envelope.value
  },
  playUrl: sessionId => `/editor/play#${sessionId}`,
})
editor.ensureStyle()
window.mountSession = sessionId => root.render(sessionId ? React.createElement(React.StrictMode, null, React.createElement(editor.SimulatorView, { sessionId })) : null)
window.mountSession('lifecycle-a')
