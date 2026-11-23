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
  const reject = async (agent, name, args, code, legacyMessage) => {
    const result = await execute(agent, name, args)
    assert.equal(result.isError, true, 'Unauthorized or invalid selection must fail before spawning')
    if (result.error?.info?.code) assert.equal(result.error.info.code, code)
    else assert.match(result.error?.message ?? JSON.stringify(result.content), legacyMessage)
  }
  const update = patch => ctx.settings.update('subagent-model-selection-settings', patch)
  try {
    await update({ enabled: false, allowedModels: [] })
    const disabled = await create('models-disabled', mount)
    const inheritedModels = await discover(disabled.agent, { provider })
    assert.match(inheritedModels, /qxqy-smoke-models\/parent/)
    assert.doesNotMatch(inheritedModels, /qxqy-smoke-models\/allowed/)
    await reject(disabled.agent, 'subagent', { description: 'Host setting disabled', prompt: 'fixture', provider, model: 'allowed' }, 'MODEL_ROUTE_NOT_ALLOWED', /not allowed/)

    await update({ enabled: true, allowedModels })
    // A fresh session under each setting works on hosts with snapshot or live settings.
    const enabled = await create('models-enabled', async agentCtx => { await ctx.agentPresets.mount(agentCtx, 'standard') })
    await ctx.agentPresets.select(enabled.agent, presetId)
    checkTools(enabled.agent)
    assert.match(await discover(enabled.agent, {}), /qxqy-smoke-models/)
    const models = await discover(enabled.agent, { provider })
    assert.match(models, /qxqy-smoke-models\/allowed/)
    assert.doesNotMatch(models, /qxqy-smoke-models\/(?:parent|denied)/)
    assert.match(await discover(enabled.agent, { provider, model: 'allowed' }), /low[\s\S]*high/)
    await reject(enabled.agent, 'list_subagent_models', { provider, model: 'denied' }, 'MODEL_ROUTE_NOT_ALLOWED', /not allowed/)
    await reject(enabled.agent, 'subagent', { description: 'Reject unauthorized model', prompt: 'fixture', provider, model: 'denied' }, 'MODEL_ROUTE_NOT_ALLOWED', /not allowed/)
    await reject(enabled.agent, 'subagent', { description: 'Validate authorized effort', prompt: 'fixture', provider, model: 'allowed', reasoning_effort: 'invalid' }, 'UNSUPPORTED_REASONING_EFFORT', /does not support reasoning effort/)
  } finally {
    try { for (const owner of owners) await owner.dispose() }
    finally { unregister(); await update({ enabled: false, allowedModels: [] }) }
  }
}
