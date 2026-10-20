import { useEffect, useState } from 'react'
import Markdown from 'react-markdown'
import type { ChatItem, TestCaseResult, TestReport } from '../../../../shared/api'

// Cards inside the chat. Claude marks questions, scenario lists and the "ready" summary with
// ```tfb-question / tfb-scenarios / tfb-ready fenced blocks (see main/chatPrompt.ts).

type Part =
  | { type: 'text'; text: string }
  | { type: 'question'; question: string; options: string[] }
  | { type: 'scenarios'; scenarios: { name: string; steps?: string[]; expected?: string }[] }
  | { type: 'ready'; summary: string; tests: string[] }
  | { type: 'translated'; summary: string; verified: boolean; notes: string; files: string[] }

const CARD_PATTERN = /```tfb-(question|scenarios|ready|translated)\s*\n([\s\S]*?)```/g

function parseParts(text: string): Part[] {
  const parts: Part[] = []
  let last = 0
  for (const match of text.matchAll(CARD_PATTERN)) {
    if (match.index! > last) parts.push({ type: 'text', text: text.slice(last, match.index) })
    last = match.index! + match[0].length
    try {
      const data = JSON.parse(match[2])
      if (match[1] === 'question') parts.push({ type: 'question', question: data.question ?? '', options: data.options ?? [] })
      if (match[1] === 'scenarios') parts.push({ type: 'scenarios', scenarios: data.scenarios ?? [] })
      if (match[1] === 'ready') parts.push({ type: 'ready', summary: data.summary ?? '', tests: data.tests ?? [] })
      if (match[1] === 'translated') {
        parts.push({ type: 'translated', summary: data.summary ?? '', verified: data.verified === true, notes: data.notes ?? '', files: data.files ?? [] })
      }
    } catch {
      // Not valid JSON: show it as text rather than lose it.
      parts.push({ type: 'text', text: match[2] })
    }
  }
  if (last < text.length) parts.push({ type: 'text', text: text.slice(last) })
  return parts.filter((p) => p.type !== 'text' || p.text.trim())
}

export function AssistantMessage({
  text,
  answerable,
  onAnswer,
  onChange
}: {
  text: string
  /** Buttons only work on Claude's latest message, before the user answered. */
  answerable: boolean
  onAnswer(answer: string): void
  onChange(): void
}) {
  return (
    <div className="bubble assistant">
      {parseParts(text).map((part, index) => {
        switch (part.type) {
          case 'text':
            return (
              <div key={index} className="markdown">
                <Markdown>{part.text}</Markdown>
              </div>
            )
          case 'question':
            return (
              <div key={index} className="card-in-chat question">
                <div className="card-title">{part.question}</div>
                <div className="options">
                  {part.options.map((option) => (
                    <button key={option} className="button secondary" disabled={!answerable} onClick={() => onAnswer(option)}>
                      {option}
                    </button>
                  ))}
                </div>
              </div>
            )
          case 'scenarios':
            return (
              <div key={index} className="card-in-chat scenarios">
                <div className="card-title">The plan: {part.scenarios.length} scenario{part.scenarios.length === 1 ? '' : 's'}</div>
                <ol>
                  {part.scenarios.map((scenario) => (
                    <li key={scenario.name}>
                      <strong>{scenario.name}</strong>
                      {scenario.steps && scenario.steps.length > 0 && (
                        <ul className="steps-list">
                          {scenario.steps.map((step) => (
                            <li key={step}>{step}</li>
                          ))}
                        </ul>
                      )}
                      {scenario.expected && <div className="expected">Expected: {scenario.expected}</div>}
                    </li>
                  ))}
                </ol>
                {answerable && (
                  <div className="options">
                    <button className="button primary" onClick={() => onAnswer('The plan is approved. Go ahead.')}>
                      Approve
                    </button>
                    <button className="button secondary" onClick={onChange}>
                      Change something
                    </button>
                  </div>
                )}
              </div>
            )
          case 'translated':
            return (
              <div key={index} className={part.verified ? 'card-in-chat ready' : 'card-in-chat'}>
                <div className="card-title">
                  {part.verified ? '✓ In the framework, and it passes' : 'In the framework (not verified on this computer)'}
                </div>
                <p>{part.summary}</p>
                {part.notes && <p className="small muted">{part.notes}</p>}
                <details>
                  <summary>Show details</summary>
                  <ul className="work-list">
                    {part.files.map((file) => (
                      <li key={file}>
                        <code>{file}</code>
                      </li>
                    ))}
                  </ul>
                </details>
                <p className="small muted">Send it for review from Your tests (in the Actions column), or export it for the QA team.</p>
              </div>
            )
          case 'ready':
            return (
              <div key={index} className="card-in-chat ready">
                <div className="card-title">✓ The test is ready</div>
                <p>{part.summary}</p>
                {part.tests.length > 0 && (
                  <ul>
                    {part.tests.map((test) => (
                      <li key={test}>{test}</li>
                    ))}
                  </ul>
                )}
                <p className="small muted">Kept in Your tests (in the Actions column). You can run it again there.</p>
              </div>
            )
        }
      })}
    </div>
  )
}

