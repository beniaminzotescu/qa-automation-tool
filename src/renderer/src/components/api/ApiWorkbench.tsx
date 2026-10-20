import { useMemo, useState, type KeyboardEvent } from 'react'
import type { ApiCall, ApiRequest, ApiState, KeyValue } from '../../../../shared/api'
import JsonTree from './JsonTree'

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']

export function emptyRequest(): ApiRequest {
  return { method: 'GET', url: '', query: [], headers: [], body: '', useSession: true }
}

interface Props {
  projectId: string
  state: ApiState
  request: ApiRequest
  onRequestChange(request: ApiRequest): void
  result: ApiCall | null
  onResult(call: ApiCall): void
}

/** Write a call (or open one from the list), send it, and read the answer. */
export default function ApiWorkbench({ projectId, state, request, onRequestChange, result, onResult }: Props) {
  const [tab, setTab] = useState<'params' | 'body' | 'headers'>('params')
  const [sending, setSending] = useState(false)
  const set = (changes: Partial<ApiRequest>): void => onRequestChange({ ...request, ...changes })

  async function send(): Promise<void> {
    if (!request.url.trim() || sending) return
    setSending(true)
    try {
      onResult(await window.api.sendApiRequest(projectId, request))
    } finally {
      setSending(false)
    }
  }

  function onUrlKey(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Enter') void send()
  }

  const bodyProblem = useMemo(() => jsonProblem(request.body), [request.body])

  return (
    <div className="api-workbench">
      <div className="api-request-line">
        <select className={`api-method ${request.method.toLowerCase()}`} value={request.method} onChange={(e) => set({ method: e.target.value })}>
          {METHODS.map((m) => (
            <option key={m}>{m}</option>
          ))}
        </select>
        <input
          className="api-url mono"
          value={request.url}
          placeholder={state.baseUrl ? `/path (after ${state.baseUrl})` : 'https://…'}
          spellCheck={false}
          onChange={(e) => set({ url: e.target.value })}
          onKeyDown={onUrlKey}
        />
        <button className="button primary" disabled={!request.url.trim() || sending} onClick={send}>
          {sending ? 'Sending…' : 'Send'}
        </button>
      </div>

      <div className="api-request-options">
        <div className="panel-tabs">
          <TabButton current={tab} tab="params" onSelect={setTab} count={request.query.filter((q) => q.key).length}>
            Params
          </TabButton>
          <TabButton current={tab} tab="body" onSelect={setTab} count={request.body.trim() ? 1 : 0}>
            Body
          </TabButton>
          <TabButton current={tab} tab="headers" onSelect={setTab} count={request.headers.filter((h) => h.key).length}>
            Headers
          </TabButton>
        </div>
        <label className="api-session" title="Sends the login of the live browser (its token and cookies). Log in there first.">
          <input type="checkbox" checked={request.useSession} onChange={(e) => set({ useSession: e.target.checked })} />
          Use my login from the browser
        </label>
      </div>

      <div className="api-request-body">
        {tab === 'params' && <KeyValueTable rows={request.query} onChange={(query) => set({ query })} keyLabel="Name" />}
        {tab === 'headers' && <KeyValueTable rows={request.headers} onChange={(headers) => set({ headers })} keyLabel="Header" />}
        {tab === 'body' && (
          <>
            <textarea
              className="textarea mono api-body"
              rows={7}
              value={request.body}
              spellCheck={false}
              placeholder={'{\n  "name": "Test item"\n}'}
              onChange={(e) => set({ body: e.target.value })}
            />
            {bodyProblem && <div className="small api-body-problem">{bodyProblem}</div>}
          </>
        )}
      </div>

      <ResponseView call={result} sending={sending} />
    </div>
  )
}

function TabButton({
  current,
  tab,
  onSelect,
  count,
  children
}: {
  current: string
  tab: 'params' | 'body' | 'headers'
  onSelect(tab: 'params' | 'body' | 'headers'): void
  count: number
  children: string
}) {
  return (
    <button className={current === tab ? 'panel-tab active' : 'panel-tab'} onClick={() => onSelect(tab)}>
      {children}
      {count > 0 && <span className="muted"> ({count})</span>}
    </button>
  )
}

