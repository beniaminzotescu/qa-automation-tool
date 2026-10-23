import { useEffect, useState } from 'react'
import type { AzureItem, AzureTestPlansConfig, CaseStep, TestCase, TestCasesState } from '../../../shared/api'

const SOURCE_LABELS: Record<TestCase['source']['kind'], string> = {
  file: 'From a file',
  paste: 'Pasted',
  ado: 'Azure DevOps',
  generated: 'Suggested',
  manual: 'Written here'
}

const STATUS_LABELS: Record<TestCase['status'], string> = {
  new: 'Not recorded yet',
  'in-progress': 'Recording',
  recorded: 'Recorded',
  automated: 'Automated'
}

interface Props {
  projectId: string
  /** Opens the case in the Studio, where the tester records the real test against it. */
  onOpenInStudio(caseId: string): void
}

/**
 * Test cases: what the team wants tested. Imported from a file, pasted, taken from Azure DevOps or
 * suggested by the assistant; each one is the baseline for recording a test in the Studio.
 */
export default function TestCasesScreen({ projectId, onOpenInStudio }: Props) {
  const [state, setState] = useState<TestCasesState | null>(null)
  const [panel, setPanel] = useState<'paste' | 'azure' | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    window.api.getTestCases(projectId).then(setState)
    return window.api.onTestCasesUpdate((update) => {
      if (update.projectId === projectId) setState(update.state)
    })
  }, [projectId])

  if (!state) return null
  const busy = state.busy !== null

  return (
    <section className="test-cases">
      <h1>Test cases</h1>
      <p className="lead">
        What your team wants tested. Bring the test cases you already have, let the assistant suggest the ones that are
        missing, then open a case in the Studio and record the real test. The case is only the starting point: change
        steps there when the application works differently.
      </p>

      <div className="case-toolbar">
        <button className="button primary" disabled={busy} onClick={() => window.api.importTestCasesFile(projectId)}>
          Import from a file…
        </button>
        <button className={panel === 'paste' ? 'button primary' : 'button secondary'} disabled={busy} onClick={() => setPanel(panel === 'paste' ? null : 'paste')}>
          Paste text
        </button>
        <button className={panel === 'azure' ? 'button primary' : 'button secondary'} disabled={busy} onClick={() => setPanel(panel === 'azure' ? null : 'azure')}>
          From Azure DevOps
        </button>
        <span className="case-toolbar-gap" />
        <button className="button secondary" disabled={busy || state.cases.length === 0} onClick={() => window.api.suggestTestCases(projectId, null)}>
          Suggest more
        </button>
        <button className="button secondary" disabled={busy} onClick={() => setCreating(true)}>
          + New test case
        </button>
      </div>
      <p className="small muted">Excel (.xlsx), CSV, Word (.docx), PDF or text. The assistant reads the cases in it; you choose which to keep.</p>

      {panel === 'paste' && <PastePanel projectId={projectId} onDone={() => setPanel(null)} />}
      {panel === 'azure' && <AzurePanel projectId={projectId} onDone={() => setPanel(null)} />}

      {state.busy && (
        <div className="notice case-busy">
          <span className="spinner" /> {state.busy}
        </div>
      )}
      {state.error && <p className="message error">{state.error}</p>}
      {state.note && <p className="notice">{state.note}</p>}

      {state.proposals.length > 0 && <Proposals projectId={projectId} proposals={state.proposals} />}

      {creating && (
        <div className="card">
          <CaseEditor
            projectId={projectId}
            testCase={null}
            onClose={() => setCreating(false)}
          />
        </div>
      )}

      {state.cases.length === 0 && state.proposals.length === 0 && !creating ? (
        <p className="muted">No test cases yet. Import the ones your team has, or write one.</p>
      ) : (
        <ul className="case-list">
          {state.cases.map((testCase) => (
            <li key={testCase.id} className={openId === testCase.id ? 'case open' : 'case'}>
              <button className="case-summary" onClick={() => setOpenId(openId === testCase.id ? null : testCase.id)}>
                <span className="case-title">{testCase.title}</span>
                <span className="small muted">
                  {testCase.steps.length} step{testCase.steps.length === 1 ? '' : 's'} · {SOURCE_LABELS[testCase.source.kind]}
                </span>
                <span className={`case-status ${testCase.status}`}>{STATUS_LABELS[testCase.status]}</span>
              </button>
              {openId === testCase.id && (
                <div className="case-body">
                  <CaseEditor projectId={projectId} testCase={testCase} onClose={() => setOpenId(null)} />
                  <div className="case-actions">
                    <button className="button primary" onClick={() => onOpenInStudio(testCase.id)}>
                      Open in the Studio
                    </button>
                    <button className="button secondary" disabled={busy} onClick={() => window.api.suggestTestCases(projectId, testCase.id)}>
                      Suggest variations
                    </button>
                    <span className="case-toolbar-gap" />
                    <button
                      className="button link small danger"
                      onClick={async () => {
                        if (window.confirm(`Delete the test case "${testCase.title}"?`)) setState(await window.api.deleteTestCase(projectId, testCase.id))
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/** New cases from an import or a suggestion: the tester picks which to keep. */
function Proposals({ projectId, proposals }: { projectId: string; proposals: TestCase[] }) {
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(proposals.map((p) => p.id)))
  const [expanded, setExpanded] = useState<string | null>(null)
  useEffect(() => setChosen(new Set(proposals.map((p) => p.id))), [proposals])

  const toggle = (id: string): void => {
    const next = new Set(chosen)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setChosen(next)
  }

  return (
    <div className="card proposals">
      <div className="card-header">
        <h2>
          {proposals.length} new test case{proposals.length === 1 ? '' : 's'} to check
        </h2>
      </div>
      <p className="small muted">Untick the ones you don't want. You can change the ones you keep afterwards.</p>
      <ul className="proposal-list">
        {proposals.map((proposal) => (
          <li key={proposal.id}>
            <label className="proposal-row">
              <input type="checkbox" checked={chosen.has(proposal.id)} onChange={() => toggle(proposal.id)} />
              <span className="case-title">{proposal.title}</span>
              {proposal.tags.length > 0 && <span className="small muted">{proposal.tags.join(', ')}</span>}
              <button className="button link small" type="button" onClick={() => setExpanded(expanded === proposal.id ? null : proposal.id)}>
                {expanded === proposal.id ? 'Hide steps' : `${proposal.steps.length} steps`}
              </button>
            </label>
            {expanded === proposal.id && <StepPreview testCase={proposal} />}
          </li>
        ))}
      </ul>
      <div className="actions">
        <button className="button primary" disabled={chosen.size === 0} onClick={() => window.api.acceptProposals(projectId, [...chosen])}>
          Keep {chosen.size === proposals.length ? 'all' : chosen.size}
        </button>
        <button className="button secondary" onClick={() => window.api.discardProposals(projectId)}>
          Discard all
        </button>
      </div>
    </div>
  )
}

function StepPreview({ testCase }: { testCase: TestCase }) {
  return (
    <div className="step-preview">
      {testCase.preconditions && <p className="small"><strong>Before:</strong> {testCase.preconditions}</p>}
      <ol>
        {testCase.steps.map((step) => (
          <li key={step.id}>
            {step.action}
            {step.expected && <div className="small expected">✓ {step.expected}</div>}
          </li>
        ))}
      </ol>
    </div>
  )
}

/** Title, preconditions and steps (action + expected result), edited in place. */
function CaseEditor({ projectId, testCase, onClose }: { projectId: string; testCase: TestCase | null; onClose(): void }) {
  const [title, setTitle] = useState(testCase?.title ?? '')
  const [preconditions, setPreconditions] = useState(testCase?.preconditions ?? '')
  const [steps, setSteps] = useState<CaseStep[]>(testCase?.steps ?? [newStep()])
  const [error, setError] = useState<string | null>(null)
  const changed =
    !testCase ||
    title !== testCase.title ||
    preconditions !== testCase.preconditions ||
    JSON.stringify(steps) !== JSON.stringify(testCase.steps)

  const updateStep = (index: number, changes: Partial<CaseStep>): void =>
    setSteps(steps.map((step, i) => (i === index ? { ...step, ...changes } : step)))
  const move = (index: number, by: number): void => {
    const next = [...steps]
    const [step] = next.splice(index, 1)
    next.splice(index + by, 0, step)
    setSteps(next)
  }

  async function save(): Promise<void> {
    setError(null)
    try {
      await window.api.saveTestCase(projectId, {
        ...(testCase ?? { id: '', tags: [], source: { kind: 'manual' }, status: 'new', draftId: null, createdAt: '', updatedAt: '' }),
        title,
        preconditions,
        steps
      })
      if (!testCase) onClose()
    } catch (e) {
      setError((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    }
  }

  return (
    <div className="case-editor">
      <label className="field-label">Title</label>
      <input className="case-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What the test checks, e.g. New item is saved" />
      <label className="field-label">Before the test (optional)</label>
      <input className="case-input" value={preconditions} onChange={(e) => setPreconditions(e.target.value)} placeholder="e.g. Logged in as an editor" />

      <table className="case-steps">
        <thead>
          <tr>
            <th>#</th>
            <th>Step</th>
            <th>Expected result</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {steps.map((step, index) => (
            <tr key={step.id}>
              <td className="muted">{index + 1}</td>
              <td>
                <textarea rows={1} value={step.action} onChange={(e) => updateStep(index, { action: e.target.value })} placeholder="What the tester does" />
              </td>
              <td>
                <textarea
                  rows={1}
                  value={step.expected ?? ''}
                  onChange={(e) => updateStep(index, { expected: e.target.value || null })}
                  placeholder="What must be true (optional)"
                />
              </td>
              <td className="case-step-tools">
                <button className="button link small" title="Move up" disabled={index === 0} onClick={() => move(index, -1)}>
                  ↑
                </button>
                <button className="button link small" title="Move down" disabled={index === steps.length - 1} onClick={() => move(index, 1)}>
                  ↓
                </button>
                <button className="button link small danger" title="Remove step" onClick={() => setSteps(steps.filter((_, i) => i !== index))}>
                  ✕
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button className="button link small" onClick={() => setSteps([...steps, newStep()])}>
        + Add a step
      </button>

      {error && <p className="message error">{error}</p>}
      <div className="actions">
        <button className="button primary" disabled={!changed || !title.trim()} onClick={save}>
          {testCase ? 'Save changes' : 'Add test case'}
        </button>
        <button className="button secondary" onClick={onClose}>
          {testCase && changed ? 'Close without saving' : 'Close'}
        </button>
      </div>
    </div>
  )
}

function newStep(): CaseStep {
  return { id: crypto.randomUUID(), action: '', expected: null }
}

function PastePanel({ projectId, onDone }: { projectId: string; onDone(): void }) {
  const [text, setText] = useState('')
  return (
    <div className="card">
      <h2>Paste test cases</h2>
      <p className="small muted">From an email, a wiki page, a spreadsheet: any layout. The assistant finds the cases in it.</p>
      <textarea className="case-paste" rows={10} value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste here…" />
      <div className="actions">
        <button
          className="button primary"
          disabled={!text.trim()}
          onClick={() => {
            void window.api.importTestCasesText(projectId, text)
            onDone()
          }}
        >
          Read the test cases
        </button>
        <button className="button secondary" onClick={onDone}>
          Cancel
        </button>
      </div>
    </div>
  )
}

/** Connect once (organization, project, access token), then pick a plan and a suite. */
function AzurePanel({ projectId, onDone }: { projectId: string; onDone(): void }) {
  const [config, setConfig] = useState<AzureTestPlansConfig | null>(null)
  const [orgUrl, setOrgUrl] = useState('')
  const [project, setProject] = useState('')
  const [token, setToken] = useState('')
  const [editing, setEditing] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [plans, setPlans] = useState<AzureItem[] | null>(null)
  const [suites, setSuites] = useState<AzureItem[] | null>(null)
  const [planId, setPlanId] = useState<number | null>(null)
  const [suiteId, setSuiteId] = useState<number | null>(null)
  const [working, setWorking] = useState(false)

  useEffect(() => {
    window.api.getAzureConfig(projectId).then((c) => {
      setConfig(c)
      setOrgUrl(c.orgUrl)
      setProject(c.project)
      setEditing(!c.hasToken)
    })
  }, [projectId])

  useEffect(() => {
    if (!config?.hasToken || editing) return
    window.api
      .listAzurePlans()
      .then(setPlans)
      .catch((e: Error) => setMessage({ ok: false, text: plainError(e) }))
  }, [config, editing])

  async function connect(): Promise<void> {
    setWorking(true)
    setMessage(null)
    const result = await window.api.saveAzureConfig(orgUrl, project, token)
    setWorking(false)
    setMessage({ ok: result.ok, text: result.message })
    setConfig(result.config)
    if (result.ok) {
      setToken('')
      setEditing(false)
    }
  }

  async function choosePlan(id: number): Promise<void> {
    setPlanId(id)
    setSuiteId(null)
    setSuites(null)
    try {
      setSuites(await window.api.listAzureSuites(id))
    } catch (e) {
      setMessage({ ok: false, text: plainError(e as Error) })
    }
  }

  if (!config) return null

  return (
    <div className="card">
      <div className="card-header">
        <h2>From Azure DevOps Test Plans</h2>
        {!editing && (
          <button className="button link small" onClick={() => setEditing(true)}>
            Change connection
          </button>
        )}
      </div>

      {editing ? (
        <div className="form">
          <p className="small muted">
            Needs a personal access token with <strong>Test Management (Read)</strong> and <strong>Work Items (Read)</strong>. Create
            one in Azure DevOps under User settings → Personal access tokens. It is stored encrypted on this computer.
          </p>
          <label className="field-label">Organization</label>
          <input className="case-input" value={orgUrl} onChange={(e) => setOrgUrl(e.target.value)} placeholder="https://dev.azure.com/your-organization" spellCheck={false} />
          <label className="field-label">Project</label>
          <input className="case-input" value={project} onChange={(e) => setProject(e.target.value)} placeholder="Project name" />
          <label className="field-label">Personal access token</label>
          <input
            className="case-input"
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder={config.hasToken ? 'Saved. Paste a new one to replace it.' : 'Paste the token'}
          />
          <div className="actions">
            <button className="button primary" disabled={working || !orgUrl.trim() || !project.trim() || (!token.trim() && !config.hasToken)} onClick={connect}>
              {working ? 'Connecting…' : 'Connect'}
            </button>
            <button className="button secondary" onClick={onDone}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="form">
          <p className="small muted">
            {config.orgUrl} · {config.project}
          </p>
          <label className="field-label">Test plan</label>
          <select className="case-input" value={planId ?? ''} onChange={(e) => void choosePlan(Number(e.target.value))} disabled={!plans}>
            <option value="" disabled>
              {plans ? (plans.length ? 'Choose a test plan' : 'No test plans in this project') : 'Loading…'}
            </option>
            {plans?.map((plan) => (
              <option key={plan.id} value={plan.id}>
                {plan.name}
              </option>
            ))}
          </select>
          {planId !== null && (
            <>
              <label className="field-label">Suite</label>
              <select className="case-input" value={suiteId ?? ''} onChange={(e) => setSuiteId(Number(e.target.value))} disabled={!suites}>
                <option value="" disabled>
                  {suites ? 'Choose a suite' : 'Loading…'}
                </option>
                {suites?.map((suite) => (
                  <option key={suite.id} value={suite.id}>
                    {suite.name}
                  </option>
                ))}
              </select>
            </>
          )}
          <div className="actions">
            <button
              className="button primary"
              disabled={planId === null || suiteId === null}
              onClick={() => {
                void window.api.importAzureSuite(projectId, planId!, suiteId!)
                onDone()
              }}
            >
              Get the test cases
            </button>
            <button className="button secondary" onClick={onDone}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {message && <p className={message.ok ? 'message success' : 'message error'}>{message.text}</p>}
    </div>
  )
}

function plainError(error: Error): string {
  return error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}
