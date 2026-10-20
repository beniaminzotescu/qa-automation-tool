import type { ApiCall, ApiState } from '../../../../shared/api'

interface Props {
  projectId: string
  state: ApiState
  selectedId: string | null
  onOpen(call: ApiCall): void
  onSwitchToUi(): void
}

/** Capture the website's calls, and the list of calls (captured and sent). Click one to open it. */
export default function ApiCallsPanel({ projectId, state, selectedId, onOpen, onSwitchToUi }: Props) {
  async function clear(): Promise<void> {
    if (window.confirm('Remove all calls from the list?')) await window.api.clearApiCalls(projectId)
  }

  return (
    <>
      <h2>API</h2>
      <div className="action-buttons">
        <button
          className={state.capturing ? 'button record-button recording' : 'button record-button'}
          onClick={() => window.api.setApiCapturing(projectId, !state.capturing)}
        >
          {state.capturing ? '■ Stop capturing' : '● Capture API calls'}
        </button>
        {state.capturing && (
          <p className="small muted">
            Now use the application in{' '}
            <button className="button link small" onClick={onSwitchToUi}>
              UI tests
            </button>
            : every call it makes appears below.
          </p>
        )}
      </div>

      <h3>
        Calls <span className="muted small">({state.calls.length})</span>
      </h3>
      <div className="steps-scroll">
        {state.calls.length === 0 ? (
          <p className="small muted">Calls you send, and calls captured from the application, appear here.</p>
        ) : (
          <ul className="api-calls">
            {state.calls.map((call) => (
              <li key={call.id}>
                <button className={call.id === selectedId ? 'api-call selected' : 'api-call'} onClick={() => onOpen(call)}>
                  <span className={`api-method-badge ${call.request.method.toLowerCase()}`}>{call.request.method}</span>
                  <span className="api-call-path mono" title={call.request.url}>
                    {pathOf(call.request.url)}
                  </span>
                  <span className={`api-call-status ${statusTone(call)}`}>{call.response.error ? '—' : call.response.status}</span>
                  <span className="api-call-meta small muted">
                    {call.source === 'captured' ? 'captured' : 'sent'} · {new Date(call.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {state.calls.length > 0 && (
        <button className="button link small muted" onClick={clear}>
          Clear the list
        </button>
      )}
    </>
  )
}

function pathOf(url: string): string {
  try {
    const parsed = new URL(url)
    return parsed.pathname
  } catch {
    return url
  }
}

function statusTone(call: ApiCall): string {
  if (call.response.error) return 'error'
  return call.response.status < 300 ? 'ok' : call.response.status < 400 ? 'redirect' : 'error'
}
