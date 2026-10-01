// Minimal Harness ModuleLoader/slot carrier; the actual plugin bundle owns UI.
import React from 'react'
import { createRoot } from 'react-dom/client'

const root = createRoot(document.getElementById('app'))
window.__ModuleLoader__ = { load(module) {
  const plugin = module.factory(name => {
    if (name !== 'react') throw new Error(`Unexpected client dependency: ${name}`)
    return React
  })
  plugin.apply({
    effect() {},
    slots: {
      inject(_name, register) { register() },
      register(_definition, View) {
        window.mountSession = sessionId => root.render(sessionId ? React.createElement(View, { sessionId }) : null)
        window.mountSession('desktop-play')
      },
    },
  })
} }
const script = document.createElement('script')
script.src = '/plugin.js'
document.head.appendChild(script)
