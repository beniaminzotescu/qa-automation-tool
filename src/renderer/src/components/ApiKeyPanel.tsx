import { useState, type FormEvent } from 'react'
import { LINKS, type ApiKeyStatus } from '../../../shared/api'

interface Props {
  status: ApiKeyStatus
  onStatusChange(status: ApiKeyStatus): void
}

export default function ApiKeyPanel({ status, onStatusChange }: Props) {
  const [key, setKey] = useState('')
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault()
    setChecking(true)
    setError(null)
    setSaved(false)
    try {
      const result = await window.api.saveApiKey(key)
      if (result.ok) {
        setKey('')
        setSaved(true)
        onStatusChange(result.status)
      } else {
        setError(result.message)
      }
    } catch {
      setError('Something went wrong while saving the key. Try again.')
    } finally {
      setChecking(false)
    }
  }

  async function handleRemove(): Promise<void> {
    setSaved(false)
    onStatusChange(await window.api.removeApiKey())
  }

  return (
    <div className="panel">
      {status.hasKey ? (
        <div className="status-box ok">
          <span>
            Key saved (ends in <strong>{status.hint}</strong>)
          </span>
          <button className="button link" onClick={handleRemove}>
            Remove
          </button>
        </div>
      ) : (
        <div className="status-box neutral">No key saved yet.</div>
      )}

      <form onSubmit={handleSubmit} className="key-form">
        <label htmlFor="api-key">{status.hasKey ? 'Replace with a new key' : 'Paste your key'}</label>
        <div className="row">
          <input
            id="api-key"
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="sk-ant-…"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            disabled={checking}
          />
          <button className="button primary" type="submit" disabled={checking || !key.trim()}>
            {checking ? 'Checking…' : 'Check and save'}
          </button>
        </div>
        {error && <p className="message error">{error}</p>}
        {saved && <p className="message success">The key works and is saved.</p>}
      </form>

      <p className="hint">
        The key is stored encrypted on this computer and is only sent to Claude. No key yet? Ask your
        admin, or create one in the{' '}
        <a href={LINKS.consoleApiKeys} target="_blank" rel="noreferrer">
          Claude Console
        </a>{' '}
        under <strong>API keys</strong>.
      </p>
    </div>
  )
}
