// Run through the actual host registry, not just the plugin's controller.
// Copied beside an installed package so each matrix entry uses its own DSH API.
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { ToolRuntime } from '@deepseek-ai/dsh-tools'
import * as plugin from 'dsh-plugin-beyond-simulator'

export async function smokeDshTools(workspace) {
  const ctx = new Context()
  ctx.provide('systemPrompt', { tools() {} })
  const routes = new Map()
  ctx.provide('webServer', {
    register(route) {
      const key = `${route.kind} ${route.path}`
      if (routes.has(key)) throw new Error(`duplicate route: ${key}`)
      routes.set(key, route)
      return () => { routes.delete(key) }
    },
  })
  ctx.provide('attachments', {
    async saveImage({ data, mediaType, name }) {
      assert.equal(data.subarray(1, 4).toString(), 'PNG')
      return { attachmentId: 'smoke-image', mediaType, name, bytes: data.length, width: 1600, height: 900 }
    },
  })
  const tools = new ToolRuntime(ctx)
  const batchApi = typeof tools.setExecutor === 'function'
  if (batchApi) {
    const { NativeToolExecutor } = await import('@deepseek-ai/dsh-tool-executor-native')
    tools.setExecutor(new NativeToolExecutor(ctx))
  }
  const owner = ctx.plugin(plugin)
  await owner
  const registeredRouteCount = routes.size
  assert.ok(registeredRouteCount > 0, 'The plugin must register its HTTP routes')
  const agent = { id: 'package-smoke', session: { header: { cwd: workspace } } }
  let callId = 0
  const execute = async (name, args, caller, timeoutMs = 15_000) => {
    const id = `smoke-${++callId}`
    const signal = AbortSignal.timeout(timeoutMs)
    return batchApi
      ? (await tools.execute({ calls: [{ type: 'tool-call', id, name, arguments: JSON.stringify(args) }], agent: caller, signal })).results[0].result
      : tools.execute({ callId: id, name, arguments: args, agent: caller, signal })
  }
  const call = async (name, args = {}, caller = agent) => {
    const result = await execute(name, args, caller)
    assert.equal(result.isError, false, JSON.stringify(result))
    return result
  }
  try {
    assert.equal(tools.schemas().filter(tool => tool.name.startsWith('qxqy_')).length, 8)
    const before = (await call('qxqy_studio_get')).value
    assert.equal(before.workspace.path, workspace)
    await call('qxqy_studio_patch', { op: { op: 'renameSave', name: 'Tool pipeline', expectedRevision: before.version } })
    assert.equal((await call('qxqy_studio_get')).value.save.name, 'Tool pipeline')
    assert.equal((await call('qxqy_studio_get', {}, { ...agent, id: 'other-session' })).value.save.name, '未命名存档')
    await call('qxqy_studio_patch', { op: { op: 'set', id: 'n2', key: 'text', value: 'Tool pipeline', expectedRevision: before.version } })
    // Preserve the legacy string-json input form too.
    await call('qxqy_studio_patch', { op: JSON.stringify({ op: 'renameSave', name: 'String input' }) })
    await call('qxqy_script_sync', { action: 'status' })
    const choices = (await call('qxqy_studio_export', { action: 'list' })).value
    const exportArgs = { controlIds: [choices.rows[0].id], expectedRevision: choices.revision }
    assert.equal((await call('qxqy_studio_export', { action: 'preview', args: exportArgs })).value.selection.templateCount, 1)
    assert.ok((await call('qxqy_studio_export', { action: 'export', args: exportArgs })).value.data)
    assert.ok((await call('qxqy_studio_load')).value.archives.length > 0)
    assert.ok((await call('qxqy_studio_ui_screenshot')).content.some(block => block.type === 'image'))
    assert.equal((await call('qxqy_studio_play', { action: 'start' })).value.running, true)
    await call('qxqy_studio_play', { action: 'step', args: { dt: 1 / 30 } })
    assert.ok((await call('qxqy_studio_play_screenshot')).content.some(block => block.type === 'image'))
    await call('qxqy_studio_play', { action: 'stop' })
    const stale = await execute('qxqy_studio_patch', {
      op: { op: 'set', id: 'n2', key: 'text', value: 'stale', expectedRevision: before.version },
    }, agent, 5_000)
    assert.equal(stale.isError, true)
    assert.match(JSON.stringify(stale), /revision conflict/)
    for (let cycle = 0; cycle < 2; cycle++) {
      await owner.restart()
      assert.equal(routes.size, registeredRouteCount)
      assert.equal(tools.schemas().filter(tool => tool.name.startsWith('qxqy_')).length, 8)
      assert.equal((await call('qxqy_studio_get')).value.save.name, '未命名存档')
    }
  } finally {
    await owner.dispose()
  }
  assert.equal(routes.size, 0)
  assert.equal(tools.schemas().filter(tool => tool.name.startsWith('qxqy_')).length, 0)
  console.log('PASS installed DSH tool pipeline: registration, session isolation, JSON args, revisions, Worker, image content and restart cleanup')
}
