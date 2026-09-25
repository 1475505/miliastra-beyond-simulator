import { realpathSync } from 'node:fs'
import { isAbsolute, relative } from 'node:path'
import { resolveWorkspaceFile, resolveWorkspaceRoot } from './workspace.js'

const SERVICE = 'beyond-simulator-web'
const DEFAULT_WEB_URL = 'http://127.0.0.1:4173'
const DEFAULT_TIMEOUT_MS = 4_000

function previewOrigin(value) {
  let url
  try { url = new URL(value) } catch { /* Report configuration without exposing credentials. */ }
  if (!url || !['http:', 'https:'].includes(url.protocol) || url.username || url.password
    || url.search || url.hash || url.pathname !== '/') {
    throw new Error('--web-url / QXQY_WEB_URL must be an HTTP(S) origin without credentials, path, query, or fragment')
  }
  return url.origin
}

function canonicalWorkspace(value) {
  if (typeof value !== 'string' || !isAbsolute(value)) throw new Error('workspace must be an absolute local path')
  const path = realpathSync(value)
  return process.platform === 'win32' ? path.toLowerCase() : path
}

/** Bridge explicitly requested preview operations to the separate Web process. */
export function createPreviewClient({ workspace, webUrl = DEFAULT_WEB_URL, password = '', timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const workspaceRoot = resolveWorkspaceRoot(workspace)
  const authorization = password ? `Basic ${Buffer.from(`simulator:${password}`).toString('base64')}` : ''
  const timeout = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS
  const redact = value => {
    let message = String(value || '')
    for (const secret of [password, authorization, authorization.slice(6)]) {
      if (secret) message = message.replaceAll(secret, '[redacted]')
    }
    return message.slice(0, 1_000)
  }

  async function operation(signal, run) {
    const url = previewOrigin(webUrl)
    const abort = new AbortController()
    let timedOut = false
    const onAbort = () => abort.abort()
    if (signal?.aborted) abort.abort()
    else signal?.addEventListener('abort', onAbort, { once: true })
    const timer = setTimeout(() => { timedOut = true; abort.abort() }, timeout)
    try {
      const request = async (path, body) => {
        let response
        try {
          response = await fetch(`${url}${path}`, {
            method: body ? 'POST' : 'GET',
            headers: {
              accept: 'application/json',
              ...(authorization ? { authorization } : {}),
              ...(body ? { 'content-type': 'application/json' } : {}),
            },
            ...(body ? { body: JSON.stringify(body) } : {}),
            signal: abort.signal,
            redirect: 'error',
          })
        } catch {
          if (abort.signal.aborted) throw new Error('aborted')
          throw new Error(`Web preview is unavailable at ${url}; start beyond-simulator-web and check --web-url / QXQY_WEB_URL`)
        }
        if (response.status === 401 || response.status === 403) {
          await response.body?.cancel()
          throw new Error(`Web preview authentication/access failed (HTTP ${response.status}); check QXQY_WEB_PASSWORD in both processes`)
        }
        if (response.status === 404) {
          await response.body?.cancel()
          throw new Error('Web preview API is unavailable (HTTP 404); update and restart beyond-simulator-web')
        }
        let result
        try { result = await response.json() } catch {
          if (abort.signal.aborted) throw new Error('aborted')
          throw new Error('Web preview returned invalid JSON; verify --web-url and update beyond-simulator-web')
        }
        if (!response.ok || result?.ok !== true) {
          throw new Error(`Web preview request failed (HTTP ${response.status}): ${redact(result?.error || 'invalid API response')}`)
        }
        return result.value
      }
      return await run(request, url)
    } catch (error) {
      if (signal?.aborted) throw new Error('Web preview request cancelled')
      if (timedOut) throw new Error(`Web preview timed out after ${timeout}ms at ${url}; check the Web process, then use qxqy_preview_status to confirm its state`)
      throw new Error(redact(error?.message || error))
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    }
  }

  function receipt(value, url, status) {
    if (value?.service !== SERVICE) {
      throw new Error(`Web preview service mismatch at ${url}; expected ${SERVICE}. Check --web-url and update/restart beyond-simulator-web`)
    }
    let matches = false
    try { matches = canonicalWorkspace(value.workspace) === canonicalWorkspace(workspaceRoot) } catch { /* Treat unavailable paths as mismatches. */ }
    if (!matches) {
      throw new Error(`Web preview workspace mismatch: MCP uses ${workspaceRoot}; Web reports ${String(value.workspace || '(missing)')}. Start both processes with the same --workspace`)
    }
    return {
      status,
      url,
      service: value.service,
      version: value.version || '',
      workspace: workspaceRoot,
      activePath: value.activePath || '',
      name: value.name ?? value.snapshot?.save?.name ?? '',
      revision: value.revision ?? value.snapshot?.version ?? null,
      lastError: value.lastError || '',
      lastLoadedAt: value.lastLoadedAt || '',
    }
  }

  return {
    status(signal) {
      return operation(signal, async (request, url) => receipt(await request('/api/preview'), url, 'connected'))
    },
    open(path, signal) {
      const absolute = resolveWorkspaceFile(workspaceRoot, path)
      const requestedPath = relative(workspaceRoot, absolute).replaceAll('\\', '/')
      return operation(signal, async (request, url) => {
        receipt(await request('/api/preview'), url, 'connected')
        const value = await request('/api/open', { path: requestedPath, expectedWorkspace: workspaceRoot })
        const result = receipt(value, url, 'opened')
        if (result.activePath !== requestedPath) throw new Error('Web preview did not confirm the requested archive; use qxqy_preview_status to inspect its state')
        return { ...result, requestedPath }
      })
    },
  }
}
