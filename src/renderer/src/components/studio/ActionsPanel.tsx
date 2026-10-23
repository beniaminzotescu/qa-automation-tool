import { useEffect, useState } from 'react'
import type { DraftsUpdate, RecorderMode, StepLog, TestCase } from '../../../../shared/api'
import CaseChecklist from './CaseChecklist'
import StepList from './StepList'
import TestsList from './TestsList'

const MODE_HINTS: Record<Exclude<RecorderMode, 'record'>, string> = {
  'check-text': 'Click the text in the browser that must be shown.',
  'check-visible': 'Click the thing in the browser that must be visible.'
}

/** Record, checks, undo and the recorded steps. Everything happens in the live browser. */
interface Props {
  projectId: string
  claudeWorking: boolean
  drafts: DraftsUpdate | null
}

export default function ActionsPanel({ projectId, claudeWorking, drafts }: Props) {
  const [log, setLog] = useState<StepLog | null>(null)
  const [tab, setTab] = useState<'steps' | 'tests'>('steps')
  const [cases, setCases] = useState<TestCase[]>([])

  useEffect(() => {
    window.api.getStepLog(projectId).then(setLog)
    window.api.getTestCases(projectId).then((state) => setCases(state.cases))
    const offLog = window.api.onStepLogUpdate((update) => {
      if (update.projectId === projectId) setLog(update.log)
    })
    const offCases = window.api.onTestCasesUpdate((update) => {
      if (update.projectId === projectId) setCases(update.state.cases)
    })
    return () => {
      offLog()
      offCases()
    }
  }, [projectId])

  // A test case was just opened from the Test cases screen: show it.
  useEffect(() => {
    if (log?.caseId) setTab('steps')
  }, [log?.caseId])

  // Esc leaves check mode.
  useEffect(() => {
    if (!log || log.mode === 'record') return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') void window.api.setRecorderMode(projectId, 'record')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [log, projectId])

  if (!log) return null

  const toggleCheck = (mode: RecorderMode): void => {
    void window.api.setRecorderMode(projectId, log.mode === mode ? 'record' : mode)
  }

  async function clear(): Promise<void> {
    if (window.confirm('Remove all recorded steps?')) await window.api.clearSteps(projectId)
  }

  const unshared = log.steps.length - log.sharedWithClaude
  const testCase = log.caseId ? (cases.find((c) => c.id === log.caseId) ?? null) : null

  return (
    <>
      <h2>Actions</h2>
      <div className="action-buttons">
        <button
          className={log.recording ? 'button record-button recording' : 'button record-button'}
          onClick={() => window.api.setRecording(projectId, !log.recording)}
        >
          {log.recording ? '■ Stop recording' : '● Record'}
        </button>
        <div className="row">
          <button
            className={log.mode === 'check-text' ? 'button primary' : 'button secondary'}
            disabled={!log.recording}
            onClick={() => toggleCheck('check-text')}
          >
            Check text
          </button>
          <button
            className={log.mode === 'check-visible' ? 'button primary' : 'button secondary'}
            disabled={!log.recording}
            onClick={() => toggleCheck('check-visible')}
          >
            Check visible
          </button>
        </div>
        {log.mode !== 'record' && (
          <div className="mode-hint small">
            {MODE_HINTS[log.mode]} <span className="muted">(Esc to cancel)</span>
          </div>
        )}
        <div className="row">
          <button className="button secondary" disabled={log.steps.length === 0} onClick={() => window.api.undoStep(projectId)}>
            Undo
          </button>
          <button className="button secondary" disabled={log.steps.length === 0} onClick={clear}>
            Clear
          </button>
        </div>
      </div>

      <div className="panel-tabs">
        <button className={tab === 'steps' ? 'panel-tab active' : 'panel-tab'} onClick={() => setTab('steps')}>
          {testCase ? 'Test case' : `Steps (${log.steps.length})`}
        </button>
        <button className={tab === 'tests' ? 'panel-tab active' : 'panel-tab'} onClick={() => setTab('tests')}>
          Your tests ({drafts?.drafts.length ?? 0})
        </button>
      </div>

      {tab === 'tests' && <TestsList projectId={projectId} update={drafts} busy={claudeWorking} />}

      {tab === 'steps' && testCase && <CaseChecklist projectId={projectId} testCase={testCase} log={log} busy={claudeWorking} />}

      {tab === 'steps' && !testCase && (
        <div className="steps-scroll">
          <StepList projectId={projectId} steps={log.steps} />
        </div>
      )}

      {tab === 'steps' && !testCase && log.steps.length > 0 && (
        <div className="steps-footer">
          {unshared > 0 && (
            <p className="small muted">
              {unshared} new step{unshared === 1 ? '' : 's'} will be included with your next message.
            </p>
          )}
          <button className="button primary" disabled={claudeWorking} onClick={() => window.api.askClaudeAboutSteps(projectId)}>
            Make a test from these steps
          </button>
        </div>
      )}
    </>
  )
}
