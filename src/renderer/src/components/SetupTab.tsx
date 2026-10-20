import { useCallback, useEffect, useState } from 'react'
import type { CheckId, CheckResult, FrameworkProfile, Project } from '../../../shared/api'
import FrameworkSummary from './FrameworkSummary'
import TaskLog from './TaskLog'
import { useTaskOutput } from '../useTaskOutput'

interface Props {
  project: Project
  onNext?(): void
  onRemove?(): void
}

export default function SetupTab({ project, onNext, onRemove }: Props) {
  const [profile, setProfile] = useState<FrameworkProfile | null>(null)
  const [checks, setChecks] = useState<CheckResult[] | null>(null)
  const [fixing, setFixing] = useState<CheckId | null>(null)
  const task = useTaskOutput()

  const recheck = useCallback(async () => {
    setChecks(null)
    setChecks(await window.api.runChecks(project.id))
  }, [project.id])

  useEffect(() => {
    window.api.getProfile(project.id).then(setProfile)
    recheck()
  }, [project.id, recheck])

  async function fix(id: CheckId): Promise<void> {
    setFixing(id)
    try {
      setChecks(await window.api.fixCheck(project.id, id, task.start()))
    } finally {
      setFixing(null)
    }
  }

  const ready = checks?.every((check) => check.state === 'ok' || check.state === 'warning')

  return (
    <>
      <p className="lead">
        Connected from <span className="mono">{project.sourcePath}</span>
      </p>

      <div className="card">
        <div className="card-header">
          <h2>Setup checks</h2>
          <button className="button secondary small" onClick={recheck} disabled={!checks || fixing !== null}>
            Check again
          </button>
        </div>
        {!checks ? (
          <p>Checking the setup… The code check can take a minute.</p>
        ) : (
          <>
            {ready && (
              <div className="next-step">
                <span>Everything needed to run tests is ready.</span>
                {onNext && (
                  <button className="button primary" onClick={onNext}>
                    Next
                  </button>
                )}
              </div>
            )}
            <ul className="checks">
              {checks.map((check) => (
                <CheckRow
                  key={check.id}
                  check={check}
                  fixing={fixing === check.id}
                  disabled={fixing !== null}
                  onFix={() => fix(check.id)}
                  log={fixing === check.id ? task.output : ''}
                />
              ))}
            </ul>
          </>
        )}
      </div>

      <div className="card">
        <h2>Framework</h2>
        {profile ? <FrameworkSummary profile={profile} /> : <p>Reading the framework…</p>}
      </div>

      {onRemove && (
        <button className="button link danger" onClick={onRemove}>
          Disconnect this framework
        </button>
      )}
    </>
  )
}

const STATE_ICONS: Record<CheckResult['state'], string> = { ok: '✓', warning: '!', error: '✕', blocked: '…' }

function CheckRow({
  check,
  fixing,
  disabled,
  onFix,
  log
}: {
  check: CheckResult
  fixing: boolean
  disabled: boolean
  onFix(): void
  log: string
}) {
  const [copied, setCopied] = useState(false)

  async function copyCommand(): Promise<void> {
    if (!check.manualCommand) return
    await navigator.clipboard.writeText(check.manualCommand)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <li className={`check ${check.state}`}>
      <span className="check-icon" aria-label={check.state}>
        {STATE_ICONS[check.state]}
      </span>
      <div className="check-body">
        <div className="check-title">{check.title}</div>
        <div className="check-detail">{check.detail}</div>

        {check.manualCommand && (
          <div className="check-manual">
            Install it from PowerShell, then click <strong>Check again</strong>:
            <span className="copy-line">
              <code>{check.manualCommand}</code>
              <button className="button secondary small" onClick={copyCommand}>
                {copied ? 'Copied' : 'Copy'}
              </button>
            </span>
            {check.link && (
              <a href={check.link.url} target="_blank" rel="noreferrer">
                {check.link.label}
              </a>
            )}
          </div>
        )}

        {fixing && <TaskLog text={log || 'Starting…'} />}

        {check.output && !fixing && (
          <details>
            <summary>Show details</summary>
            <pre className="task-log">{check.output}</pre>
          </details>
        )}
      </div>
      {check.fix && (
        <button className="button primary small" onClick={onFix} disabled={disabled}>
          {fixing ? 'Working…' : check.fix.label}
        </button>
      )}
    </li>
  )
}