/** What Claude did between two messages: the latest step, with all steps under "Show details". */
export function WorkGroup({ projectId, items, active }: { projectId: string; items: ChatItem[]; active: boolean }) {
  const activities = items.filter((i): i is Extract<ChatItem, { kind: 'activity' }> => i.kind === 'activity')
  const screenshots = items.filter((i): i is Extract<ChatItem, { kind: 'screenshot' }> => i.kind === 'screenshot')
  const latest = activities[activities.length - 1]

  return (
    <div className={active ? 'work active' : 'work'}>
      <div className="work-summary">
        {active ? <span className="spinner" /> : <span className="work-done">✓</span>}
        <span>{active ? `${latest?.label ?? 'Working'}…` : `${activities.length} step${activities.length === 1 ? '' : 's'} done`}</span>
      </div>
      {screenshots.length > 0 && (
        <div className="screenshots">
          {screenshots.slice(-3).map((shot) => (
            <Attachment key={shot.id} projectId={projectId} path={shot.path} />
          ))}
        </div>
      )}
      <details>
        <summary>Show details</summary>
        <ul className="work-list">
          {activities.map((activity) => (
            <li key={activity.id}>
              {activity.label}
              {activity.detail && <code>{activity.detail}</code>}
            </li>
          ))}
        </ul>
      </details>
    </div>
  )
}

export function TestResultCard({ projectId, report }: { projectId: string; report: TestReport }) {
  const ok = report.failed === 0
  const counts = [
    report.passed && `${report.passed} passed`,
    report.failed && `${report.failed} failed`,
    report.flaky && `${report.flaky} passed only on retry`,
    report.skipped && `${report.skipped} skipped`
  ].filter(Boolean)

  return (
    <div className={ok ? 'test-result ok' : 'test-result failed'}>
      <div className="test-result-head">
        <span className="test-result-icon">{ok ? '✓' : '✕'}</span>
        <span>
          Test run: {counts.join(', ')} <span className="muted">({formatDuration(report.durationMs)})</span>
        </span>
      </div>
      <ul className="test-cases">
        {report.tests.map((test, index) => (
          <TestCaseRow key={index} projectId={projectId} test={test} />
        ))}
      </ul>
    </div>
  )
}

const STATUS_ICONS: Record<TestCaseResult['status'], string> = { passed: '✓', failed: '✕', flaky: '!', skipped: '–' }

function TestCaseRow({ projectId, test }: { projectId: string; test: TestCaseResult }) {
  const [showVideo, setShowVideo] = useState(false)
  return (
    <li className={`test-case ${test.status}`}>
      <div className="test-case-line">
        <span className="test-case-icon">{STATUS_ICONS[test.status]}</span>
        <span className="test-case-title">{test.title}</span>
        <span className="muted small">{formatDuration(test.durationMs)}</span>
      </div>
      <div className="test-case-actions">
        {test.video && (
          <button className="button link small" onClick={() => setShowVideo(!showVideo)}>
            {showVideo ? 'Hide video' : 'Watch video'}
          </button>
        )}
        {test.trace && (
          <button className="button link small" onClick={() => window.api.openTrace(projectId, test.trace!)}>
            Watch the replay
          </button>
        )}
      </div>
      {showVideo && test.video && <Attachment projectId={projectId} path={test.video} />}
      {test.screenshots.length > 0 && (
        <div className="screenshots">
          {test.screenshots.map((path) => (
            <Attachment key={path} projectId={projectId} path={path} />
          ))}
        </div>
      )}
      {test.error && (
        <details>
          <summary>Technical details</summary>
          <pre className="task-log">{test.error}</pre>
        </details>
      )}
    </li>
  )
}

/** Image or video from the app's folders, loaded through the main process. */
export function Attachment({ projectId, path }: { projectId: string; path: string }) {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    window.api.readAttachment(projectId, path).then(setSrc)
  }, [projectId, path])
  if (!src) return null
  if (src.startsWith('data:video/')) return <video className="attachment" src={src} controls />
  return <img className="attachment" src={src} alt="Screenshot" />
}

function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000)
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}
