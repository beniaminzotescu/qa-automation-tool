import { useEffect, useState } from 'react'
import type { PrepareStatus, PrepareStep, Tool } from '../../../shared/api'

interface Props {
  onReady(): void
  onOpenRepository(): void
}

const ICONS: Record<PrepareStep['state'], string> = { waiting: '', running: '', done: '✓', warning: '!', failed: '✕' }

export default function PreparingScreen({ onReady, onOpenRepository }: Props) {
  const [status, setStatus] = useState<PrepareStatus | null>(null)

  useEffect(() => {
    const unsubscribe = window.api.onPrepareUpdate(setStatus)
    window.api.getPrepareStatus().then((current) => {
      setStatus(current)
      if (current.project) onReady()
      else if (!current.running) window.api.startPrepare()
    })
    return unsubscribe
  }, [onReady])

  useEffect(() => {
    if (status?.project && !status.running) onReady()
  }, [status, onReady])

  if (!status) return null
  const done = status.steps.filter((s) => s.state === 'done' || s.state === 'warning').length
  const notConfigured = status.blocker?.startsWith('No framework is chosen')

  return (
    <section className="narrow">
      <h1>Getting ready</h1>
      <p className="lead">
        The first time, the app prepares everything it needs. This takes a few minutes. You don't have to do anything.
      </p>

      <div className="card">
        {status.running && (
          <div className="progress">
            <div className="progress-bar" style={{ width: `${(done / status.steps.length) * 100}%` }} />
          </div>
        )}
        <ul className="prepare-steps">
          {status.steps.map((step) => (
            <li key={step.id} className={step.state}>
              <span className="prepare-icon">{step.state === 'running' ? <span className="spinner" /> : ICONS[step.state]}</span>
              <div>
                <div>{step.title}</div>
                {step.message && <div className="small muted">{step.message}</div>}
              </div>
            </li>
          ))}
        </ul>

        {status.missingTools.length > 0 && !status.running && <InstallTools tools={status.missingTools} />}

        {status.blocker && !status.running && status.missingTools.length === 0 && (
          <div className="actions">
            {notConfigured ? (
              <button className="button primary" onClick={onOpenRepository}>
                Open Repository
              </button>
            ) : (
              <button className="button primary" onClick={() => window.api.startPrepare()}>
                Try again
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  )
}

const TOOL_NAMES: Record<Tool, string> = { git: 'Git', node: 'Node.js' }

/** Install buttons for missing programs; when all are there, preparing starts again. */
function InstallTools({ tools }: { tools: Tool[] }) {
  const [installing, setInstalling] = useState<Tool | null>(null)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  async function install(tool: Tool): Promise<void> {
    setInstalling(tool)
    setMessage(null)
    try {
      const result = await window.api.installTool(tool)
      setMessage({ ok: result.ok, text: result.message })
      if (result.ok && tools.length === 1) void window.api.startPrepare()
    } finally {
      setInstalling(null)
    }
  }

  return (
    <div className="install-tools">
      <p className="small muted">Windows may ask for permission. Installing takes a few minutes.</p>
      <div className="actions">
        {tools.map((tool) => (
          <button key={tool} className="button primary" disabled={installing !== null} onClick={() => install(tool)}>
            {installing === tool ? `Installing ${TOOL_NAMES[tool]}…` : `Install ${TOOL_NAMES[tool]}`}
          </button>
        ))}
        <button className="button secondary" disabled={installing !== null} onClick={() => window.api.startPrepare()}>
          Check again
        </button>
      </div>
      {message && <p className={message.ok ? 'message success' : 'message error'}>{message.text}</p>}
    </div>
  )
}
