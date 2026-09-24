import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createWebServer } from '../server.js'
import { createStudio } from '../../studio/index.js'
import { createNode } from '../../studio/ui/authoring.js'

test('Web export/import retains cursor flags through Lua startup and pointer delivery', async t => {
  const workspace = mkdtempSync(join(tmpdir(), 'qxqy-gia-input-'))
  const app = await createWebServer({ workspace, port: 0 })
  t.after(async () => { await app.close(); rmSync(workspace, { recursive: true, force: true }) })
  const call = async (sessionId, action, body = {}) => {
    const response = await fetch(`${app.url}/editor/api/${action}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId, ...body }),
    })
    const result = await response.json()
    assert.equal(response.status, 200, JSON.stringify(result))
    assert.equal(result.ok, true, JSON.stringify(result))
    return result.value
  }
  for (const [name, showCursor, raycastTarget, active, expected] of [
    ['enabled', true, true, true, true],
    ['no-cursor', false, true, true, false],
    ['no-raycast', true, false, true, false],
    ['inactive', true, true, false, false],
  ]) {
    const archive = createStudio().archiveData()
    const stage = archive.assets.server.root.children[0]
    stage.showCursor = showCursor
    stage.children = [createNode('cursor', { id: 'hit', name: 'Hit', raycastTarget, active })]
    archive.assets.scripts = [{
      id: '1073742110', guid: 1073742110, path: 'input.lua',
      controlId: stage.id, controlAsset: 'server-control-template',
      source: `function OnStart()
  print("input-ready")
  script.object:FindChild("Hit"):AddCursorEventListener(Enum.CursorEventType.CursorClick, function()
    print("input-clicked")
  end)
end`,
    }]
    await call('source', 'import', { format: 'json', filename: 'input.save.json', data: Buffer.from(JSON.stringify(archive)).toString('base64') })
    const exported = await call('source', 'export', { format: 'combined' })
    await call('target', 'import', { format: 'gia', filename: exported.filename, data: exported.data })
    await call('target', 'play', { action: 'start' })
    // Use the same coordinate pointer API as the browser, not SimulateCursorClick.
    await call('target', 'play', { action: 'pointer', args: { type: 'down', x: 800, y: 450 } })
    await call('target', 'play', { action: 'pointer', args: { type: 'up', x: 800, y: 450 } })
    const result = await call('target', 'play', { action: 'get', args: { logs: true } })
    const logs = JSON.stringify(result)
    assert.match(logs, /input-ready/, name)
    assert.equal(logs.includes('input-clicked'), expected, name)
    await call('target', 'play', { action: 'stop' })
  }
})
