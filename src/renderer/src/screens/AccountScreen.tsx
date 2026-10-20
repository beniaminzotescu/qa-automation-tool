import { useEffect, useState, type FormEvent } from 'react'
import type { Account } from '../../../shared/api'

interface Props {
  onSaved(): void
}

/** "Your environment": the tester's own tenant (application link) and account. */
export default function AccountScreen({ onSaved }: Props) {
  const [account, setAccount] = useState<Account | null | undefined>(undefined)
  const [appUrl, setAppUrl] = useState('')
  const [apiUrl, setApiUrl] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    window.api.getAccount().then((saved) => {
      setAccount(saved)
      if (saved) {
        setAppUrl(saved.appUrl)
        setApiUrl(saved.apiUrl)
        setUsername(saved.username)
      }
    })
  }, [])

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const result = await window.api.saveAccount({ appUrl, apiUrl, username, password })
      if (!result.ok) {
        setError(result.message)
        return
      }
      setPassword('')
      onSaved()
    } finally {
      setSaving(false)
    }
  }

  if (account === undefined) return null

  return (
    <section className="narrow">
      <h1>Your environment</h1>
      <p className="lead">
        The application you test, on your own tenant, and your account there. Your tests run here, so they don't
        disturb anyone else.
      </p>

      <form className="card form" onSubmit={submit}>
        <div className="field">
          <label htmlFor="app-url">UI link</label>
          <div className="field-hint">The address you open in the browser to use the application.</div>
          <input id="app-url" value={appUrl} onChange={(e) => setAppUrl(e.target.value)} placeholder="https://…" spellCheck={false} />
        </div>
        <div className="field">
          <label htmlFor="api-url">API link (optional)</label>
          <div className="field-hint">
            The address of the application's API (back end), if it has a separate one. Tests use it to prepare and
            clean up their data.
          </div>
          <input id="api-url" value={apiUrl} onChange={(e) => setApiUrl(e.target.value)} placeholder="https://…" spellCheck={false} />
        </div>
        <div className="field">
          <label htmlFor="username">Username (optional)</label>
          <div className="field-hint">Only if the application has a login.</div>
          <input id="username" value={username} onChange={(e) => setUsername(e.target.value)} spellCheck={false} />
        </div>
        <div className="field">
          <label htmlFor="password">Password (optional)</label>
          <div className="row">
            <input
              id="password"
              type={showPassword ? 'text' : 'password'}
              value={password}
              placeholder={account?.hasPassword ? 'Saved. Type a new one to change it.' : ''}
              autoComplete="off"
              onChange={(e) => setPassword(e.target.value)}
            />
            <button type="button" className="button secondary small" onClick={() => setShowPassword(!showPassword)}>
              {showPassword ? 'Hide' : 'Show'}
            </button>
          </div>
          <div className="field-hint">
            Kept on this computer. Used to log in again automatically if your session ends.
          </div>
        </div>

        <div className="explain">
          <strong>Logging in</strong>
          <p>
            After you save, the application opens in the live browser. If it has a login, log in there once, the way
            you always do. The app remembers it.
          </p>
        </div>

        {error && <p className="message error">{error}</p>}
        <div className="actions">
          <button className="button primary" type="submit" disabled={saving || !appUrl}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </section>
  )
}
