import { useEffect, useMemo, useState } from 'react'
import type { Chat, Draft, DraftsUpdate, Project, TestCase } from '../../../shared/api'
import { TestResultCard } from '../components/chat/ChatCards'
import LiveBrowser from '../components/studio/LiveBrowser'

type Filter = 'all' | 'mine' | 'team'

/**
 * The tester's saved tests, to run again whenever they like: one, a few or all of them, in the live
 * browser next to the list. Tests marked "Only for me" stay on this computer and are never sent to
 * the team; the others can be translated into the framework from here or from the Studio.
 */
export default function YourTestsScreen({ project }: { project: Project }) {
  const [update, setUpdate] = useState<DraftsUpdate | null>(null)
  const [chat, setChat] = useState<Chat | null>(null)
  const [cases, setCases] = useState<TestCase[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [openId, setOpenId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    window.api.getDrafts(project.id).then(setUpdate)
    window.api.getChat(project.id).then(setChat)
    window.api.getTestCases(project.id).then((state) => setCases(state.cases))
    const offDrafts = window.api.onDraftsUpdate((next) => next.projectId === project.id && setUpdate(next))
    const offChat = window.api.onChatUpdate((next) => next.projectId === project.id && setChat(next.chat))
    const offCases = window.api.onTestCasesUpdate((next) => next.projectId === project.id && setCases(next.state.cases))
    return () => {
      offDrafts()
      offChat()
      offCases()
    }
  }, [project.id])

  const drafts = update?.drafts ?? []
  const shown = useMemo(() => {
    const words = search.trim().toLowerCase()
    return drafts.filter(
      (draft) =>
        (filter === 'all' || (filter === 'mine') === Boolean(draft.personal)) &&
        (!words || `${draft.name} ${draft.summary}`.toLowerCase().includes(words))
    )
  }, [drafts, search, filter])

  const runningIds = update?.runningDraftIds ?? []
  const running = runningIds.length > 0
  const assistantWorking = chat?.status === 'working' || chat?.status === 'preparing'
  const open = drafts.find((draft) => draft.id === openId) ?? null
  const chosen = [...selected].filter((id) => drafts.some((draft) => draft.id === id))

  async function run(ids: string[]): Promise<void> {
    setError(null)
    if (ids.length === 1) setOpenId(ids[0])
    try {
      await window.api.runDrafts(project.id, ids)
    } catch (e) {
      setError(plainError(e as Error))
    }
  }

  const toggle = (id: string): void => {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelected(next)
  }

  const busyLabel = running
    ? `Running ${runningIds.length === 1 ? 'your test' : `${runningIds.length} tests`}… (your input is paused)`
    : assistantWorking
      ? 'The assistant is working in the browser… (your input is paused)'
      : null

  return (
    <div className="your-tests">
      <section className="your-tests-list">
        <h1>Your tests</h1>
        <p className="small muted">
          Run your saved tests again whenever you like. Mark a test <strong>Only for me</strong> to keep it on this computer:
          it is never sent to the team.
        </p>

        <div className="your-tests-filters">
          <input className="case-input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search your tests" />
          <select className="case-input" value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
            <option value="all">All tests</option>
            <option value="mine">Only for me</option>
            <option value="team">For the team</option>
          </select>
        </div>

        <div className="your-tests-toolbar">
          {running ? (
            <button className="button danger" onClick={() => window.api.stopDrafts(project.id)}>
              ■ Stop
            </button>
          ) : (
            <>
              <button className="button primary" disabled={chosen.length === 0 || assistantWorking} onClick={() => run(chosen)}>
                Run selected{chosen.length ? ` (${chosen.length})` : ''}
              </button>
              <button className="button secondary" disabled={shown.length === 0 || assistantWorking} onClick={() => run(shown.map((d) => d.id))}>
                Run all{filter !== 'all' || search ? ' shown' : ''} ({shown.length})
              </button>
            </>
          )}
        </div>
        {error && <p className="message error">{error}</p>}

        {drafts.length === 0 ? (
          <p className="muted">No tests yet. Make one in the Studio: when it passes, it is kept here.</p>
        ) : shown.length === 0 ? (
          <p className="muted">No test matches.</p>
        ) : (
          <ul className="your-tests-items">
            {shown.map((draft) => (
              <li key={draft.id} className={draft.id === openId ? 'open' : ''}>
                <input type="checkbox" checked={selected.has(draft.id)} onChange={() => toggle(draft.id)} aria-label={`Select ${draft.name}`} />
                <button className="your-tests-row" onClick={() => setOpenId(draft.id)}>
                  <ResultBadge draft={draft} running={runningIds.includes(draft.id)} />
                  <span className="your-tests-name">{draft.name}</span>
                  {draft.personal && <span className="personal-badge">Only for me</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="your-tests-work">
        <div className="your-tests-browser">
          <LiveBrowser busyLabel={busyLabel} onStop={running ? () => window.api.stopDrafts(project.id) : null} />
        </div>
        <div className="your-tests-detail">
          {open ? (
            <TestDetail
              projectId={project.id}
              draft={open}
              testCase={cases.find((c) => c.draftId === open.id) ?? null}
              running={runningIds.includes(open.id)}
              busy={running || assistantWorking}
              onRun={() => run([open.id])}
            />
          ) : (
            <p className="muted">Choose a test to see its runs.</p>
          )}
        </div>
      </section>
    </div>
  )
}

function ResultBadge({ draft, running }: { draft: Draft; running: boolean }) {
  const status = running ? 'running' : (draft.lastRun?.status ?? 'none')
  return <span className={`test-badge ${status}`}>{running ? '…' : status === 'passed' ? '✓' : status === 'failed' ? '✕' : '•'}</span>
}

interface DetailProps {
  projectId: string
  draft: Draft
  testCase: TestCase | null
  running: boolean
  busy: boolean
  onRun(): void
}

function TestDetail({ projectId, draft, testCase, running, busy, onRun }: DetailProps) {
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(draft.name)
  const [runIndex, setRunIndex] = useState(0)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const runs = draft.runs ?? []
  const shownRun = runs[Math.min(runIndex, runs.length - 1)]
  const passed = draft.lastRun?.status === 'passed'

  // A new run (or another test) shows its latest run.
  useEffect(() => {
    setRunIndex(0)
    setRenaming(false)
    setName(draft.name)
    setMessage(null)
  }, [draft.id, runs[0]?.id, draft.name])

  async function saveName(): Promise<void> {
    try {
      await window.api.renameDraft(projectId, draft.id, name)
      setRenaming(false)
    } catch (e) {
      setMessage({ ok: false, text: plainError(e as Error) })
    }
  }

  async function remove(): Promise<void> {
    if (window.confirm(`Remove the test "${draft.name}"? Its runs are removed too.`)) await window.api.deleteDraft(projectId, draft.id)
  }

  async function exportZip(): Promise<void> {
    const result = await window.api.exportDraft(projectId, draft.id)
    if (result.message !== 'Cancelled.') setMessage({ ok: result.ok, text: result.message })
  }

  return (
    <div className="test-detail">
      <div className="test-detail-head">
        {renaming ? (
          <div className="row">
            <input className="case-input" value={name} onChange={(e) => setName(e.target.value)} autoFocus onKeyDown={(e) => e.key === 'Enter' && saveName()} />
            <button className="button primary small" disabled={!name.trim()} onClick={saveName}>
              Save
            </button>
            <button className="button secondary small" onClick={() => setRenaming(false)}>
              Cancel
            </button>
          </div>
        ) : (
          <h2>
            {draft.name}{' '}
            <button className="button link small" onClick={() => setRenaming(true)}>
              Rename
            </button>
          </h2>
        )}
        {draft.summary && <p className="small muted">{draft.summary}</p>}
        {testCase && <p className="small muted">From the test case "{testCase.title}"</p>}
      </div>

      <div className="test-detail-actions">
        <button className="button primary" disabled={busy} onClick={onRun}>
          {running ? 'Running…' : 'Run'}
        </button>
        <label className="personal-toggle" title="Keep this test on this computer only: it can't be translated or sent to the team">
          <input type="checkbox" checked={Boolean(draft.personal)} onChange={(e) => window.api.setDraftPersonal(projectId, draft.id, e.target.checked)} />
          Only for me
        </label>
        {passed && !draft.personal && (
          <button className="button secondary" disabled={busy} onClick={() => window.api.translateDraft(projectId, draft.id)}>
            {draft.translation ? 'Translate again' : 'Translate to framework'}
          </button>
        )}
        <span className="case-toolbar-gap" />
        <button className="button link small" onClick={exportZip}>
          Export
        </button>
        <button className="button link small danger" disabled={running} onClick={remove}>
          Remove
        </button>
      </div>
      {draft.translation && !draft.personal && (
        <p className="small muted">
          {draft.translation.sentAt ? 'Sent for review.' : 'In the framework, not sent yet: send it from the Studio (Your tests).'}
        </p>
      )}
      {message && <p className={message.ok ? 'message success small' : 'message error small'}>{message.text}</p>}

      <h3>Runs</h3>
      {runs.length === 0 ? (
        <p className="small muted">Not run yet.</p>
      ) : (
        <>
          <div className="run-history">
            {runs.map((entry, index) => (
              <button
                key={entry.id}
                className={`run-chip ${entry.report.failed ? 'failed' : 'passed'}${index === runIndex ? ' active' : ''}`}
                title={`${entry.by === 'tester' ? 'You ran it' : 'The assistant ran it'} · ${new Date(entry.at).toLocaleString()}`}
                onClick={() => setRunIndex(index)}
              >
                {entry.report.failed ? '✕' : '✓'} {formatWhen(entry.at)}
              </button>
            ))}
          </div>
          {shownRun && <TestResultCard projectId={projectId} report={shownRun.report} />}
        </>
      )}
    </div>
  )
}

function formatWhen(iso: string): string {
  const date = new Date(iso)
  const today = new Date().toDateString() === date.toDateString()
  return today ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : date.toLocaleDateString()
}

function plainError(error: Error): string {
  return error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}
