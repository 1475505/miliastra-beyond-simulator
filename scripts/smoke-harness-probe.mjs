// Test-only plugin copied into the disposable Harness profile by smoke-harness.
// HTTP is queried only after startup settles, so preset audits cannot deadlock boot.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { evaluatePluginCompatibility } from '@deepseek-ai/dsh-app-boot'
import { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import * as simulator from 'dsh-plugin-beyond-simulator'

export const inject = ['webServer', 'tools', 'agentPresets', 'skills', 'sessions', 'systemPrompt', 'workspaceController', 'sessionController']
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
      const url = `http://127.0.0.1:${ctx.webServer.port}`
      const readLanguage = async (headers = {}) => {
        const result = await fetch(`${url}/qxqy-simulator/api/locale`, {
          method: 'POST', headers: { 'content-type': 'application/json', ...headers },
          body: '{}', signal: AbortSignal.timeout(5_000),
        })
        assert.equal(result.status, 200)
        const payload = await result.json()
        assert.equal(payload.ok, true, JSON.stringify(payload))
        return payload.value
      }
      // Metadata must work before a simulator session or controller exists.
      const language = await readLanguage()
      assert.deepEqual(await readLanguage({ 'x-forwarded-for': '192.0.2.1' }), { language: '', source: 'browser' })
      const require = createRequire(import.meta.url)
      const manifest = JSON.parse(await readFile(require.resolve('dsh-plugin-beyond-simulator/package.json'), 'utf8'))
      for (const version of ['0.1.0-rc.6', '0.1.7-rc.2', '0.2.0-rc.1', '0.2.0-rc.2', '0.2.1-rc.1', '0.2.1-rc.2']) {
        assert.equal(evaluatePluginCompatibility(manifest, {}, version), undefined, version)
      }
      assert.ok(evaluatePluginCompatibility(manifest, {}, '0.3.0-rc.1'), 'Do not silently admit a future minor API')
      const preset = await ctx.agentPresets.resolve('wonderland-lua-builder')
      assert.equal(preset.broken, undefined, JSON.stringify(preset))
      const lease = await ctx.agentPresets.acquireScope(preset.id)
      try {
        // Exercise the mounted preset's real prompt contributions without a
        // model request. Old hosts may register cwd; newer hosts do not.
        const assembly = await ctx.systemPrompt.assemble({ scope: lease.key })
        const prompt = renderPrompt({
          ...assembly,
          variables: { ...assembly.variables, provider: 'compat-provider', model: 'compat-model' },
        })
        assert.match(prompt, /千星奇域 2D\+Lua game studio director powered by the compat-model model/)
        assert.doesNotMatch(prompt, /\{\{(?:cwd|model)\}\}/)
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
        assert.deepEqual(await readLanguage(), language, 'locale route survives plugin restart')
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
      if (config.languageBrowser) {
        const { workspace } = await ctx.workspaceController.create({ path: config.workspace })
        const created = await ctx.sessionController.create({ workspaceId: workspace.workspaceId })
        // A synthetic persisted message exposes the normal conversation tabs;
        // no prompt is submitted to an Agent or model.
        const uiSession = ctx.sessions.get(created.sessionId)
        uiSession.append('user/message', { id: 'language-smoke-message', role: 'user',
          source: { kind: 'user' }, content: [{ type: 'text', text: 'UI language smoke fixture' }] }, { surfaceOp: 'append' })
        await ctx.sessionController.rename({ sessionId: created.sessionId, title: 'Harness language smoke' })
        await ctx.sessions.flush(uiSession)
        const script = await (await fetch(`${url}/qxqy-simulator/api/patch`, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sessionId: created.sessionId, op: { op: 'addScript', path: 'language-smoke.lua', source: '-- language fixture' } }),
          signal: AbortSignal.timeout(5_000),
        })).json()
        assert.equal(script.ok, true, JSON.stringify(script))
      }
      response.end(JSON.stringify({ ok: true, language }))
    } catch (error) {
      response.statusCode = 500
      response.end(JSON.stringify({ ok: false, error: error.stack || String(error) }))
    }
  } })
}
