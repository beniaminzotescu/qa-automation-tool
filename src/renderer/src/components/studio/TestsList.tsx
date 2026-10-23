import { useState } from 'react'
import type { Draft, DraftsUpdate } from '../../../../shared/api'

/**
 * The tester's kept tests: run one in the live browser; when it passes, translate it into the
 * framework and send it for review (commit, push, pull request) or export it for the QA team.
 */
export default function TestsList({ projectId, update, busy }: { projectId: string; update: DraftsUpdate | null; busy: boolean }) {
  if (!update) return null
  if (update.drafts.length === 0) {
    return (
      <p className="small muted">
        No tests yet. Record some steps or describe a test in the chat. When a test passes, it is kept here.
      </p>
    )
  }
  return (
    <ul className="tests-list">
      {update.drafts.map((draft) => (
        <TestItem
          key={draft.id}
          projectId={projectId}
          draft={draft}
          running={update.runningDraftIds.includes(draft.id)}
          busy={busy || update.runningDraftIds.length > 0}
        />
      ))}
    </ul>
  )
}

function TestItem({ projectId, draft, running, busy }: { projectId: string; draft: Draft; running: boolean; busy: boolean }) {
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [sending, setSending] = useState(false)
  const translation = draft.translation
  const passed = draft.lastRun?.status === 'passed'

  async function remove(): Promise<void> {
    if (window.confirm(`Remove the test "${draft.name}"?`)) await window.api.deleteDraft(projectId, draft.id)
  }

  async function send(): Promise<void> {
    if (translation && !translation.verified) {
      const sure = window.confirm(
        'The framework version of this test did not run (or did not pass) on this computer.\n\nSend it anyway, marked as "not verified"?'
      )
      if (!sure) return
    }
    setSending(true)
    setMessage(null)
    try {
      const result = await window.api.sendForReview(projectId, draft.id)
      setMessage({ ok: result.ok, text: result.message })
    } finally {
      setSending(false)
    }
  }

  async function exportZip(): Promise<void> {
    const result = await window.api.exportDraft(projectId, draft.id)
    if (result.message !== 'Cancelled.') setMessage({ ok: result.ok, text: result.message })
  }

  return (
    <li className="test-item">
      <div className="test-item-head">
        <span className={`test-badge ${running ? 'running' : (draft.lastRun?.status ?? 'none')}`}>
          {running ? '…' : passed ? '✓' : draft.lastRun?.status === 'failed' ? '✕' : '•'}
        </span>
        <span className="test-name">{draft.name}</span>
        {draft.personal && <span className="personal-badge">Only for me</span>}
      </div>
      {draft.summary && <div className="small muted">{draft.summary}</div>}

      {translation && (
        <div className={translation.verified ? 'translation-status ok' : 'translation-status warn'}>
          {translation.sentAt
            ? `Sent for review${translation.prUrl ? '' : ` (branch ${translation.branch})`}`
            : `In the framework${translation.verified ? ', ran and passed' : ', not verified'}`}
          {translation.prUrl && (
            <>
              {' · '}
              <a href={translation.prUrl} target="_blank" rel="noreferrer">
                pull request page
              </a>
            </>
          )}
        </div>
      )}

      <div className="test-item-actions">
        <button className="button secondary small" disabled={busy} onClick={() => window.api.runDraft(projectId, draft.id)}>
          {running ? 'Running…' : 'Run'}
        </button>
        {passed && !draft.personal && (
          <button
            className="button secondary small"
            disabled={busy}
            title="The assistant rewrites this test in the QA team's framework, following its standards"
            onClick={() => window.api.translateDraft(projectId, draft.id)}
          >
            {translation ? 'Translate again' : 'Translate to framework'}
          </button>
        )}
        {translation?.committed && !translation.sentAt && !draft.personal && (
          <button className="button primary small" disabled={busy || sending} onClick={send}>
            {sending ? 'Sending…' : 'Send for review'}
          </button>
        )}
        <button className="button link small" onClick={exportZip}>
          Export for QA
        </button>
        <button className="button link small danger" disabled={running} onClick={remove}>
          Remove
        </button>
      </div>
      {draft.lastRun && (
        <div className="small muted">
          Last run {new Date(draft.lastRun.at).toLocaleString()}: {draft.lastRun.status === 'passed' ? 'passed' : 'failed'}
        </div>
      )}
      {message && <p className={message.ok ? 'message success small' : 'message error small'}>{message.text}</p>}
    </li>
  )
}
