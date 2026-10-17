import { openSync, closeSync, fstatSync, readFileSync } from 'node:fs'
import { extname, isAbsolute } from 'node:path'
import { createHash } from 'node:crypto'
import { workerData } from 'node:worker_threads'
import { GlobalFonts } from '@napi-rs/canvas'
import { FONT_ROUTE, MAX_FONT_BYTES, fontFamily, fontStack } from '../fonts.js'

function register(bytes) {
  const data = Buffer.from(bytes)
  const signature = data.subarray(0, 4).toString('hex')
  if (data.length < 12 || data.length > MAX_FONT_BYTES || !['00010000', '4f54544f'].includes(signature)) {
    throw new Error('QXQY_FONT_PATH must contain a valid TTF or OTF font (at most 32 MiB)')
  }
  const id = createHash('sha256').update(data).digest('hex')
  const family = fontFamily(id)
  try {
    if (!GlobalFonts.has(family) && !GlobalFonts.register(data, family)) throw new Error('invalid font')
  } catch {
    throw new Error('QXQY_FONT_PATH font could not be registered')
  }
  return { id, data, type: signature === '4f54544f' ? 'font/otf' : 'font/ttf' }
}

export function readLocalFont(path) {
  if (!path) return null
  if (!isAbsolute(path) || !['.ttf', '.otf'].includes(extname(path).toLowerCase())) {
    throw new Error('QXQY_FONT_PATH must be an absolute path to a TTF or OTF font')
  }
  let fd, data
  try {
    fd = openSync(path, 'r')
    const stat = fstatSync(fd)
    if (!stat.isFile() || stat.size < 12 || stat.size > MAX_FONT_BYTES) throw new Error('invalid size')
    data = readFileSync(fd)
  } catch {
    // Do not return local filenames through a browser/API error.
    throw new Error('QXQY_FONT_PATH must point to a readable font file of at most 32 MiB')
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
  return register(data)
}

let configured = false
let font = null
export function localFont() {
  if (!configured) {
    // Workers receive the exact startup bytes, even if the file is later changed.
    font = workerData && Object.hasOwn(workerData, 'localFont')
      ? (workerData.localFont ? register(workerData.localFont) : null)
      : readLocalFont(process.env.QXQY_FONT_PATH)
    configured = true
  }
  return font
}

export const localFontStack = () => fontStack(localFont()?.id)
export const isLoopback = host => ['127.0.0.1', 'localhost', '::1', '[::1]', '::ffff:127.0.0.1'].includes(host)

function localRequest(request) {
  try {
    const host = request.headers.host
    return isLoopback(request.socket.remoteAddress) && isLoopback(new URL(`http://${host}`).hostname)
      && !request.headers.forwarded && !request.headers['x-forwarded-for'] && !request.headers['x-forwarded-host']
      && !request.headers.via && request.headers['sec-fetch-site'] !== 'cross-site'
      && (!request.headers.origin || new URL(request.headers.origin).host === host)
  } catch { return false }
}

export function serveLocalFont(request, response) {
  const url = new URL(request.url || '/', 'http://localhost')
  if (url.pathname !== FONT_ROUTE && !url.pathname.startsWith(`${FONT_ROUTE}/`)) return false
  const send = (status, type, data) => {
    response.writeHead(status, { 'content-type': type, 'cache-control': 'no-store',
      'x-content-type-options': 'nosniff', 'cross-origin-resource-policy': 'same-origin' })
    response.end(request.method === 'HEAD' ? undefined : data)
    return true
  }
  if (!['GET', 'HEAD'].includes(request.method)) return send(405, 'text/plain', 'Method not allowed')
  try {
    const current = localFont()
    if (current && !localRequest(request)) return send(403, 'text/plain', 'Local font access requires a direct loopback connection')
    if (url.pathname === `${FONT_ROUTE}/manifest`) {
      return send(200, 'application/json', JSON.stringify({ id: current?.id ?? null }))
    }
    if (current && url.pathname === `${FONT_ROUTE}/file/${current.id}`) return send(200, current.type, current.data)
    return send(404, 'text/plain', 'Font not found')
  } catch {
    return send(500, 'text/plain', 'Local font configuration failed; check QXQY_FONT_PATH and restart the host')
  }
}
