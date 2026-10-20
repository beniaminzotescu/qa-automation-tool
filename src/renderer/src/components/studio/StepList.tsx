import { useEffect, useRef } from 'react'
import type { RecordedStep } from '../../../../shared/api'
import { describeStep, isCheck } from '../../../../shared/steps'
import { Attachment } from '../chat/ChatCards'

/** The recorded steps in plain words, newest at the bottom, each with its screenshot. */
export default function StepList({ projectId, steps }: { projectId: string; steps: RecordedStep[] }) {
  const endRef = useRef<HTMLLIElement>(null)
  useEffect(() => {
    // Block body: newer Chromium returns a Promise from scrollIntoView, which an effect must not return.
    endRef.current?.scrollIntoView({ block: 'nearest' })
  }, [steps.length])

  if (steps.length === 0) {
    return <p className="small muted">Press Record, then use the application in the browser. Your steps appear here.</p>
  }
  return (
    <ol className="step-list">
      {steps.map((step, index) => (
        <li key={step.id} className={isCheck(step) ? 'step check' : 'step'} ref={index === steps.length - 1 ? endRef : undefined}>
          <span className="step-number">{isCheck(step) ? '✓' : index + 1}</span>
          <div className="step-body">
            <div>
              {describeStep(step)}
              {step.by === 'claude' && <span className="by-claude">Automated</span>}
            </div>
            {step.screenshot && <Attachment projectId={projectId} path={step.screenshot} />}
          </div>
        </li>
      ))}
    </ol>
  )
}
