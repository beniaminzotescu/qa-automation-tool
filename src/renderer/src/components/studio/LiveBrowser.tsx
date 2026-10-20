import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type WheelEvent } from 'react'
import type { BrowserState } from '../../../../shared/api'

// The live browser: frames from the app's Chromium, drawn here, with the tester's mouse and
// keyboard passed back to it. The page inside is sized to exactly this view, so a point here is
// the same point in the page.

const MOVE_INTERVAL_MS = 40

interface Props {
  /** Set while Claude works in the browser: the tester's input is paused. */
  busyLabel: string | null
  /** Shown as a Stop button while busy; null when the work can't be stopped from here. */
  onStop: (() => void) | null
}

export default function LiveBrowser({ busyLabel, onStop }: Props) {
  const [state, setState] = useState<BrowserState | null>(null)
  const [frame, setFrame] = useState<string | null>(null)
  const [loggingIn, setLoggingIn] = useState(false)
  const [loginMessage, setLoginMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const viewRef = useRef<HTMLDivElement>(null)
  const lastMove = useRef(0)
  const pressedButton = useRef<'none' | 'left' | 'middle' | 'right'>('none')

  useEffect(() => {
    const offFrame = window.api.onBrowserFrame((next) => setFrame(`data:image/jpeg;base64,${next.data}`))
    const offState = window.api.onBrowserState(setState)
    window.api.startBrowser().then(setState)
    return () => {
      offFrame()
      offState()
    }
  }, [])

  // The page size follows the size of the view.
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const report = (): void => {
      clearTimeout(timer)
      timer = setTimeout(() => window.api.setBrowserViewport(view.clientWidth, view.clientHeight), 150)
    }
    report()
    const observer = new ResizeObserver(report)
    observer.observe(view)
    return () => {
      clearTimeout(timer)
      observer.disconnect()
    }
  }, [])

  function point(event: MouseEvent | WheelEvent): { x: number; y: number } {
    const rect = viewRef.current!.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }

  function mouse(event: MouseEvent, type: 'mousePressed' | 'mouseReleased' | 'mouseMoved'): void {
    // Claude is working: the tester watches, and can press Stop.
    if (busyLabel) return
    if (type === 'mouseMoved') {
      const now = Date.now()
      if (now - lastMove.current < MOVE_INTERVAL_MS) return
      lastMove.current = now
    }
    if (type === 'mousePressed') {
      viewRef.current?.focus()
      pressedButton.current = BUTTONS[event.button] ?? 'left'
    }
    const button = type === 'mouseMoved' ? pressedButton.current : (BUTTONS[event.button] ?? 'left')
    if (type === 'mouseReleased') pressedButton.current = 'none'
    window.api.browserInput({
      kind: 'mouse',
      type,
      ...point(event),
      button,
      clickCount: type === 'mouseMoved' ? 0 : event.detail || 1,
      modifiers: modifiers(event)
    })
  }

  function key(event: KeyboardEvent, type: 'keyDown' | 'keyUp'): void {
    if (busyLabel) return
    // Paste: the page has no access to this computer's clipboard, so send the text itself.
    if (type === 'keyDown' && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v') {
      event.preventDefault()
      void navigator.clipboard.readText().then((text) => text && window.api.browserInput({ kind: 'text', text }))
      return
    }
    event.preventDefault()
    const printable = event.key.length === 1 && !event.ctrlKey && !event.metaKey
    window.api.browserInput({
      kind: 'key',
      type,
      key: event.key,
      code: event.code,
      keyCode: event.keyCode,
      text: type === 'keyDown' ? (printable ? event.key : event.key === 'Enter' ? '\r' : null) : null,
      modifiers: modifiers(event)
    })
  }

  const loading = state?.loading

  async function logIn(): Promise<void> {
    setLoggingIn(true)
    setLoginMessage(null)
    try {
      const result = await window.api.browserLogin()
      setLoginMessage({ ok: result.ok, text: result.message })
      setTimeout(() => setLoginMessage(null), 6000)
    } finally {
      setLoggingIn(false)
    }
  }

  return (
    <div className="live-browser">
      <div className="browser-bar">
        <button className="button secondary small" title="Back" disabled={!state?.canGoBack} onClick={() => window.api.browserNavigate('back')}>
          ←
        </button>
        <button className="button secondary small" title="Forward" disabled={!state?.canGoForward} onClick={() => window.api.browserNavigate('forward')}>
          →
        </button>
        <button className="button secondary small" title="Reload" onClick={() => window.api.browserNavigate('reload')}>
          ⟳
        </button>
        <button className="button secondary small" title="Your application's start page" onClick={() => window.api.browserNavigate('home')}>
          Home
        </button>
        <button className="button secondary small" title="Log in with Your environment" disabled={loggingIn || !!busyLabel} onClick={logIn}>
          {loggingIn ? 'Logging in…' : 'Log in'}
        </button>
        <span className="browser-url mono" title={state?.url}>
          {loading ? 'Loading… ' : ''}
          {state?.url || ' '}
        </span>
      </div>

      <div
        className={busyLabel ? 'live-view busy' : 'live-view'}
        ref={viewRef}
        tabIndex={0}
        onMouseDown={(e) => mouse(e, 'mousePressed')}
        onMouseUp={(e) => mouse(e, 'mouseReleased')}
        onMouseMove={(e) => mouse(e, 'mouseMoved')}
        onWheel={(e) =>
          !busyLabel && window.api.browserInput({ kind: 'wheel', ...point(e), deltaX: e.deltaX, deltaY: e.deltaY, modifiers: modifiers(e) })
        }
        onKeyDown={(e) => key(e, 'keyDown')}
        onKeyUp={(e) => key(e, 'keyUp')}
        onContextMenu={(e) => e.preventDefault()}
      >
        {frame && <img src={frame} alt="" draggable={false} />}
        {!frame && !state?.error && <div className="live-placeholder">Starting the browser…</div>}
        {state?.error && <div className="live-placeholder error">{state.error}</div>}
        {state?.loginForm && !busyLabel && !loginMessage && (
          <div className="live-login" onMouseDown={(e) => e.stopPropagation()}>
            <span>This looks like a login page.</span>
            <button className="button small primary" disabled={loggingIn} onClick={logIn}>
              {loggingIn ? 'Logging in…' : 'Log in with my environment'}
            </button>
          </div>
        )}
        {loginMessage && (
          <div className={loginMessage.ok ? 'live-login ok' : 'live-login error'}>{loginMessage.text}</div>
        )}
        {busyLabel && (
          <div className="live-busy" onMouseDown={(e) => e.stopPropagation()}>
            <span className="spinner" />
            <span>{busyLabel}</span>
            {onStop && (
              <button className="button small stop-button" onClick={onStop}>
                Stop
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

const BUTTONS: Record<number, 'left' | 'middle' | 'right'> = { 0: 'left', 1: 'middle', 2: 'right' }

/** DevTools modifier bits: Alt 1, Ctrl 2, Meta 4, Shift 8. */
function modifiers(event: { altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }): number {
  return (event.altKey ? 1 : 0) | (event.ctrlKey ? 2 : 0) | (event.metaKey ? 4 : 0) | (event.shiftKey ? 8 : 0)
}
