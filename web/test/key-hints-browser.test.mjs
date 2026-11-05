import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createWebServer } from '../server.js'
import { startTestBrowser } from './browser-helper.mjs'
import { createRuntime } from '../../client/lua-runtime/src/index.js'
import { playSnapshot, paintList } from '../../studio/play/session.js'

test('key hint dropdowns render editor icons, WebGL uploads Lua changes, and play device preview survives restart', {
  skip: !process.env.QXQY_BROWSER, timeout: 90_000,
}, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'qxqy-key-hints-'))
  const runtime = createRuntime({ canvasWidth: 240, canvasHeight: 160, device: 'Controller' })
  let app, browser
  t.after(async () => {
    runtime.destroy()
    await browser?.close(); await app?.close()
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  })
  app = await createWebServer({ workspace: directory, port: 0 })
  browser = await startTestBrowser(directory)
  const { evaluate, wait } = browser
  await browser.navigate(app.url + '/editor')
  await wait(`Boolean(document.querySelector('.qxsim-key-hint'))`)
  await evaluate(`(async () => {
    const sessionId = sessionStorage.getItem('qxqy-editor-session');
    const api = async (action, body = {}) => (await (await fetch('/editor/api/' + action, {
      method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({sessionId,...body})
    })).json()).value;
    let state = await api('get');
    for (const [key,value] of [['keyboardKeyCode','CraftspersonKey42'],['controllerKeyCode','CraftspersonKey4']]) {
      state = await api('patch',{op:{op:'set',id:'n8',key,value,expectedRevision:state.version}});
    }
    await api('patch',{op:{op:'select',id:'n8',expectedRevision:state.version}});
  })()`)
  await browser.navigate(app.url + '/editor')
  await wait(`document.querySelector('.qxsim-key-hint')?.getAttribute('aria-label') === '奇匠按键42'`)
  await evaluate(`window.hintColors = canvas => {
    const data=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
    let white=0,yellow=0,green=0,ink=0;
    for(let i=0;i<data.length;i+=4){
      if(data[i+3]>200)ink++;
      if(data[i]>245&&data[i+1]>245&&data[i+2]>245&&data[i+3]>240)white++;
      if(data[i]>200&&data[i+1]>160&&data[i+2]<100&&data[i+3]>240)yellow++;
      if(data[i]<180&&data[i+1]>180&&data[i+2]<120&&data[i+3]>240)green++;
    }
    return {white,yellow,green,ink};
  }`)
  let colors = await evaluate(`hintColors(document.querySelector('.qxsim-key-hint'))`)
  assert.ok(colors.white > 1500, JSON.stringify(colors))
  const width = await evaluate(`document.querySelector('.qxsim-key-hint').width`)
  assert.ok(width > 100, 'Backspace grows beyond its 40px transform')
  const select = `document.querySelector('select[aria-label="按键图标预览"]')`
  await evaluate(`(() => {const select=${select};select.value='controller';select.dispatchEvent(new Event('change',{bubbles:true}));})()`)
  await wait(`document.querySelector('.qxsim-key-hint')?.getAttribute('aria-label') === '奇匠按键4'`)
  colors = await evaluate(`hintColors(document.querySelector('.qxsim-key-hint'))`)
  assert.ok(colors.white > 500 && colors.yellow > 20, JSON.stringify(colors))
  await evaluate(`(() => {
    const field=[...document.querySelectorAll('.qxsim-field')].find(el=>el.textContent.startsWith('手柄按键'));
    const select=field.querySelector('select');select.value='None';select.dispatchEvent(new Event('change',{bubbles:true}));
  })()`)
  await wait(`document.querySelector('.qxsim-key-hint')?.getAttribute('aria-label') === '无'`)
  assert.equal(await evaluate(`hintColors(document.querySelector('.qxsim-key-hint')).ink`), 0)
  await evaluate(`(() => {
    const field=[...document.querySelectorAll('.qxsim-field')].find(el=>el.textContent.startsWith('手柄按键'));
    const select=field.querySelector('select');select.value='CraftspersonKey4';select.dispatchEvent(new Event('change',{bubbles:true}));
  })()`)
  await wait(`document.querySelector('.qxsim-key-hint')?.getAttribute('aria-label') === '奇匠按键4'`)

  const key = runtime.addRoot({ kind: 'keyhint', name: 'Hint', active: true, sizeDeltaX: 40, sizeDeltaY: 40,
    controllerKeyCode: 'CraftspersonKey4' })
  runtime.mountScript({ path: 'hint-update', control: key, source: `
local odd = true
function OnStart() script:EnableUpdate(true) end
function OnUpdate(dt)
  odd = not odd
  script.object.controllerKeyCode = odd and Enum.ControllerKeyCode.CraftspersonKey4 or Enum.ControllerKeyCode.CraftspersonKey6
end` })
  assert.deepEqual(runtime.mountErrors, [])
  const session = { runtime, compiled: { canvasId: 'pc-16-9', platform: 'KEYBOARD' } }
  let scene = playSnapshot(session, { view: true }).scene
  await evaluate(`(async () => {
    const {PixiPlayRenderer}=await import('/play-renderer.js');
    const canvas=document.createElement('canvas');document.body.append(canvas);
    window.hintRenderer=new PixiPlayRenderer(canvas);await hintRenderer.ready;
    window.gpuColors=()=>hintColors(hintRenderer.app.renderer.extract.canvas({target:hintRenderer.app.stage,resolution:1}));
    window.sourceCount=()=>Object.values(hintRenderer.app.renderer.texture._managedTextures.items).filter(Boolean).length;
    await hintRenderer.applyScene(${JSON.stringify(scene)},240,160);
  })()`)
  const gpu = await evaluate('gpuColors()')
  assert.ok(gpu.white > 500 && gpu.yellow > 20, JSON.stringify(gpu))
  await evaluate(`hintRenderer.render(${JSON.stringify(paintList(session))},240,160)`)
  assert.deepEqual(await evaluate('gpuColors()'), gpu, 'flat and nested scene show the same chord')
  await evaluate(`hintRenderer.applyScene(${JSON.stringify(scene)},240,160)`)
  await evaluate(`void (window.hintTexture=hintRenderer.nodes.get(${key.Id}).__visual.__keyHint.texture)`)
  const baseCount = await evaluate('sourceCount()'), variants = []
  for (let i = 0; i < 2; i++) {
    runtime.step(0.1)
    scene = playSnapshot(session, { view: true, sceneRev: scene.revision }).scene
    variants.push(scene)
  }
  const churn = await evaluate(`(async () => {
    const scenes=${JSON.stringify(variants)};let replaced=0;
    for(let i=0;i<101;i++) {
      await hintRenderer.applyScene(scenes[i%2],240,160);
      if(hintRenderer.nodes.get(${key.Id}).__visual.__keyHint.texture!==hintTexture)replaced++;
    }
    return {replaced,count:sourceCount(),colors:gpuColors()};
  })()`)
  assert.equal(churn.replaced, 0)
  assert.ok(churn.count <= baseCount + 1)
  assert.equal(churn.colors.yellow, 0, 'old Y pixels removed from GPU')
  assert.ok(churn.colors.green > 20, 'new A pixels uploaded')
  key.controllerKeyCode = 'None'; key.markPlayDirty()
  const none = playSnapshot(session, { view: true, sceneRev: scene.revision }).scene
  const cleanup = await evaluate(`(async () => {
    const source=hintTexture.source;
    await hintRenderer.applyScene(${JSON.stringify(none)},240,160);
    const result={destroyed:hintTexture.destroyed,sourceDestroyed:source.destroyed,
      children:hintRenderer.nodes.get(${key.Id}).__visual.children.length};
    hintRenderer.destroy();return result;
  })()`)
  assert.deepEqual(cleanup, { destroyed: true, sourceDestroyed: true, children: 0 })

  const sessionId = await evaluate(`sessionStorage.getItem('qxqy-editor-session')`)
  await browser.navigate(app.url + '/editor/play#' + sessionId)
  await wait(`document.querySelector('#state').textContent.includes('试玩运行中')`)
  assert.equal(await evaluate(`document.querySelector('#keyHintSel').value`), 'controller')
  await evaluate(`(() => {const s=document.querySelector('#keyHintSel');s.value='keyboard';s.dispatchEvent(new Event('change'));})()`)
  const observe = async () => (await (await fetch(app.url + '/editor/api/play', { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId, action: 'get', args: { view: true } }) })).json()).value
  await wait(`!document.querySelector('#keyHintSel').disabled && document.querySelector('#keyHintSel').value === 'keyboard'`)
  const playing = await observe()
  assert.equal(playing.keyHintDevice, 'keyboard')
  assert.equal(playing.scene.nodes.find(n => n.kind === 'keyhint').keyHint.tokens[0].label, 'Backspace')
  await evaluate(`document.querySelector('#stop').click()`)
  await wait(`!document.querySelector('#restart').classList.contains('hidden')`)
  await evaluate(`document.querySelector('#restart').click()`)
  await wait(`document.querySelector('#state').textContent.includes('试玩运行中')`)
  assert.equal((await observe()).keyHintDevice, 'keyboard')
})
