// #24: run the installed preset against real Host settings and tool execution.
// The adapter provides only synthetic catalog metadata; no model is requested.
import assert from 'node:assert/strict'
import { LlmAdapter } from '@deepseek-ai/dsh-llm'

export async function smokeSubagentModels(ctx, { presetId, workspace }) {
  const provider = 'qxqy-smoke-models'
  const allowedModels = [{ provider, model: 'allowed' }]
  const reasoning = { efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }], defaultEffort: 'high' }
  class CatalogAdapter extends LlmAdapter {
    async listModels() { return ['parent', 'allowed', 'denied'].map(id => ({ provider, id, name: id })) }
    async resolveModel(route, model) { return { provider: route, id: model, name: model, reasoning } }
    async *stream() { assert.fail('Model-selection smoke must not request inference') }
  }
  const unregister = ctx.llm.registerAdapter([provider], new CatalogAdapter())
  const owners = new Set()
  const create = async (sessionId, setup) => {
    const owner = await ctx.agents.create({ sessionId, meta: { cwd: workspace },
      agentOptions: { provider, model: 'parent' }, setup })
    owners.add(owner)
    return owner
  }
  const mount = async agentCtx => { await ctx.agentPresets.mount(agentCtx, presetId) }
  const selectFields = ['provider', 'model', 'reasoning_effort']
  const checkTools = agent => {
    const schemas = ctx.tools.schemas(agent)
    for (const name of ['subagent', 'subagent_fork', 'list_subagent_models']) {
      assert.equal(schemas.filter(row => row.name === name).length, 1, `${presetId}: ${name} registered once`)
    }
    const fields = name => schemas.find(row => row.name === name).parameters.properties
    for (const field of selectFields) {
      assert.ok(fields('subagent')[field], `#24: subagent must expose ${field}`)
      assert.equal(fields('subagent_fork')[field], undefined, 'fork keeps the official inherited-route default')
    }
  }
  let callId = 0
  const execute = async (agent, name, args) => {
    const id = `model-smoke-${++callId}`
    return (await ctx.tools.execute({ calls: [{ type: 'tool-call', id, name, arguments: JSON.stringify(args) }],
      agent, signal: AbortSignal.timeout(5_000) })).results[0].result
  }
  const discover = async (agent, args) => {
    const result = await execute(agent, 'list_subagent_models', args)
    assert.equal(result.isError, false, JSON.stringify(result))
    return result.content.filter(block => block.type === 'text').map(block => block.text).join('\n')
  }
  const reject = async (agent, name, args, expected) => {
    const result = await execute(agent, name, args)
    assert.equal(result.isError, true, 'Unauthorized or invalid selection must fail before spawning')
    assert.match(JSON.stringify(result), expected)
  }
  const policy = agent => agent.session.snapshotEvents().filter(event => event.type === 'subagent/model-selection-policy')
  const update = patch => ctx.settings.update('subagent-model-selection-settings', patch)
  try {
    await update({ enabled: false, allowedModels: [] })
    const disabled = await create('models-disabled', mount)
    checkTools(disabled.agent)
    assert.equal(policy(disabled.agent).length, 0)
    const inheritedModels = await discover(disabled.agent, { provider })
    assert.match(inheritedModels, /qxqy-smoke-models\/parent/)
    assert.doesNotMatch(inheritedModels, /qxqy-smoke-models\/allowed/)
    await reject(disabled.agent, 'subagent', { description: 'No session authorization', prompt: 'fixture', provider, model: 'allowed' }, /not allowed for this Session/)

    await update({ enabled: true, allowedModels })
    // Capture Host authorization with standard, then switch the same blank
    // conversation to the game preset, matching the reported user workflow.
    const enabled = await create('models-enabled', async agentCtx => { await ctx.agentPresets.mount(agentCtx, 'standard') })
    assert.deepEqual(policy(enabled.agent).map(event => event.data.allowedModels), [allowedModels])
    await ctx.agentPresets.select(enabled.agent, presetId)
    checkTools(enabled.agent)
    assert.match(await discover(enabled.agent, {}), /qxqy-smoke-models/)
    const models = await discover(enabled.agent, { provider })
    assert.match(models, /qxqy-smoke-models\/allowed/)
    assert.doesNotMatch(models, /qxqy-smoke-models\/(?:parent|denied)/)
    assert.match(await discover(enabled.agent, { provider, model: 'allowed' }), /low[\s\S]*high/)
    await reject(enabled.agent, 'list_subagent_models', { provider, model: 'denied' }, /not allowed for this Session/)
    await reject(enabled.agent, 'subagent', { description: 'Reject unauthorized model', prompt: 'fixture', provider, model: 'denied' }, /not allowed for this Session/)
    await reject(enabled.agent, 'subagent', { description: 'Validate authorized effort', prompt: 'fixture', provider, model: 'allowed', reasoning_effort: 'invalid' }, /does not support reasoning effort/)
    assert.equal(policy(enabled.agent).length, 1, 'preset switching must not resample or duplicate Host authorization')

    await update({ enabled: false })
    assert.equal(await discover(enabled.agent, { provider }), models, 'existing Session retains its policy')
    const fresh = await create('models-disabled-again', mount)
    checkTools(fresh.agent)
    assert.equal(policy(fresh.agent).length, 0)
    assert.match(await discover(fresh.agent, { provider }), /qxqy-smoke-models\/parent/)
    await ctx.sessions.flush(enabled.agent.session)
    await enabled.dispose()
    owners.delete(enabled)
    const restored = await ctx.agents.resume({ resumeSessionId: 'models-enabled', agentOptions: { provider, model: 'parent' }, setup: mount })
    owners.add(restored)
    checkTools(restored.agent)
    assert.equal(await discover(restored.agent, { provider }), models, 'restoration uses the saved policy after Host opt-out')
  } finally {
    for (const owner of owners) await owner.dispose()
    unregister()
  }
}
