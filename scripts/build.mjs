import { build } from 'esbuild'
import { cp, mkdir, copyFile, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { root, products, cleanGenerated } from './paths.mjs'

const external = ['@deepseek-ai/*', '@napi-rs/canvas', 'fengari', 'protobufjs']

async function bundle(entry, outfile, browser = false) {
  await build({
    absWorkingDir: root, entryPoints: [entry], outfile, bundle: true,
    format: 'esm', platform: browser ? 'browser' : 'node',
    target: browser ? 'es2022' : 'node20', minify: true,
    external: browser ? [] : external, logLevel: 'warning',
  })
}

export async function buildProduct(product) {
  if (!products.includes(product)) throw new Error(`Unknown product: ${product}`)
  const output = join(root, product, 'dist')
  await cleanGenerated(output, join(root, product))
  await mkdir(output, { recursive: true })
  if (product === 'dsh-plugin') {
    const presetRoot = join(root, 'agent/wonderland-lua-builder')
    const presetMeta = await readFile(join(presetRoot, 'preset.yml'), 'utf8')
    const presetRows = await readFile(join(presetRoot, 'agent.cordis.yml'), 'utf8')
    const display = key => {
      const value = presetMeta.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'))?.[1]
      if (!value) throw new Error(`Agent preset is missing ${key}`)
      return JSON.stringify(value.trim())
    }
    // Older DSH releases do not ship this plugin. Keep the legacy copier active
    // there, and enable declarative registration only when DSH provides it.
    const modernPresetUnavailable = "(()=>{try{process.getBuiltinModule('node:module').createRequire(process.argv[1]).resolve('@deepseek-ai/dsh-agent-preset');return false}catch{return true}})()"
    const patch = [
      '- insert:',
      '    - id: qxqy-simulator',
      '      name: dsh-plugin-beyond-simulator',
      '    - id: qxqy-simulator-skill',
      '      name: dsh-plugin-beyond-simulator/skill',
      '    - id: qxqy-simulator-preset-legacy',
      '      name: dsh-plugin-beyond-simulator/preset',
      '    - id: qxqy-simulator-preset',
      "      name: '@deepseek-ai/dsh-agent-preset'",
      `      disabled: !!js ${JSON.stringify(modernPresetUnavailable)}`,
      '      config:',
      '        id: wonderland-lua-builder',
      `        name: ${display('name')}`,
      `        description: ${display('description')}`,
      '        plugins:',
      ...presetRows.trimEnd().split(/\r?\n/).map(line => line ? `          ${line}` : ''),
      '',
    ].join('\n')
    await writeFile(join(root, 'dsh-plugin/cordis.patch.yml'), patch)
    for (const name of ['index', 'worker', 'skill', 'preset']) {
      await bundle(`dsh-plugin/lib/${name}.js`, join(output, `${name}.js`))
    }
    await bundle('dsh-plugin/lib/play-renderer.js', join(output, 'play-renderer.js'), true)
    await build({ absWorkingDir: root, entryPoints: ['dsh-plugin/lib/client.js'], outfile: join(output, 'client.js'), bundle: true, format: 'iife', minify: true, platform: 'browser', target: 'es2022' })
    await copyFile(join(root, 'skill/SKILL.md'), join(root, 'dsh-plugin/skill.md'))
    const presets = join(root, 'dsh-plugin/presets')
    await cleanGenerated(presets, join(root, 'dsh-plugin'))
    await cp(join(root, 'agent/wonderland-lua-builder'), join(presets, 'wonderland-lua-builder'), { recursive: true })
  } else {
    const entry = product === 'web' ? 'server' : 'index'
    await bundle(`${product}/${entry}.js`, join(output, `${entry}.js`))
    // import.meta.url in the bundled Controller resolves beside this entry.
    await bundle('studio/host/worker.js', join(output, 'worker.js'))
    if (product === 'web') {
      await bundle('studio/play/pixi-renderer.js', join(root, 'web/public/play-renderer.js'), true)
      await bundle('web/lib/editor-client.js', join(root, 'web/public/editor.js'), true)
      // Reuse the standalone play surface, with Web routes and external scripts
      // so the deployed page does not need unsafe-inline script permissions.
      let html = (await readFile(join(root, 'dsh-plugin/lib/play.html'), 'utf8')).replaceAll('/qxqy-simulator/', '/editor/')
      const script = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1]
      const css = html.match(/<style>([\s\S]*?)<\/style>/)[1]
      html = html.replace(/<script type="module">[\s\S]*?<\/script>/, '<script type="module" src="/editor/play.js"></script>')
        .replace(/<style>[\s\S]*?<\/style>/, '<link rel="stylesheet" href="/editor/play.css">')
      await writeFile(join(root, 'web/public/play.html'), html)
      await writeFile(join(root, 'web/public/play.js'), script)
      await writeFile(join(root, 'web/public/play.css'), css)
      await cp(join(root, 'web/public'), join(output, 'public'), { recursive: true })
    }
  }
  console.log(`Built ${product}`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const product of process.argv.slice(2).length ? process.argv.slice(2) : products) await buildProduct(product)
}
