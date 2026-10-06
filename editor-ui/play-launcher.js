// Known Desktop pages use the modal directly. Other hosts can try a popup
// synchronously while the click still has user activation.
function closePopup(popup) {
  try { popup?.close() } catch { /* A host can revoke access to the window. */ }
}

export function preparePlayPopup() {
  if (window.location.protocol === 'dsh-app:') return null
  let popup
  try {
    popup = window.open('about:blank', '_blank')
    if (!popup || popup.closed) return null
    popup.document.write('<!doctype html><meta charset="utf-8"><title>正在准备试玩…</title><p>正在保存项目并准备试玩…</p>')
    return popup
  } catch {
    closePopup(popup)
    return null
  }
}

export function createPlayLauncher(React) {
  const e = React.createElement
  // Returning to the same Harness session can remount the editor before its
  // previous frame has finished stopping. Join that cleanup before launching.
  const stopping = new Map()

  function EmbeddedPlay({ entry, api, onClosed }) {
    const dialogRef = React.useRef(null)
    const lifetime = React.useRef(null)
    const [closing, setClosing] = React.useState(false)
    const [error, setError] = React.useState('')
    const [loaded, setLoaded] = React.useState(false)

    React.useLayoutEffect(() => {
      // A fresh effect lifetime also handles React StrictMode's setup/cleanup
      // replay; an old disposer must not mark a replacement frame as closing.
      const state = { closing: false, stopped: false, pending: null, controller: null, requests: new Set() }
      lifetime.current = state
      const dialog = dialogRef.current
      const frame = dialog.querySelector('iframe')
      let mounted = true
      // Start and other in-frame requests must settle before the final stop.
      // No delayed iframe load may start play after closing has begun.
      const stop = () => {
        if (state.stopped) return Promise.resolve()
        state.closing = true
        if (!state.controller) { state.stopped = true; return Promise.resolve() }
        if (!state.pending) {
          const pending = (async () => {
            state.controller?.quiesce()
            // These promises belong to the parent, so iframe destruction on
            // React unmount cannot abandon the drain or the final stop.
            await Promise.allSettled([...state.requests])
            await api(entry.sessionId, 'play', { action: 'stop', args: {} })
            state.stopped = true
          })().finally(() => {
            state.pending = null
            if (stopping.get(entry.sessionId) === pending) stopping.delete(entry.sessionId)
          })
          state.pending = pending
          stopping.set(entry.sessionId, pending)
        }
        return state.pending
      }
      state.close = async () => {
        if (state.pending || state.stopped) return
        setClosing(true); setError('')
        try {
          await stop()
          if (mounted) onClosed()
        } catch (reason) {
          if (mounted) { setError(`停止试玩失败，请重试：${reason?.message || reason}`); setClosing(false) }
        }
      }
      const receive = event => {
        if (event.source !== frame.contentWindow || event.data?.type !== 'qxqy-play-close'
          || event.data.sessionId !== entry.sessionId) return
        void state.close()
      }
      const cancel = event => { event.preventDefault(); void state.close() }
      window.addEventListener('message', receive)
      dialog.addEventListener('cancel', cancel)
      dialog.showModal()
      return () => {
        mounted = false
        window.removeEventListener('message', receive)
        dialog.removeEventListener('cancel', cancel)
        dialog.close()
        // A Harness view/session switch can unmount us without a close click.
        // Keep this promise alive; it uses the captured old session, never the new one.
        void stop().catch(reason => console.error('Embedded play cleanup failed', reason))
        if (entry.returnFocus?.isConnected) entry.returnFocus.focus()
      }
    }, [entry, api, onClosed])

    function onLoad(event) {
      const state = lifetime.current
      if (state.closing) return
      try {
        const frame = event.currentTarget
        const controller = frame.contentWindow?.qxqyEmbeddedPlay
        if (!controller) throw new Error('试玩页未能加载，请返回编辑后重试。')
        state.controller = controller
        setLoaded(true)
        frame.focus()
        controller.focus()
        const request = (action, args = {}) => {
          if (state.closing) return Promise.reject(new Error('试玩正在关闭'))
          const pending = api(entry.sessionId, 'play', { action, args })
          state.requests.add(pending)
          pending.then(() => state.requests.delete(pending), () => state.requests.delete(pending))
          return pending
        }
        void controller.start(request).catch(reason => { if (!state.closing) setError(reason?.message || String(reason)) })
      } catch (reason) { setError(reason?.message || String(reason)) }
    }

    return e('dialog', { ref: dialogRef, className: 'qxsim-play-overlay', 'aria-label': '内嵌试玩', 'aria-modal': true },
      e('header', { className: 'qxsim-play-header' },
        e('span', { role: 'status' }, closing ? '正在停止试玩…' : loaded ? '内嵌试玩' : '正在载入试玩…'),
        e('button', { className: 'qxsim-action', type: 'button', disabled: closing, onClick: () => void lifetime.current?.close?.() }, '关闭试玩')),
      error ? e('div', { className: 'qxsim-play-error', role: 'alert' }, error) : null,
      e('iframe', { title: '千星沙箱试玩', src: entry.url, onLoad, tabIndex: 0 }))
  }

  return function usePlayLauncher({ sessionId, api, playUrl, onError }) {
    const scopeRef = React.useRef(null)
    const [opening, setOpening] = React.useState(false)
    const [embedded, setEmbedded] = React.useState(null)
    const closeEmbedded = React.useCallback(() => setEmbedded(null), [])
    React.useEffect(() => {
      const scope = { active: true, pending: false, popup: null }
      scopeRef.current = scope
      setOpening(false); setEmbedded(null)
      return () => { scope.active = false; closePopup(scope.popup) }
    }, [sessionId])

    async function open(prepare) {
      const scope = scopeRef.current
      if (!scope?.active || scope.pending || embedded) return
      scope.pending = true
      const returnFocus = document.activeElement
      setOpening(true)
      try {
        let popup = preparePlayPopup()
        scope.popup = popup
        await stopping.get(sessionId)
        if (!scope.active) return
        await prepare()
        if (!scope.active) return
        const url = new URL(playUrl(sessionId), window.location.href)
        if (popup) {
          try {
            if (popup.closed) throw new Error('Play window closed')
            popup.location.replace(url.href)
          } catch {
            closePopup(popup)
            popup = null
          }
          scope.popup = null // An independent play tab outlives this editor view.
        }
        if (!popup) {
          url.searchParams.set('embedded', '1')
          setEmbedded({ sessionId, url: url.href, returnFocus })
        }
      } catch (reason) {
        closePopup(scope.popup); scope.popup = null
        if (scope.active) onError(reason?.message || String(reason))
      } finally {
        scope.pending = false
        if (scope.active) setOpening(false)
      }
    }

    return {
      open, opening,
      overlay: embedded?.sessionId === sessionId ? e(EmbeddedPlay, { key: sessionId, entry: embedded, api, onClosed: closeEmbedded }) : null,
    }
  }
}
