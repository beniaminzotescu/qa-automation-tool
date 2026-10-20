import type { RecordedStep } from './api'

/** One recorded step in plain words, e.g. 'Typed "AutoTest" into "Name"'. */
export function describeStep(step: RecordedStep): string {
  const name = step.element?.name ?? step.element?.placeholder ?? step.element?.role ?? step.element?.tag ?? 'the page'
  switch (step.type) {
    case 'navigate':
      return `Opened ${pageName(step)}`
    case 'click':
      return `Clicked "${name}"`
    case 'fill':
      return step.masked ? `Typed the password into "${name}"` : `Typed "${step.value ?? ''}" into "${name}"`
    case 'press':
      return `Pressed ${step.value ?? 'a key'}`
    case 'select':
      return `Chose "${step.value ?? ''}" in "${name}"`
    case 'check-text':
      return `Check: "${name}" shows "${step.value ?? ''}"`
    case 'check-visible':
      return `Check: "${name}" is visible`
  }
}

export function isCheck(step: RecordedStep): boolean {
  return step.type === 'check-text' || step.type === 'check-visible'
}

/** "Home (/app/dashboard)": the title alone is often the same on every page. */
function pageName(step: RecordedStep): string {
  try {
    const { pathname } = new URL(step.url)
    return step.title ? `${step.title} (${pathname})` : pathname
  } catch {
    return step.title || step.url
  }
}
