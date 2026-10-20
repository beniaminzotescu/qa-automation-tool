import { useEffect, useState, type FormEvent } from 'react'
import type { InspectResult, RepoConfig, SshKeyStatus } from '../../../shared/api'

interface Props {
  /** Called after the repository changed, so the app prepares the new one. */
  onRepoChanged(): void
}

const SSH_PATTERN = /^(ssh:\/\/|[\w.-]+@[\w.-]+:)/

/** Where the automation framework comes from: a folder on this computer, or a clone. And the SSH key. */
export default function RepositoryScreen({ onRepoChanged }: Props) {
  const [config, setConfig] = useState<RepoConfig | null>(null)
  const [key, setKey] = useState<SshKeyStatus | null>(null)
  const [baseBranch, setBaseBranch] = useState<string | null>(null)

  useEffect(() => {
    window.api.getRepoConfig().then(setConfig)
    window.api.getSshKey().then(setKey)
    window.api.getPrepareStatus().then((status) => setBaseBranch(status.project?.baseBranch ?? null))
  }, [])

  if (!config || !key) return null

  return (
    <section className="narrow">
      <h1>Repository</h1>
      <p className="lead">
        The automation framework your tests are translated into. The app learns the team's standards from it. It works
        in its own copy and never changes your files.
      </p>

      <div className="card">
        <h2>In use now</h2>
        {config.localFolder ? (
          <p>
            The folder <span className="mono">{config.localFolder}</span> on this computer.
          </p>
        ) : config.url ? (
          <p>
            A copy of <span className="mono">{config.url}</span>.
          </p>
        ) : (
          <p>Nothing yet. Choose a folder or clone a repository below.</p>
        )}
        {baseBranch && (
          <p className="small muted">
            New tests start from the branch <strong>{baseBranch}</strong> (the first of develop, main and master, or
            the repository's default branch).
          </p>
        )}
      </div>

      <LocalFolderCard
        config={config}
        onChanged={(next) => {
          setConfig(next)
          onRepoChanged()
        }}
      />
      <SshKeyCard status={key} onChange={setKey} />
      <CloneCard
        config={config}
        hasKey={key.hasKey}
        onCloned={async () => {
          setConfig(await window.api.getRepoConfig())
          onRepoChanged()
        }}
      />
    </section>
  )
}

export function LocalFolderCard({ config, onChanged }: { config: RepoConfig; onChanged(config: RepoConfig): void }) {
  const [check, setCheck] = useState<InspectResult | null>(null)

  async function choose(): Promise<void> {
    const path = await window.api.chooseFolder()
    if (!path) return
    const inspection = await window.api.inspectFolder(path)
    setCheck(inspection)
    if (inspection.ok) onChanged(await window.api.useLocalFolder(path))
  }

  return (
    <div className="card">
      <h2>A folder on this computer</h2>
      <p>You already have the framework on this computer, for example cloned with your own git tools.</p>
      <div className="actions">
        <button className="button secondary" onClick={choose}>
          {config.localFolder ? 'Choose another folder…' : 'Choose folder…'}
        </button>
      </div>
      {check && !check.ok && (
        <ul className="problems">
          {check.problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function SshKeyCard({ status, onChange }: { status: SshKeyStatus; onChange(status: SshKeyStatus): void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  async function run(action: () => Promise<{ ok: true; status: SshKeyStatus } | { ok: false; message: string } | null>): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      const result = await action()
      if (!result) return
      if (result.ok) onChange(result.status)
      else setError(result.message)
    } finally {
      setBusy(false)
    }
  }

  async function remove(): Promise<void> {
    if (!window.confirm('Remove the SSH key from this app? Your Azure DevOps or GitHub account keeps the public key until you remove it there.')) return
    onChange(await window.api.removeSshKey())
  }

  async function copy(): Promise<void> {
    if (!status.publicKey) return
    await navigator.clipboard.writeText(status.publicKey)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="card">
      <h2>Your SSH key</h2>
      <p>
        Lets the app clone the repository with your own Azure DevOps or GitHub account, and later push your tests and
        open pull requests. The key stays on this computer.
      </p>

      {status.hasKey && status.publicKey ? (
        <>
          <label className="field-label">Your public key</label>
          <textarea className="textarea mono small public-key" readOnly rows={4} value={status.publicKey} />
          <div className="actions">
            <button className="button primary" onClick={copy}>
              {copied ? 'Copied' : 'Copy public key'}
            </button>
            <button className="button secondary" disabled={busy} onClick={() => run(() => window.api.importSshKey())}>
              Use another key…
            </button>
            <button className="button link danger" onClick={remove}>
              Remove
            </button>
          </div>
          <div className="explain">
            <strong>Add the public key to your account (once)</strong>
            <p>
              <strong>Azure DevOps:</strong> your picture (top right) → User settings → SSH public keys → + New Key →
              paste → Add.
              <br />
              <strong>GitHub:</strong> your picture → Settings → SSH and GPG keys → New SSH key → paste → Add.
            </p>
          </div>
        </>
      ) : (
        <div className="actions">
          <button className="button primary" disabled={busy} onClick={() => run(() => window.api.createSshKey())}>
            {busy ? 'Working…' : 'Create a new key'}
          </button>
          <button className="button secondary" disabled={busy} onClick={() => run(() => window.api.importSshKey())}>
            Use my own private key…
          </button>
        </div>
      )}
      {error && <p className="message error">{error}</p>}
    </div>
  )
}

export function CloneCard({ config, hasKey, onCloned }: { config: RepoConfig; hasKey: boolean; onCloned(): void }) {
  const [url, setUrl] = useState(config.url ?? '')
  const [token, setToken] = useState('')
  const [checking, setChecking] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const ssh = SSH_PATTERN.test(url.trim())

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault()
    setChecking(true)
    setMessage(null)
    try {
      const result = await window.api.saveRepoConfig(url, token)
      if (result.ok) {
        setToken('')
        setMessage({ ok: true, text: 'Access works. The app now prepares its copy; open the Studio to follow it.' })
        onCloned()
      } else {
        setMessage({ ok: false, text: result.message })
      }
    } finally {
      setChecking(false)
    }
  }

  return (
    <form className="card form" onSubmit={submit}>
      <h2>Clone a repository</h2>
      <p>Paste the address from the repository's Clone button in Azure DevOps or GitHub.</p>
      <div className="field">
        <label htmlFor="repo-url">Repository address</label>
        <input
          id="repo-url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="git@ssh.dev.azure.com:v3/organisation/project/repository"
          spellCheck={false}
        />
        <div className="field-hint">
          {ssh
            ? hasKey
              ? 'SSH address: the app uses your SSH key (above).'
              : 'SSH address: create or add your SSH key above first.'
            : 'For an https:// address, the app needs a read-only token instead of an SSH key.'}
        </div>
      </div>
      {!ssh && url.trim() !== '' && (
        <div className="field">
          <label htmlFor="repo-token">Read-only token</label>
          <input
            id="repo-token"
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder={config.hasToken ? 'Saved. Paste a new one to replace it.' : 'Azure DevOps Personal Access Token (Code: Read)'}
            autoComplete="off"
          />
        </div>
      )}
      {message && <p className={message.ok ? 'message success' : 'message error'}>{message.text}</p>}
      <div className="actions">
        <button className="button primary" type="submit" disabled={checking || !url.trim() || (ssh && !hasKey)}>
          {checking ? 'Checking access…' : 'Check access and clone'}
        </button>
      </div>
    </form>
  )
}
