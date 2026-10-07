// Test-only plugin copied into the disposable Harness profile by smoke-harness.
// HTTP is queried only after startup settles, so preset audits cannot deadlock boot.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { evaluatePluginCompatibility } from '@deepseek-ai/dsh-app-boot'
import * as simulator from 'dsh-plugin-beyond-simulator'

export const inject = ['webServer', 'tools', 'agentPresets', 'skills', 'sessions']
export function apply(ctx, config) {
  ctx.webServer.register({ kind: 'exact', path: '/qxqy-smoke', async handler(_request, response) {
    response.setHeader('content-type', 'application/json')
    const sessionId = 'harness-smoke'
    const session = ctx.sessions.get(sessionId) || ctx.sessions.create(sessionId, { meta: { cwd: config.workspace } })
    const agent = { id: sessionId, session }
    let callId = 0
    const call = async (name, args = {}) => {
      const result = await ctx.tools.execute({ callId: `smoke-${++callId}`, name, arguments: args, agent, signal: AbortSignal.timeout(10_000) })
      assert.equal(result.isError, false, JSON.stringify(result))
      return result
    }
    try {
      const require = createRequire(import.meta.url)
      const manifest = JSON.parse(await readFile(require.resolve('dsh-plugin-beyond-simulator/package.json'), 'utf8'))
      for (const version of ['0.1.0-rc.6', '0.1.7-rc.2', '0.2.0-rc.1', '0.2.0-rc.2']) {
        assert.equal(evaluatePluginCompatibility(manifest, {}, version), undefined, version)
      }
      assert.ok(evaluatePluginCompatibility(manifest, {}, '0.3.0-rc.1'), 'Do not silently admit a future minor API')
      const preset = await ctx.agentPresets.resolve('wonderland-lua-builder')
      assert.equal(preset.broken, undefined, JSON.stringify(preset))
      const lease = await ctx.agentPresets.acquireScope(preset.id)
      try {
        const skill = await ctx.skills.get('qxqy-game-studio', { scope: lease.key, cwd: config.workspace })
        assert.ok(skill, 'The embedded preset must discover its bundled game-studio Skill')
        assert.match(skill.content, /PREFLIGHT/)
        assert.equal(skill.resourceBase.kind, 'directory')
        assert.match(await readFile(join(skill.resourceBase.path, 'references/workflow.md'), 'utf8'), /PREFLIGHT/)
      } finally { await lease[Symbol.asyncDispose]() }
      assert.ok(await ctx.skills.get('qxqy-simulator'))
      assert.equal(ctx.tools.schemas().filter(tool => tool.name.startsWith('qxqy_')).length, 7)
      const before = (await call('qxqy_studio_get')).value
      assert.equal(before.workspace.path, config.workspace)
      await call('qxqy_studio_patch', { op: { op: 'set', id: 'n2', key: 'text', value: 'Harness 0.2', expectedRevision: before.version } })
      assert.ok((await call('qxqy_studio_ui_screenshot')).content.some(block => block.type === 'image'))
      assert.equal((await call('qxqy_studio_play', { action: 'start' })).value.running, true)
      assert.ok((await call('qxqy_studio_play_screenshot')).content.some(block => block.type === 'image'))
      await call('qxqy_studio_play', { action: 'stop' })
      const url = `http://127.0.0.1:${ctx.webServer.port}`
      for (const path of ['/qxqy-simulator/play', '/qxqy-simulator/play-renderer.js']) {
        assert.equal((await fetch(url + path, { signal: AbortSignal.timeout(5_000) })).status, 200, path)
      }
      const snapshot = await (await fetch(`${url}/qxqy-simulator/api/get`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId }), signal: AbortSignal.timeout(5_000),
      })).json()
      assert.equal(snapshot.ok, true)
      assert.equal(snapshot.value.workspace.path, config.workspace)
      const runtime = ctx.registry.get(simulator)
      assert.ok(runtime, 'The installed simulator must be loaded by Harness')
      const owners = [...runtime.fibers]
      assert.equal(owners.length, 1, 'Lifecycle regression uses exactly one plugin instance')
      for (let cycle = 0; cycle < 2; cycle++) {
        // A live Worker and all routes must be disposed before this activation
        // is replaced. Previously the very first restart hit duplicate prefix.
        await call('qxqy_studio_play', { action: 'start' })
        await owners[0].restart()
        assert.equal(ctx.tools.schemas().filter(tool => tool.name.startsWith('qxqy_')).length, 7)
        const beforeRestartEdit = (await call('qxqy_studio_get')).value
        await call('qxqy_studio_patch', { op: { op: 'renameSave', name: `restart-${cycle}`, expectedRevision: beforeRestartEdit.version } })
        const reloaded = await (await fetch(`${url}/qxqy-simulator/api/get`, {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId }), signal: AbortSignal.timeout(5_000),
        })).json()
        assert.equal(reloaded.ok, true, JSON.stringify(reloaded))
        assert.equal(reloaded.value.save.name, `restart-${cycle}`, 'HTTP and tools must share the new registry')
        for (const path of ['/qxqy-simulator/play', '/qxqy-simulator/play-renderer.js']) {
          assert.equal((await fetch(url + path, { signal: AbortSignal.timeout(5_000) })).status, 200, path)
        }
      }
      response.end(JSON.stringify({ ok: true }))
    } catch (error) {
      response.statusCode = 500
      response.end(JSON.stringify({ ok: false, error: error.stack || String(error) }))
    }
  } })
}
