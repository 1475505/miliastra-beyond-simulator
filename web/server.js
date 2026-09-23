#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { extname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash, timingSafeEqual } from 'node:crypto'
import { WebSession } from './lib/session.js'
import { EditorSessions } from './lib/editor-sessions.js'

const moduleDir = fileURLToPath(new URL('.', import.meta.url))
const publicDir = resolve(moduleDir, 'public')
const staticFiles = new Map([
  ['/', 'index.html'],
  ['/index.html', 'index.html'],
  ['/app.js', 'app.js'],
  ['/play-renderer.js', 'play-renderer.js'],
  ['/styles.css', 'styles.css'],
  ['/editor', 'editor.html'],
  ['/editor/', 'editor.html'],
  ['/editor.js', 'editor.js'],
  ['/editor.css', 'editor.css'],
  ['/editor/play', 'play.html'],
  ['/editor/play.js', 'play.js'],
  ['/editor/play.css', 'play.css'],
  ['/editor/play-renderer.js', 'play-renderer.js'],
])

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
}

function parseArgs(argv = process.argv.slice(2)) {
  const valueAfter = (name, fallback = '') => {
    const index = argv.indexOf(name)
    return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback
  }
  return {
    workspace: valueAfter('--workspace', process.env.QXQY_WORKSPACE || process.cwd()),
    initialPath: valueAfter('--file'),
    host: valueAfter('--host', '127.0.0.1'),
    port: Number(valueAfter('--port', '4173')),
    open: argv.includes('--open'),
  }
}

function headers(contentType) {
  return {
    'cache-control': 'no-store',
    'content-type': contentType,
    'content-security-policy': "default-src 'self'; img-src 'self' data:; connect-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; object-src 'none'; frame-ancestors 'none'",
    'x-content-type-options': 'nosniff',
  }
}

function sendJson(response, status, value) {
  response.writeHead(status, headers('application/json; charset=utf-8'))
  response.end(JSON.stringify(value))
}

function sendPng(response, image) {
  response.writeHead(200, {
    ...headers('image/png'),
    'content-length': image.data.length,
    'x-qxqy-width': String(image.width || 0),
    'x-qxqy-height': String(image.height || 0),
  })
  response.end(image.data)
}

async function readBody(request, limit = 1024 * 1024) {
  const chunks = []
  let bytes = 0
  for await (const chunk of request) {
    bytes += chunk.length
    if (bytes > limit) throw new Error('request body is too large')
    chunks.push(chunk)
  }
  if (!chunks.length) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function openBrowser(url) {
  const command = process.platform === 'win32' ? 'cmd.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open'
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url]
  spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true }).unref()
}

