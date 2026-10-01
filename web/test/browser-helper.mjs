import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

export async function startTestBrowser(directory) {
  const child = spawn(process.env.QXQY_BROWSER, [
    '--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-popup-blocking',
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--remote-debugging-port=0',
    `--user-data-dir=${join(directory, 'browser')}`, 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true })
  let socket
  const closed = once(child, 'close')
  const close = async () => {
    socket?.close()
    if (child.exitCode === null && child.signalCode === null) child.kill()
    await closed
  }
  try {
    const endpoint = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Browser startup timeout')), 15_000)
      let output = ''
      child.stderr.on('data', chunk => {
        output += chunk
        const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/)
        if (match) { clearTimeout(timer); resolve(match[1]) }
      })
      child.once('error', error => { clearTimeout(timer); reject(error) })
      child.once('exit', () => { clearTimeout(timer); reject(new Error(output)) })
    })
    socket = new WebSocket(endpoint)
    await once(socket, 'open')
    const pending = new Map()
    const errors = []
    let sequence = 0
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data)
      if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails)
      const request = pending.get(message.id)
      if (!request) return
      pending.delete(message.id)
      clearTimeout(request.timer)
      if (message.error) request.reject(new Error(message.error.message))
      else request.resolve(message.result)
    })
    const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
      const id = ++sequence
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)) }, 15_000)
      pending.set(id, { resolve, reject, timer })
      socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
    })
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
    await send('Page.enable', {}, sessionId)
    await send('Runtime.enable', {}, sessionId)
    const evaluate = async expression => {
      const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true }, sessionId)
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
      return result.result.value
    }
    const wait = async expression => {
      for (let i = 0; i < 150; i++) { if (await evaluate(expression)) return; await delay(100) }
      throw new Error(`Browser wait failed: ${expression}\n${await evaluate('document.body.innerText')}\n${JSON.stringify(errors)}`)
    }
    return { send, evaluate, wait, close, sessionId, targetId,
      navigate: url => send('Page.navigate', { url }, sessionId),
      key: async (key, code) => {
        await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code }, sessionId)
        await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code }, sessionId)
      },
    }
  } catch (error) { await close(); throw error }
}
