import test from 'node:test'
import assert from 'node:assert/strict'
import { agentControlledBrowser, agentPlayArgs, browserAudioMutedByDefault } from '../play/audio-policy.js'

test('agent browsers and explicit audio=0 start muted; a normal browser does not', () => {
  assert.equal(agentControlledBrowser({ userAgent: 'Mozilla/5.0 OpenCode/2.1.4 Chrome/152.0 Electron/44.9.1' }), true)
  assert.equal(agentControlledBrowser({ webdriver: true, userAgent: 'Mozilla/5.0 Chrome/155.0 Edg/155.0' }), true)
  assert.equal(agentControlledBrowser({ userAgent: 'Mozilla/5.0 HeadlessChrome/120.0' }), true)
  assert.equal(agentControlledBrowser({ search: '?embedded=1&audio=0' }), true)
  assert.equal(agentControlledBrowser({ userAgent: 'Mozilla/5.0 Chrome/155.0 Edg/155.0', search: '' }), false)
  assert.equal(browserAudioMutedByDefault({}), false)
  assert.equal(browserAudioMutedByDefault({
    navigator: { webdriver: false, userAgent: 'Mozilla/5.0 Chrome/155.0' },
    location: { search: '' },
  }), false)
})

test('only agent tool start/device default to muted audio, and an explicit choice wins', () => {
  assert.equal(agentPlayArgs('start').muteAudio, true)
  assert.equal(agentPlayArgs('device', { canvasId: 'pc-16-9' }).canvasId, 'pc-16-9')
  assert.equal(agentPlayArgs('device', { canvasId: 'pc-16-9' }).muteAudio, true)
  assert.equal(agentPlayArgs('start', { muteAudio: false }).muteAudio, false)
  assert.equal(agentPlayArgs('pointer', { type: 'click' }).muteAudio, undefined)
})
