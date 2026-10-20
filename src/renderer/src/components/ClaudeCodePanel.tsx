import { useEffect, useState } from 'react'
import { LINKS, type ClaudeCodeStatus } from '../../../shared/api'

interface Props {
  /** null while a check is running. */
  status: ClaudeCodeStatus | null
  onRecheck(): void
}

const INSTALL_COMMAND = 'irm https://claude.ai/install.ps1 | iex'

export default function ClaudeCodePanel({ status, onRecheck }: Props) {
  const [loginOpened, setLoginOpened] = useState(false)
  const [loginError, setLoginError] = useState<string | null>(null)

  // The user installs or signs in outside the app, so check again when they come back to it.
  useEffect(() => {
    if (status?.state === 'ready') return
    window.addEventListener('focus', onRecheck)
    return () => window.removeEventListener('focus', onRecheck)
  }, [status?.state, onRecheck])

  async function signIn(): Promise<void> {
    setLoginError(null)
    try {
      await window.api.openClaudeLogin()
      setLoginOpened(true)
    } catch {
      setLoginError('Could not open the sign-in window. Open Claude Code and sign in there.')
    }
  }

  if (!status) return <div className="status-box neutral">Checking Claude Code…</div>

  switch (status.state) {
    case 'ready':
      return (
        <div className="status-box ok">
          <span>
            Connected{status.account && <> as <strong>{status.account}</strong></>}
            {status.plan && <> ({formatPlan(status.plan)} plan)</>}
          </span>
          <span className="status-detail">Claude Code {status.version}</span>
        </div>
      )

    case 'signed-out':
      return (
        <div className="panel">
          <div className="status-box neutral">Claude Code is installed, but you are not signed in.</div>
          <ol className="steps">
            <li>
              Click <strong>Sign in</strong>. A window opens.
            </li>
            <li>Follow the steps in that window to sign in with your Claude account.</li>
            <li>Come back here. The app checks again on its own.</li>
          </ol>
          <div className="actions">
            <button className="button primary" onClick={signIn}>
              Sign in
            </button>
            <button className="button secondary" onClick={onRecheck}>
              Check again
            </button>
          </div>
          {loginOpened && (
            <p className="message neutral">The sign-in window is open. Come back here when you are done.</p>
          )}
          {loginError && <p className="message error">{loginError}</p>}
        </div>
      )

    case 'not-installed':
      return (
        <div className="panel">
          <div className="status-box neutral">Claude Code is not installed on this computer.</div>
          <ol className="steps">
            <li>
              Open <strong>PowerShell</strong> from the Start menu.
            </li>
            <li>
              Paste this line and press Enter:
              <CopyLine text={INSTALL_COMMAND} />
            </li>
            <li>When it finishes, come back here and click <strong>Check again</strong>.</li>
          </ol>
          <div className="actions">
            <button className="button primary" onClick={onRecheck}>
              Check again
            </button>
          </div>
          <p className="hint">
            Other ways to install are in the{' '}
            <a href={LINKS.claudeCodeSetup} target="_blank" rel="noreferrer">
              Claude Code setup guide
            </a>
            .
          </p>
        </div>
      )

    case 'error':
      return (
        <div className="panel">
          <p className="message error">{status.message}</p>
          <div className="actions">
            <button className="button secondary" onClick={onRecheck}>
              Check again
            </button>
          </div>
        </div>
      )
  }
}

function CopyLine({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  async function copy(): Promise<void> {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <span className="copy-line">
      <code>{text}</code>
      <button className="button secondary small" onClick={copy}>
        {copied ? 'Copied' : 'Copy'}
      </button>
    </span>
  )
}

function formatPlan(plan: string): string {
  return plan.charAt(0).toUpperCase() + plan.slice(1)
}
