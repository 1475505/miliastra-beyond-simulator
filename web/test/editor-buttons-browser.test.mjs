import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { createStudio } from '../../studio/index.js'
import { createWebServer } from '../server.js'
import { startTestBrowser } from './browser-helper.mjs'

function contrast(foreground, background) {
  const luminance = color => {
    const rgb = color.match(/[\d.]+/g).slice(0, 3).map(Number).map(value => {
      const channel = value / 255
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
    })
    return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722
  }
  const a = luminance(foreground), b = luminance(background)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

test('editor and guide buttons stay readable across themes, interaction states and slow downloads', { skip: !process.env.QXQY_BROWSER, timeout: 60_000 }, async t => {
  const directory = mkdtempSync(join(tmpdir(), 'qxqy-button-states-'))
  const archive = createStudio().archiveData()
  let release, downloads = 0
  const gate = new Promise(resolve => { release = resolve })
  const source = createServer(async (_req, res) => { downloads++; await gate; res.end(JSON.stringify(archive)) })
  await new Promise(resolve => source.listen(0, '127.0.0.1', resolve))
  const app = await createWebServer({ workspace: directory, port: 0, quickStartUrl: `http://127.0.0.1:${source.address().port}/example.save.json` })
  let browser
  t.after(async () => {
    release()
    await browser?.close(); await app.close(); await new Promise(resolve => source.close(resolve))
    rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  })
  browser = await startTestBrowser(directory, ['--window-size=1366,900'])
  const { evaluate, wait, sessionId } = browser
  await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }, sessionId)
  await browser.send('DOM.enable', {}, sessionId)
  await browser.send('CSS.enable', {}, sessionId)
  await browser.navigate(`${app.url}/editor?quickStart=1`)
  await wait(`document.querySelector('.qxsim-quick-welcome')?.open`)
  const primary = '.qxsim-quick-welcome .primary'
  const state = async (selector, pseudo = []) => {
    const { root } = await browser.send('DOM.getDocument', {}, sessionId)
    const { nodeId } = await browser.send('DOM.querySelector', { nodeId: root.nodeId, selector }, sessionId)
    assert(nodeId, selector)
    await browser.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: pseudo }, sessionId)
    return evaluate(`(() => {
      const button = document.querySelector(${JSON.stringify(selector)}), style = getComputedStyle(button), spinner = getComputedStyle(button, '::before'), rect = button.getBoundingClientRect()
      return { color: style.color, background: style.backgroundColor, opacity: style.opacity, cursor: style.cursor, outline: style.outlineStyle, outlineWidth: style.outlineWidth, disabled: button.disabled, busy: button.getAttribute('aria-busy'), spinner: spinner.content, animation: spinner.animationName, width: rect.width, height: rect.height, overflow: button.scrollWidth > button.clientWidth }
    })()`)
  }
  const themes = async task => {
    for (const theme of ['light', 'dark']) {
      await evaluate(`document.documentElement.dataset.theme = ${JSON.stringify(theme)}`)
      await wait(`document.querySelector('.qxsim').dataset.theme === ${JSON.stringify(theme)}`)
      await task(theme)
    }
  }
  const readablePrimary = async (selector, theme) => {
    const normal = await state(selector)
    assert(contrast(normal.color, normal.background) >= 4.5, `${theme} default primary has accessible contrast`)
    const hover = await state(selector, ['hover'])
    assert(contrast(hover.color, hover.background) >= 4.5, `${theme} hover must not turn into white on pale gray`)
    assert.notEqual(hover.background, normal.background, 'hover has visible feedback')
    const pressed = await state(selector, ['hover', 'active'])
    assert(contrast(pressed.color, pressed.background) >= 4.5, `${theme} pressed contrast`)
    assert.notEqual(pressed.background, hover.background, 'press has distinct feedback')
    const focused = await state(selector, ['focus-visible'])
    assert.equal(focused.outline, 'solid')
    assert.equal(focused.outlineWidth, '2px')
    assert.equal(normal.overflow, false, 'button labels wrap without horizontal clipping')
    await state(selector)
  }
  await themes(async theme => {
    await readablePrimary(primary, theme)
    const secondary = '.qxsim-quick-welcome .qxsim-action:not(.primary)'
    const normal = await state(secondary), hover = await state(secondary, ['hover'])
    assert(contrast(hover.color, hover.background) >= 4.5)
    assert.notEqual(normal.background, hover.background)
    await state(secondary)
    assert((await state(primary)).height >= 40, 'welcome main action is easy to hit')
  })
  await evaluate(`document.querySelector(${JSON.stringify(primary)}).click()`)
  await wait(`document.querySelector(${JSON.stringify(primary)})?.getAttribute('aria-busy') === 'true'`)
  await themes(async () => {
    const loading = await state(primary, ['hover', 'active'])
    assert.equal(loading.disabled, true)
    assert.equal(loading.cursor, 'wait')
    assert.equal(loading.opacity, '1', 'loading does not fade the label out')
    assert.notEqual(loading.spinner, 'none')
    assert.equal(loading.animation, 'none', 'reduced-motion users still get a static loading indicator')
    assert(contrast(loading.color, loading.background) >= 4.5)
    const disabled = '.qxsim-quick-welcome .qxsim-action:not(.primary)'
    assert.equal((await state(disabled)).background, (await state(disabled, ['hover', 'active'])).background, 'disabled buttons do not react to hover or press')
    await state(disabled)
  })
  await evaluate(`document.querySelector(${JSON.stringify(primary)}).click()`)
  assert.equal(downloads, 1, 'busy action cannot trigger a duplicate download')
  release()
  await wait(`document.querySelector('[data-quick-step]')?.dataset.quickStep === 'debug'`)
  await themes(async theme => {
    await readablePrimary('[data-quick-next]', theme)
    await readablePrimary('[data-quick-start-target="play"]', theme)
    const previous = await state('.qxsim-quick-previous')
    assert.equal(previous.disabled, true)
    assert.equal(previous.opacity, '1')
    assert(contrast(previous.color, previous.background) >= 3, 'disabled label remains legible')
    assert.equal((await state('.qxsim-quick-previous', ['hover', 'active'])).background, previous.background)
    await state('.qxsim-quick-previous')
    assert((await state('[data-quick-next]')).height >= 38)
  })
  await evaluate(`(() => {const select = document.querySelector('[aria-label="导览阶段"]'); select.value = '4'; select.dispatchEvent(new Event('change', {bubbles:true}))})()`)
  await wait(`document.querySelector('[data-quick-step]')?.dataset.quickStep === 'sync'`)
  await themes(theme => readablePrimary('[data-quick-next]', theme))
  const before = await evaluate(`document.querySelector('[data-quick-step]').dataset.quickStep`)
  await browser.key('Tab', 'Tab')
  await evaluate(`document.querySelector('[data-quick-next]').focus()`)
  assert.equal((await state('[data-quick-next]')).outlineWidth, '2px', 'keyboard users get a visible focus indicator')
  assert.equal(await evaluate(`document.activeElement === document.querySelector('[data-quick-next]')`), true)
  await browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' }, sessionId)
  await browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }, sessionId)
  await wait(`document.querySelector('[data-quick-step]')?.dataset.quickStep === 'copy'`)
  assert.equal(before, 'sync', 'keyboard activation advances exactly one step')
})
