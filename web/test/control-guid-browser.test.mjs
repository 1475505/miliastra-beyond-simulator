import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createStudio } from '../../studio/index.js'
import { createNode } from '../../studio/ui/authoring.js'
import { createWebServer } from '../server.js'
import { startTestBrowser } from './browser-helper.mjs'

test('server index editor resolves a client autofill collision and persists both mappings', { skip: !process.env.QXQY_BROWSER, timeout: 60_000 }, async t => {
  const directory = mkdtempSync(join(tmpdir(), 'qxqy-guid-browser-'))
  const archive = createStudio().archiveData()
  archive.activeAssetType = 'client-control-template'
  archive.assets.server.root.guid = 1073741850 // Existing saves retain the old allocation until explicitly calibrated.
  archive.assets.server.root.children = [createNode('container', { id: 'n1', name: 'Host', guid: 1073742000 })]
  archive.assets.server.selectedId = 'sc1'
  archive.assets.client.root.children = Array.from({ length: 5 }, (_, i) => createNode('keyhint', {
    id: `hint${i}`, name: i === 4 ? 'SpeedKeyHint' : `Hint${i}`, guid: 1073742100 + i,
  }))
  archive.assets.client.selectedId = 'hint4'
  const source = 'local indices = { server = 1073741850, hint = 1073742101 }'
  archive.assets.scripts = [{ guid: 1073742300, path: 'main.lua', source, controlId: 'n1', controlAsset: 'server-control-template' }]
  writeFileSync(join(directory, 'fixture.save.json'), JSON.stringify(archive))
  const app = await createWebServer({ workspace: directory, initialPath: 'fixture.save.json', port: 0 })
  let browser
  t.after(async () => {
    await browser?.close()
    await app.close()
    rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  })
  browser = await startTestBrowser(directory, ['--window-size=1366,900'])
  const { evaluate, wait } = browser
  await browser.navigate(app.url + '/editor')
  await wait(`document.querySelector('.qxsim-row.active .qxsim-row-label')?.textContent === 'SpeedKeyHint'`)
  const sessionId = await evaluate(`document.querySelector('.qxsim').dataset.qxsimSessionId`)
  const call = async (action, body = {}) => {
    const response = await fetch(`${app.url}/editor/api/${action}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId, ...body }),
    })
    const result = await response.json()
    assert.equal(response.status, 200, result.error)
    return result.value
  }
  const form = '[data-quick-start-target="control-guid"]'
  const fillIndex = async value => {
    await evaluate(`(() => {
      const input = document.querySelector('${form} input[type="text"]');
      input.focus(); input.select();
    })()`)
    await browser.send('Input.insertText', { text: String(value) }, browser.sessionId)
  }
  const submit = async () => {
    await wait(`document.querySelector('${form} button[type="submit"]')?.disabled === false`)
    await evaluate(`document.querySelector('${form} button[type="submit"]').click()`)
  }
  const selectAsset = async text => {
    await evaluate(`[...document.querySelectorAll('.qxsim-asset-switch button')].find(button => button.textContent === ${JSON.stringify(text)}).click()`)
    await wait(`document.querySelector('.qxsim-asset-switch .active')?.textContent === ${JSON.stringify(text)}`)
  }

  const before = await call('get')
  await fillIndex(1073741853)
  await evaluate(`document.querySelector('${form} input[type="checkbox"]').click()`)
  await submit()
  await wait(`document.querySelector('${form} [role="alert"]')?.textContent.includes('1073741850')`)
  assert.deepEqual(await call('get'), before, 'failed autofill must preserve the complete snapshot')

  await selectAsset('UI控件-服务端')
  await evaluate(`[...document.querySelectorAll('.qxsim-row')].find(row => row.querySelector('.qxsim-row-label')?.textContent === '客户端控件容器').click()`)
  await wait(`document.querySelector('[aria-label="服务端控件索引"]')?.value === '1073741850'`)
  assert.equal(await evaluate(`document.querySelector('${form} input[type="checkbox"]') === null`), true)
  assert.equal(await evaluate(`document.querySelectorAll('.qxsim-tabs button').length`), 1, 'index editing does not allow server script mounts')
  await fillIndex(1073741900)
  await submit()
  await wait(`document.querySelector('.qxsim-node-id code')?.textContent === '1073741900'`)

  await selectAsset('UI控件-客户端')
  await wait(`document.querySelector('[aria-label="客户端控件索引"]')?.value === '1073742104'`)
  assert.equal(await evaluate(`document.querySelector('${form} input[type="checkbox"]').checked`), false)
  await fillIndex(1073741853)
  await evaluate(`document.querySelector('${form} input[type="checkbox"]').click()`)
  await submit()
  await wait(`document.querySelector('.qxsim-node-id code')?.textContent === '1073741853'`)
  const calibrated = await call('get')
  assert.deepEqual(calibrated.tree.map(row => row.guid), [1073741849, 1073741850, 1073741851, 1073741852, 1073741853])
  assert.equal(calibrated.controlGuidChanges.length, 6)
  assert.deepEqual(calibrated.controlGuidChanges.map(row => [row.oldGuid, row.newGuid]), [
    [1073741850, 1073741900], [1073742100, 1073741849], [1073742101, 1073741850],
    [1073742102, 1073741851], [1073742103, 1073741852], [1073742104, 1073741853],
  ])
  assert.equal(calibrated.scripts[0].source, source, 'changing indices records pending Lua work')

  await evaluate(`document.querySelector('[data-quick-start-target="save"]').click()`)
  await wait(`document.querySelector('[aria-label="保存到工作区"]') !== null`)
  await evaluate(`document.querySelector('[aria-label="保存到工作区"] button[type="submit"]').click()`)
  await wait(`document.querySelector('[aria-label="保存到工作区"]') === null`)
  const saved = JSON.parse(readFileSync(join(directory, 'fixture.save.json'), 'utf8'))
  assert.equal(saved.assets.server.root.guid, 1073741900)
  assert.deepEqual(saved.assets.client.root.children.map(node => node.guid), [1073741849, 1073741850, 1073741851, 1073741852, 1073741853])
  assert.deepEqual(saved.controlGuidChanges, calibrated.controlGuidChanges)

  await selectAsset('UI控件-服务端')
  await evaluate(`(() => { const select = document.querySelector('.qxsim-language'); select.value = 'en'; select.dispatchEvent(new Event('change', { bubbles: true })); })()`)
  await wait(`document.querySelector('[aria-label="Server Control Index"]')?.value === '1073741900'`)
})
