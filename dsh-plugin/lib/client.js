import { createEditor } from 'qxqy-editor-ui'

window.__ModuleLoader__.load({
  id: 'dsh-plugin-beyond-simulator',
  factory: (require, module, exports) => {
    const React = require('react')
    const editor = createEditor(React, {
      async api(sessionId, action, body) {
        const response = await fetch('/qxqy-simulator/api/' + action, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId, ...(body || {}) }) })
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
      ctx.slots.inject('conversation.view', () => ctx.slots.register({ name: 'conversation.view', id: 'qxqy-simulator', order: 20, label: () => '模拟器' }, editor.SimulatorView))
    }
    return module.exports
  },
})
