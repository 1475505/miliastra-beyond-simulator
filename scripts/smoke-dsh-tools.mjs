// Run through the actual host registry, not just the plugin's controller.
// Copied beside an installed package so each matrix entry uses its own DSH API.
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { ToolRuntime } from '@deepseek-ai/dsh-tools'
import * as plugin from 'dsh-plugin-beyond-simulator'

export async function smokeDshTools(workspace) {
  const ctx = new Context()
  ctx.provide('systemPrompt', { tools() {} })
  ctx.provide('webServer', { register() {} })
  ctx.provide('attachments', {
    async saveImage({ data, mediaType, name }) {
      assert.equal(data.subarray(1, 4).toString(), 'PNG')
      return { attachmentId: 'smoke-image', mediaType, name, bytes: data.length, width: 1600, height: 900 }
    },
  })
  const tools = new ToolRuntime(ctx)
  const owner = ctx.plugin(plugin)
  await owner
  const agent = { id: 'package-smoke', session: { header: { cwd: workspace } } }
  let callId = 0
  const call = async (name, args = {}, caller = agent) => {
    const result = await tools.execute({
      callId: `smoke-${++callId}`, name, arguments: args, agent: caller,
      signal: AbortSignal.timeout(15_000),
    })
    assert.equal(result.isError, false, JSON.stringify(result))
    return result
  }
  try {
    assert.equal(tools.schemas().filter(tool => tool.name.startsWith('qxqy_')).length, 7)
    const before = (await call('qxqy_studio_get')).value
    assert.equal(before.workspace.path, workspace)
    await call('qxqy_studio_patch', { op: { op: 'renameSave', name: 'Tool pipeline', expectedRevision: before.version } })
    assert.equal((await call('qxqy_studio_get')).value.save.name, 'Tool pipeline')
    assert.equal((await call('qxqy_studio_get', {}, { ...agent, id: 'other-session' })).value.save.name, '未命名存档')
    await call('qxqy_studio_patch', { op: { op: 'set', id: 'n2', key: 'text', value: 'Tool pipeline', expectedRevision: before.version } })
    // Preserve the legacy string-json input form too.
    await call('qxqy_studio_patch', { op: JSON.stringify({ op: 'renameSave', name: 'String input' }) })
    await call('qxqy_script_sync', { action: 'status' })
    assert.ok((await call('qxqy_studio_load')).value.archives.length > 0)
    assert.ok((await call('qxqy_studio_ui_screenshot')).content.some(block => block.type === 'image'))
    assert.equal((await call('qxqy_studio_play', { action: 'start' })).value.running, true)
    await call('qxqy_studio_play', { action: 'step', args: { dt: 1 / 30 } })
    assert.ok((await call('qxqy_studio_play_screenshot')).content.some(block => block.type === 'image'))
    await call('qxqy_studio_play', { action: 'stop' })
    const stale = await tools.execute({
      callId: `smoke-${++callId}`, name: 'qxqy_studio_patch', agent,
      arguments: { op: { op: 'set', id: 'n2', key: 'text', value: 'stale', expectedRevision: before.version } },
      signal: AbortSignal.timeout(5_000),
    })
    assert.equal(stale.isError, true)
    assert.match(JSON.stringify(stale), /revision conflict/)
  } finally {
    await owner.dispose()
  }
  console.log('PASS installed DSH tool pipeline: registration, session isolation, JSON args, revisions, Worker and image content')
}
