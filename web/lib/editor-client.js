import React from 'react'
import { createRoot } from 'react-dom/client'
import { createEditor } from 'qxqy-editor-ui'

const key = 'qxqy-editor-session'
let sessionId = sessionStorage.getItem(key)
if (!sessionId) {
  sessionId = Array.from(crypto.getRandomValues(new Uint8Array(16)), value => value.toString(16).padStart(2, '0')).join('')
  sessionStorage.setItem(key, sessionId)
}
const editor = createEditor(React, {
  async api(sessionId, action, body = {}) {
    const response = await fetch(`/editor/api/${action}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId, ...body }),
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