export async function createWebServer(options = {}) {
  const host = options.host || '127.0.0.1'
  const password = options.password ?? process.env.QXQY_WEB_PASSWORD ?? ''
  const loopback = ['127.0.0.1', 'localhost', '::1'].includes(host)
  if (!loopback && !password) throw new Error('QXQY_WEB_PASSWORD is required when listening outside loopback')
  const digest = value => createHash('sha256').update(value).digest()
  const passwordDigest = digest(password)
  const session = new WebSession(options)
  await session.initialize()
  const editors = new EditorSessions(session.workspace, options)
  const eventStreams = new Set()
  const unsubscribe = session.subscribe((event) => {
    const message = `event: state\ndata: ${JSON.stringify(event)}\n\n`
    for (const response of eventStreams) response.write(message)
  })

  const server = createServer(async (request, response) => {
    const requestUrl = new URL(request.url || '/', 'http://localhost')
    const abort = new AbortController()
    request.once('aborted', () => abort.abort())
    try {
      if (request.method === 'GET' && requestUrl.pathname === '/health') {
        sendJson(response, 200, { status: 'ok' })
        return
      }
      if (password) {
        const authorization = String(request.headers.authorization || '')
        const value = authorization.startsWith('Basic ') ? Buffer.from(authorization.slice(6), 'base64').toString('utf8') : ''
        const valid = value.startsWith('simulator:') && timingSafeEqual(digest(value.slice(10)), passwordDigest)
        if (!valid) {
          response.setHeader('www-authenticate', 'Basic realm="QXQY Simulator", charset="UTF-8"')
          sendJson(response, 401, { ok: false, error: 'Authentication required' })
          return
        }
      }
      if (!password && loopback) {
        const hostname = new URL(`http://${request.headers.host}`).hostname
        if (!['127.0.0.1', 'localhost', '[::1]'].includes(hostname)) {
          sendJson(response, 403, { ok: false, error: 'Local Host required' })
          return
        }
      }
      if (request.method === 'POST') {
        if (!/^application\/json(?:;|$)/i.test(request.headers['content-type'] || '')) {
          sendJson(response, 415, { ok: false, error: 'application/json required' })
          return
        }
        if (request.headers.origin && new URL(request.headers.origin).host !== request.headers.host) {
          sendJson(response, 403, { ok: false, error: 'Cross-origin requests are not allowed' })
          return
        }
      }
      if (request.method === 'GET' && staticFiles.has(requestUrl.pathname)) {
        const filename = staticFiles.get(requestUrl.pathname)
        const data = readFileSync(resolve(publicDir, filename))
        response.writeHead(200, headers(mimeTypes[extname(filename)] || 'application/octet-stream'))
        response.end(data)
        return
      }
      if (request.method === 'GET' && requestUrl.pathname === '/api/state') {
        sendJson(response, 200, { ok: true, value: await session.currentState(abort.signal) })
        return
      }
      if (request.method === 'GET' && requestUrl.pathname === '/api/editor.png') {
        sendPng(response, session.editorScreenshot())
        return
      }
      if (request.method === 'GET' && requestUrl.pathname === '/api/events') {
        response.writeHead(200, {
          ...headers('text/event-stream; charset=utf-8'),
          connection: 'keep-alive',
        })
        response.write(': connected\n\n')
        eventStreams.add(response)
        request.once('close', () => eventStreams.delete(response))
        return
      }
      if (request.method === 'POST' && requestUrl.pathname === '/api/open') {
        const body = await readBody(request)
        sendJson(response, 200, { ok: true, value: await session.open(body.path) })
        return
      }
      if (request.method === 'POST' && requestUrl.pathname.startsWith('/editor/api/')) {
        const body = await readBody(request, 8 * 1024 * 1024)
        const action = requestUrl.pathname.slice('/editor/api/'.length)
        const value = await editors.call(action, body, abort.signal)
        sendJson(response, 200, { ok: true, value })
        return
      }
      if (request.method === 'POST' && requestUrl.pathname === '/api/view') {
        sendJson(response, 200, { ok: true, value: await session.setView(await readBody(request)) })
        return
      }
      if (request.method === 'POST' && requestUrl.pathname === '/api/play') {
        const body = await readBody(request)
        sendJson(response, 200, { ok: true, value: await session.play(body.action, body.args || {}, abort.signal) })
        return
      }
      sendJson(response, 404, { ok: false, error: 'not found' })
    } catch (error) {
      sendJson(response, 400, { ok: false, error: error?.message || String(error) })
    }
  })

  const port = Number.isFinite(Number(options.port)) ? Number(options.port) : 4173
  try {
    await new Promise((resolveListen, reject) => {
      server.once('error', reject)
      server.listen(port, host, resolveListen)
    })
  } catch (error) {
    unsubscribe()
    await session.dispose()
    await editors.dispose()
    throw error
  }
  const address = server.address()
  const actualPort = typeof address === 'object' && address ? address.port : port
  const url = `http://${host.includes(':') ? `[${host}]` : host}:${actualPort}`

  return {
    url,
    session,
    server,
    async close() {
      unsubscribe()
      for (const response of eventStreams) response.end()
      eventStreams.clear()
      await session.dispose()
      await editors.dispose()
      await new Promise((resolveClose) => server.close(resolveClose))
    },
  }
}

async function main() {
  const options = parseArgs()
  const app = await createWebServer(options)
  process.stdout.write(`QXQY Simulator Web: ${app.url}\n`)
  if (options.open) openBrowser(app.url)
  const shutdown = () => { void app.close().finally(() => process.exit(0)) }
  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error?.stack || error}\n`)
    process.exitCode = 1
  })
}
