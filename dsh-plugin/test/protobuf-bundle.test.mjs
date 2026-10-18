import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execute = promisify(execFile)

test('built DSH imports and round-trips GIA even if the host protobuf module has no parser', async () => {
  for (const name of ['index', 'worker']) {
    const source = await readFile(new URL(`../dist/${name}.js`, import.meta.url), 'utf8')
    assert.doesNotMatch(source, /\bfrom\s*["']protobufjs(?:["'/])/, `${name} must carry its own GIA parser`)
  }
  const bundle = new URL('../dist/index.js', import.meta.url).href
  const script = `
    import assert from 'node:assert/strict';
    import { createRequire } from 'node:module';
    const require = createRequire(${JSON.stringify(new URL('../../package.json', import.meta.url).href)});
    // Model the reported import-time failure without altering the test runner's
    // module cache or any installed package files.
    require('protobufjs').parse = undefined;
    const { SimulatorController } = await import(${JSON.stringify(bundle)});
    const source = new SimulatorController(), target = new SimulatorController();
    try {
      const gia = source.exportData('gia');
      assert.ok(gia.data.length > 0);
      const imported = target.importData('gia', gia.data, 'parser-isolation.gia');
      assert.ok(imported.snapshot.tree.length > 0);
      const again = target.exportData('gia');
      assert.ok(again.data.length > 0);
      assert.deepEqual(Buffer.from(gia.data, 'base64'), Buffer.from(again.data, 'base64'));
    } finally { await Promise.all([source.dispose(), target.dispose()]); }
  `
  await execute(process.execPath, ['--input-type=module', '-e', script], { windowsHide: true, timeout: 15_000 })
})
