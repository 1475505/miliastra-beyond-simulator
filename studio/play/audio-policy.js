// Host policy for who hears Lua 2D audio. It never changes Lua playback state.

export function agentControlledBrowser({ webdriver = false, userAgent = '', search = '' } = {}) {
  const query = String(search || '')
  const params = new URLSearchParams(query.startsWith('?') ? query.slice(1) : query)
  if (params.get('audio') === '0') return true
  return webdriver === true || /\bOpenCode\//.test(userAgent) || /HeadlessChrome/i.test(userAgent)
}

export function browserAudioMutedByDefault(env = globalThis) {
  const nav = env.navigator
  if (!nav) return false
  let search = ''
  try { search = env.location?.search || '' } catch { /* about:blank or a sealed location */ }
  return agentControlledBrowser({
    webdriver: nav.webdriver === true,
    userAgent: nav.userAgent || '',
    search,
  })
}

// MCP/DSH tool starts are agent playtests. Browser pages omit this unless they
// are themselves an agent-controlled browser.
export function agentPlayArgs(action, args = {}) {
  if (action !== 'start' && action !== 'device') return args
  if (args.muteAudio != null) return args
  return { ...args, muteAudio: true }
}
