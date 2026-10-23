import { useEffect, useRef, useState } from 'react'
import type { CaseStep, RecordedStep, StepLog, TestCase } from '../../../../shared/api'
import { describeStep, isCheck } from '../../../../shared/steps'
import { Attachment } from '../chat/ChatCards'

interface Props {
  projectId: string
  testCase: TestCase
  log: StepLog
  /** The assistant is working or a test is running: no new requests. */
  busy: boolean
}

/**
 * The open test case as a checklist. Each case step is recorded by the tester or done by the
 * assistant ("Do it for me"); what was recorded shows under the step. Steps can be changed, added
 * or recorded again: the case is only the starting point.
 */
export default function CaseChecklist({ projectId, testCase, log, busy }: Props) {
  const [editing, setEditing] = useState<string | null>(null)
  const currentRef = useRef<HTMLLIElement>(null)
  const actionsFor = (stepId: string): RecordedStep[] => log.steps.filter((s) => s.caseStepId === stepId)
  const other = log.steps.filter((s) => !testCase.steps.some((c) => c.id === s.caseStepId))
  const missing = testCase.steps.filter((step) => actionsFor(step.id).length === 0).length

  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: 'nearest' })
  }, [log.currentCaseStepId])

  async function saveSteps(steps: CaseStep[]): Promise<void> {
    await window.api.saveTestCase(projectId, { ...testCase, steps })
  }

  function record(stepId: string): void {
    void window.api.setCurrentCaseStep(projectId, stepId)
    if (!log.recording) void window.api.setRecording(projectId, true)
  }

  function next(index: number): void {
    const following = testCase.steps[index + 1]
    void window.api.setCurrentCaseStep(projectId, following?.id ?? null)
  }


  return (
    <>
    <div className="steps-scroll case-checklist">
      <div className="case-checklist-header">
        <div>
          <div className="small muted">Test case</div>
          <strong>{testCase.title}</strong>
          {testCase.preconditions && <div className="small muted">Before: {testCase.preconditions}</div>}
        </div>
        <button className="button link small" disabled={busy} onClick={() => window.api.openCaseInStudio(projectId, null)}>
          Close
        </button>
      </div>

      <ol className="case-checklist-steps">
        {testCase.steps.map((step, index) => {
          const actions = actionsFor(step.id)
          const current = log.currentCaseStepId === step.id
          return (
            <li key={step.id} ref={current ? currentRef : undefined} className={`case-check${current ? ' current' : ''}${actions.length ? ' done' : ''}`}>
              <div className="case-check-head" onClick={() => !current && window.api.setCurrentCaseStep(projectId, step.id)}>
                <span className="step-number">{actions.length ? '✓' : index + 1}</span>
                {editing === step.id ? (
                  <StepEditor
                    step={step}
                    onSave={async (changed) => {
                      await saveSteps(testCase.steps.map((s) => (s.id === step.id ? changed : s)))
                      setEditing(null)
                    }}
                    onCancel={() => setEditing(null)}
                  />
                ) : (
                  <div className="case-check-text">
                    <div>{step.action || <span className="muted">(no action written)</span>}</div>
                    {step.expected && <div className="small expected">✓ {step.expected}</div>}
                  </div>
                )}
              </div>

              {actions.length > 0 && (
                <ul className="case-check-actions">
                  {actions.map((action) => (
                    <li key={action.id} className={isCheck(action) ? 'check' : ''}>
                      {describeStep(action)}
                      {action.by === 'claude' && <span className="by-claude">Automated</span>}
                      {action.screenshot && <Attachment projectId={projectId} path={action.screenshot} />}
                    </li>
                  ))}
                </ul>
              )}

              {current && editing !== step.id && (
                <div className="case-check-buttons">
                  {!log.recording || actions.length === 0 ? (
                    <button className="button primary small" disabled={busy} onClick={() => record(step.id)}>
                      ● Record this step
                    </button>
                  ) : (
                    <button className="button primary small" onClick={() => next(index)}>
                      {index === testCase.steps.length - 1 ? 'Done' : 'Next step ▸'}
                    </button>
                  )}
                  <button className="button secondary small" disabled={busy} onClick={() => window.api.doCaseStep(projectId, step.id)}>
                    Do it for me
                  </button>
                  {actions.length > 0 && (
                    <button className="button link small" disabled={busy} onClick={() => window.api.clearCaseStep(projectId, step.id)}>
                      Record again
                    </button>
                  )}
                  <span className="case-toolbar-gap" />
                  <button className="button link small" onClick={() => setEditing(step.id)}>
                    Change
                  </button>
                  <button
                    className="button link small danger"
                    onClick={() => {
                      if (window.confirm('Remove this step from the test case?')) void saveSteps(testCase.steps.filter((s) => s.id !== step.id))
                    }}
                  >
                    Remove
                  </button>
                </div>
              )}
              {current && log.recording && step.expected && (
                <p className="small muted case-check-hint">To record the expected result, use Check text or Check visible above.</p>
              )}
            </li>
          )
        })}
      </ol>
      {editing === 'new' ? (
        <StepEditor
          step={{ id: crypto.randomUUID(), action: '', expected: null }}
          onSave={async (step) => {
            await saveSteps([...testCase.steps, step])
            setEditing(null)
            void window.api.setCurrentCaseStep(projectId, step.id)
          }}
          onCancel={() => setEditing(null)}
        />
      ) : (
        <button className="button link small" onClick={() => setEditing('new')}>
          + Add a step
        </button>
      )}

      {other.length > 0 && (
        <div className="case-check-other">
          <div className="small muted">Recorded outside the case steps</div>
          <ul className="case-check-actions">
            {other.map((action) => (
              <li key={action.id}>{describeStep(action)}</li>
            ))}
          </ul>
        </div>
      )}
    </div>

    <div className="steps-footer">
      {missing > 0 && (
        <p className="small muted">
          {missing} step{missing === 1 ? '' : 's'} still to record.
        </p>
      )}
      <button className="button primary" disabled={busy || missing > 0} onClick={() => window.api.makeTestFromCase(projectId)}>
        Make the test
      </button>
    </div>
    </>
  )
}

function StepEditor({ step, onSave, onCancel }: { step: CaseStep; onSave(step: CaseStep): void; onCancel(): void }) {
  const [action, setAction] = useState(step.action)
  const [expected, setExpected] = useState(step.expected ?? '')
  return (
    <div className="case-check-editor" onClick={(e) => e.stopPropagation()}>
      <textarea className="case-input" rows={2} value={action} onChange={(e) => setAction(e.target.value)} placeholder="What the tester does" autoFocus />
      <textarea className="case-input" rows={1} value={expected} onChange={(e) => setExpected(e.target.value)} placeholder="Expected result (optional)" />
      <div className="row">
        <button className="button primary small" disabled={!action.trim()} onClick={() => onSave({ ...step, action: action.trim(), expected: expected.trim() || null })}>
          Save
        </button>
        <button className="button secondary small" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  )
}