/** Rows of name and value, with an empty row at the end to add one. */
function KeyValueTable({ rows, onChange, keyLabel }: { rows: KeyValue[]; onChange(rows: KeyValue[]): void; keyLabel: string }) {
  const shown = [...rows, { key: '', value: '', enabled: true }]
  function update(index: number, changes: Partial<KeyValue>): void {
    const next = shown.map((row, i) => (i === index ? { ...row, ...changes } : row))
    onChange(next.filter((row, i) => row.key || row.value || i < rows.length).filter((row) => row.key || row.value))
  }
  return (
    <table className="kv-table">
      <tbody>
        {shown.map((row, index) => (
          <tr key={index}>
            <td className="kv-check">
              {index < rows.length && (
                <input type="checkbox" checked={row.enabled} title="Send this one" onChange={(e) => update(index, { enabled: e.target.checked })} />
              )}
            </td>
            <td>
              <input value={row.key} placeholder={keyLabel} spellCheck={false} onChange={(e) => update(index, { key: e.target.value })} />
            </td>
            <td>
              <input value={row.value} placeholder="Value" spellCheck={false} onChange={(e) => update(index, { value: e.target.value })} />
            </td>
            <td className="kv-remove">
              {index < rows.length && (
                <button className="button link small" title="Remove" onClick={() => onChange(rows.filter((_, i) => i !== index))}>
                  ✕
                </button>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function ResponseView({ call, sending }: { call: ApiCall | null; sending: boolean }) {
  const [tab, setTab] = useState<'body' | 'headers'>('body')
  const parsed = useMemo(() => {
    if (!call?.response.body) return undefined
    try {
      return JSON.parse(call.response.body) as unknown
    } catch {
      return undefined
    }
  }, [call])

  if (sending) return <div className="api-response empty">Waiting for the answer…</div>
  if (!call) {
    return (
      <div className="api-response empty">
        <p>Send a call to see the answer here.</p>
        <p className="small muted">
          Don't know the address? Turn on <strong>Capture API calls</strong>, switch to UI tests and use the application:
          the calls it makes appear in the list on the right.
        </p>
      </div>
    )
  }

  const { response } = call
  const tone = response.error ? 'error' : response.status < 300 ? 'ok' : response.status < 400 ? 'redirect' : 'error'

  return (
    <div className="api-response">
      <div className="api-status-line">
        <span className={`api-status ${tone}`}>
          {response.error ? 'No answer' : `${response.status} ${response.statusText}`}
        </span>
        <span className="muted small">
          {response.timeMs} ms · {formatSize(response.size)}
        </span>
        <div className="panel-tabs api-response-tabs">
          <button className={tab === 'body' ? 'panel-tab active' : 'panel-tab'} onClick={() => setTab('body')}>
            Answer
          </button>
          <button className={tab === 'headers' ? 'panel-tab active' : 'panel-tab'} onClick={() => setTab('headers')}>
            Headers ({Object.keys(response.headers).length})
          </button>
        </div>
      </div>
      <div className="api-response-body">
        {response.error && <p className="message error">{response.error}</p>}
        {!response.error && tab === 'body' &&
          (parsed !== undefined ? <JsonTree value={parsed} /> : <pre className="api-raw mono">{response.body || '(empty)'}</pre>)}
        {!response.error && tab === 'headers' && (
          <table className="kv-table readonly">
            <tbody>
              {Object.entries(response.headers).map(([key, value]) => (
                <tr key={key}>
                  <td className="mono">{key}</td>
                  <td className="mono">{value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

function jsonProblem(body: string): string | null {
  const text = body.trim()
  if (!text || !/^[[{]/.test(text)) return null
  try {
    JSON.parse(text)
    return null
  } catch (error) {
    return `This is not valid JSON yet: ${(error as Error).message}`
  }
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
