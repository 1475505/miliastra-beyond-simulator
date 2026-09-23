import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createStudio } from 'qxqy-studio'
import { createWebServer } from '../server.js'

function writeArchive(path, name, workspace) {
  const studio = createStudio(undefined, { workspacePath: workspace })
  studio.patch({ op: 'renameSave', name })
  writeFileSync(path, `${JSON.stringify(studio.archiveData(), null, 2)}\n`)
}

async function json(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
  })
  const body = await response.json()
  return { response, body }
}

async function eventually(check, timeoutMs = 3_000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (await check()) return
    await new Promise((resolve) => setTimeout(resolve, 180))
  }
  throw new Error('condition was not met before timeout')
}

test('web preview loads, renders, plays and follows an MCP-style file save', async () => {
  const workspace = mkdtempSync(join(tmpdir(), 'qxqy-web-'))
  const saveDir = join(workspace, 'workspace', 'demo')
  const savePath = join(saveDir, 'demo.save.json')
  mkdirSync(saveDir, { recursive: true })
  writeArchive(savePath, 'Web Preview A', workspace)
  const app = await createWebServer({ workspace, port: 0, watchIntervalMs: 100 })
  try {
    const first = await json(`${app.url}/api/state`)
    assert.equal(first.response.status, 200)
    assert.equal(first.body.value.activePath, 'workspace/demo/demo.save.json')
    assert.equal(first.body.value.snapshot.save.name, 'Web Preview A')

    const editor = await fetch(`${app.url}/api/editor.png`)
    assert.equal(editor.status, 200)
    const editorBytes = Buffer.from(await editor.arrayBuffer())
    assert.deepEqual([...editorBytes.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

    const started = await json(`${app.url}/api/play`, {
      method: 'POST',
      body: JSON.stringify({ action: 'start', args: { canvasId: 'pc-16-9', view: true, compact: true } }),
    })
    assert.equal(started.body.value.running, true)
    assert.equal(started.body.value.scene.format, 'tree-v1')
    await new Promise((resolve) => setTimeout(resolve, 180))
    const advanced = await json(`${app.url}/api/play`, {
      method: 'POST',
      body: JSON.stringify({ action: 'get', args: { view: true, compact: true } }),
    })
    assert.ok(advanced.body.value.frame > 0)
    assert.ok(advanced.body.value.time > 0)
    const play = await json(`${app.url}/api/play`, {
      method: 'POST',
      body: JSON.stringify({ action: 'get', args: { view: true, compact: true } }),
    })
    assert.equal(play.response.status, 200)
    assert.equal(play.body.value.scene.format, 'tree-v1')

    writeArchive(savePath, 'Web Preview Updated', workspace)
    await eventually(async () => {
      const current = await json(`${app.url}/api/state`)
      return current.body.value.snapshot.save.name === 'Web Preview Updated'
    })
    const current = await json(`${app.url}/api/state`)
    assert.equal(current.body.value.play.running, false)

    const escaped = await json(`${app.url}/api/open`, {
      method: 'POST',
      body: JSON.stringify({ path: '../outside.json' }),
    })
    assert.equal(escaped.response.status, 400)
    assert.match(escaped.body.error, /inside the configured workspace|file does not exist/)
  } finally {
    await app.close()
    rmSync(workspace, { recursive: true, force: true })
  }
})

test('static preview and bundled Pixi play renderer are served', async () => {
  const workspace = mkdtempSync(join(tmpdir(), 'qxqy-web-static-'))
  const app = await createWebServer({ workspace, port: 0, watchIntervalMs: 200 })
  try {
    const response = await fetch(app.url)
    const html = await response.text()
    assert.equal(response.status, 200)
    assert.match(html, /千星模拟器/)
    assert.match(html, /\/app\.js/)
    const script = await fetch(`${app.url}/app.js`)
    assert.equal(script.status, 200)
    const scriptText = await script.text()
    assert.ok(scriptText.length > 1_000)
    assert.match(scriptText, /createPlaySession/)
    const renderer = await fetch(`${app.url}/play-renderer.js`)
    const rendererText = await renderer.text()
    assert.equal(renderer.status, 200)
    assert.ok(rendererText.length > 100_000)
    assert.match(rendererText, /PixiPlayRenderer/)
    assert.match(rendererText, /createPlaySession/)
  } finally {
    await app.close()
    rmSync(workspace, { recursive: true, force: true })
  }
})
