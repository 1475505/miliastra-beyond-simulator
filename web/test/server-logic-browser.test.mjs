import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createWebServer } from '../server.js'
import { createStudio } from '../../studio/index.js'
import { startTestBrowser } from './browser-helper.mjs'

test('entity creation rules can be edited, saved and reloaded alongside legacy signal rules', { skip: !process.env.QXQY_BROWSER, timeout: 60_000 }, async t => {
  const temp = mkdtempSync(join(tmpdir(), 'qxqy-server-logic-'))
  const studio = createStudio()
  const signalRule = { id: 'earn', signalName: 'Earn', actions: [
    { kind: 'setCustomVariable', entityType: 'PlayerSelf', name: 'Reward', value: { fromSignalParam: 0 } },
  ] }
  studio.patch({ op: 'setServerLogic', logic: { rules: [signalRule] } })
  writeFileSync(join(temp, 'game.save.json'), JSON.stringify(studio.archiveData()))
  const app = await createWebServer({ workspace: temp, initialPath: 'game.save.json', port: 0 })
  let browser
  t.after(async () => {
    await browser?.close()
    await app.close()
    rmSync(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  })
  browser = await startTestBrowser(temp)
  const { evaluate, wait } = browser
  const click = text => evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find(row => row.textContent === ${JSON.stringify(text)});
    if (!button || button.disabled) throw new Error('Missing button ' + ${JSON.stringify(text)});
    button.click();
  })()`)
  const set = (selector, value, type = 'HTMLSelectElement') => evaluate(`(() => {
    const input = document.querySelector(${JSON.stringify(selector)});
    Object.getOwnPropertyDescriptor(${type}.prototype, 'value').set.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event(${type === 'HTMLSelectElement' ? "'change'" : "'input'"}, { bubbles: true }));
  })()`)
  await browser.navigate(`${app.url}/editor`)
  await wait(`!!document.querySelector('.qxsim-editor-nav')`)
  await click('服务端逻辑')
  await wait(`document.querySelectorAll('.qxsim-logic-rule').length === 1`)
  await click('＋ 实体创建时')
  await wait(`document.querySelectorAll('.qxsim-logic-rule').length === 2`)
  const created = '.qxsim-logic-rule:nth-of-type(2)'
  assert.equal(await evaluate(`document.querySelector('[aria-label="规则 2 触发事件"]').value`), 'entityCreated')
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(created)}).textContent.includes('引用监听信号参数')`), false)
  assert.equal(await evaluate(`!!document.querySelector('[aria-label="规则 2 监听信号名"]')`), false)
  await set(`${created} input[placeholder="Gold"]`, 'Gold', 'HTMLInputElement')
  await set(`${created} textarea`, '15', 'HTMLTextAreaElement')
  // Literal fields commit on blur, just as a real click on Save does.
  await evaluate(`document.querySelector(${JSON.stringify(`${created} textarea`)}).focus(); document.querySelector(${JSON.stringify(`${created} textarea`)}).blur()`)
  await click('保存服务端逻辑')
  await wait(`document.querySelector('.qxsim-logic-title button').disabled`)
  const sessionId = await evaluate(`document.querySelector('.qxsim').dataset.qxsimSessionId`)
  const getLogic = () => evaluate(`fetch('/editor/api/get', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({ sessionId:${JSON.stringify(sessionId)} }) }).then(r => r.json()).then(r => { if (!r.ok) throw new Error(JSON.stringify(r)); return r.value.serverLogic })`)
  const play = action => evaluate(`fetch('/editor/api/play', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({ sessionId:${JSON.stringify(sessionId)}, action:${JSON.stringify(action)}, args:{clockMode:'manual'} }) }).then(r => r.json()).then(r => { if (!r.ok) throw new Error(JSON.stringify(r)); return r.value })`)
  let saved = await getLogic()
  assert.deepEqual(saved.rules[0], signalRule)
  assert.deepEqual(saved.rules[1], {
    id: saved.rules[1].id, event: 'entityCreated', entityType: 'PlayerSelf',
    actions: [{ kind: 'setCustomVariable', entityType: 'PlayerSelf', name: 'Gold', value: 15 }],
  })

  // A page reload reconstructs the draft from the saved server snapshot.
  await browser.navigate(`${app.url}/editor`)
  await wait(`!!document.querySelector('.qxsim-editor-nav')`)
  await click('服务端逻辑')
  await wait(`document.querySelector('[aria-label="规则 2 创建实体"]').value === 'PlayerSelf'`)
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(`${created} textarea`)}).value`), '15')
  await set('[aria-label="规则 2 创建实体"]', 'Level')
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(`${created} .qxsim-logic-fields select`)}).value`), 'Level')
  await click('保存服务端逻辑')
  await wait(`document.querySelector('.qxsim-logic-title button').disabled`)
  saved = await getLogic()
  assert.equal(saved.rules[1].entityType, 'Level')
  assert.equal(saved.rules[1].actions[0].entityType, 'Level')

  // A global "unmount" retains every rule; editing a rule must not turn the
  // global switch back on, nor lose an individual rule's disabled state.
  await evaluate(`document.querySelector('[aria-label="使用服务端逻辑"]').click()`)
  await evaluate(`document.querySelector('[aria-label="启用规则 2"]').click()`)
  await set('[aria-label="规则 1 监听信号名"]', 'EarnEdited', 'HTMLInputElement')
  await click('保存服务端逻辑')
  await wait(`document.querySelector('.qxsim-logic-title button').disabled`)
  saved = await getLogic()
  assert.equal(saved.enabled, false)
  assert.equal(saved.rules[1].enabled, false)
  assert.equal(saved.rules[1].actions[0].value, 15)
  assert.deepEqual((await play('start')).server.vars.Level, {})
  await play('stop')
  await browser.navigate(`${app.url}/editor`)
  await wait(`!!document.querySelector('.qxsim-editor-nav')`)
  await click('服务端逻辑')
  await wait(`document.querySelectorAll('.qxsim-logic-rule').length === 2`)
  assert.equal(await evaluate(`document.querySelector('[aria-label="使用服务端逻辑"]').checked`), false)
  assert.equal(await evaluate(`document.querySelector('[aria-label="启用规则 2"]').checked`), false)
  assert.equal(await evaluate(`document.querySelector('[aria-label="启用规则 1"]').checked`), true)
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(`${created} textarea`)}).value`), '15')
  await evaluate(`document.querySelector('[aria-label="使用服务端逻辑"]').click()`)
  await click('保存服务端逻辑')
  await wait(`document.querySelector('.qxsim-logic-title button').disabled`)
  saved = await getLogic()
  assert.notEqual(saved.enabled, false)
  assert.equal(saved.rules[1].enabled, false, 'global enable does not enable individual rules')

  // Converting a signal rule removes unavailable parameter references rather
  // than leaving an initialization rule that fails only during play.
  await set('[aria-label="规则 1 触发事件"]', 'entityCreated')
  assert.equal(await evaluate(`document.querySelector('.qxsim-logic-rule textarea').value`), '0')
  await click('保存服务端逻辑')
  await wait(`document.querySelector('.qxsim-logic-title button').disabled`)
  saved = await getLogic()
  assert.equal(saved.rules[0].event, 'entityCreated')
  assert.equal(saved.rules[0].actions[0].value, 0)
  const withDisabledRule = await play('start')
  assert.deepEqual(withDisabledRule.server.vars.Level, {})
  assert.equal(withDisabledRule.server.vars.Player1.Reward.value, 0)
  await play('stop')
  await evaluate(`document.querySelector('[aria-label="启用规则 2"]').click()`)
  await click('保存服务端逻辑')
  await wait(`document.querySelector('.qxsim-logic-title button').disabled`)
  assert.equal((await play('start')).server.vars.Level.Gold.value, 15)
  await play('stop')
})
