// Copied to the isolated Git dependency consumer before execution.
import assert from 'node:assert/strict'
import { mkdir, readFile, access } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { SimulatorController } from 'dsh-plugin-beyond-simulator'
import { apply as registerSkill } from 'dsh-plugin-beyond-simulator/skill'

const require = createRequire(import.meta.url)
const packageRoot = dirname(require.resolve('dsh-plugin-beyond-simulator/package.json'))
const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'))
const patch = await readFile(join(packageRoot, manifest.dsh.bundle.patch), 'utf8')
for (const [, name] of patch.matchAll(/^      name:\s+(\S+)/gm)) {
  if (name === "'@deepseek-ai/dsh-agent-preset'") continue // supplied by Harness 0.1.7+
  assert.equal(typeof (await import(name)).apply, 'function', `Bundle entry ${name}`)
}
assert.match(patch, /id: wonderland-lua-builder/)
assert.equal(typeof (await import('dsh-plugin-beyond-simulator/preset')).apply, 'function')
const client = await readFile(require.resolve('dsh-plugin-beyond-simulator/client'), 'utf8')
let clientModule
new Function('window', client)({ __ModuleLoader__: { load(value) { clientModule = value } } })
assert.equal(clientModule.id, manifest.name)
const clientExports = clientModule.factory(name => { assert.equal(name, 'react'); return { createElement() {} } })
assert.deepEqual(clientExports.inject, ['slots'])
assert.equal(typeof clientExports.apply, 'function')
await access(join(packageRoot, 'dsh-plugin/lib/play.html'))
await access(join(packageRoot, 'dsh-plugin/dist/play-renderer.js'))
await access(join(packageRoot, 'dsh-plugin/presets/wonderland-lua-builder/preset.yml'))
let skill
registerSkill({ skills: { register(value) { skill = value } } })
assert.equal(skill.name, 'qxqy-simulator')
assert.ok(skill.content.length > 1000)
for (const name of ['qxqy-studio', 'qxqy-lua-runtime', 'qxqy-editor-ui']) {
  assert.throws(() => require.resolve(name), { code: 'MODULE_NOT_FOUND' })
}
const workspace = join(process.cwd(), 'game')
await mkdir(workspace)
const controller = new SimulatorController(workspace)
try {
  controller.patch({ op: 'renameSave', name: 'Git source install' })
  assert.ok(controller.saveArchive('game.save.json').bytes > 0)
  assert.equal(controller.requestUiScreenshot().data.subarray(1, 4).toString(), 'PNG')
  assert.equal((await controller.play('start', { view: true })).running, true)
  assert.equal((await controller.requestScreenshot()).data.subarray(1, 4).toString(), 'PNG')
} finally {
  await controller.dispose()
}
