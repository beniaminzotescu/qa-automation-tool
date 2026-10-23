// Instructions for the assistant's test case jobs (reading cases from a document, suggesting more),
// and the strict reading of its answer. The answer is one fenced JSON block, checked here before
// anything reaches the tester.

export interface ParsedStep {
  action: string
  expected: string | null
}

export interface ParsedCase {
  title: string
  preconditions: string
  steps: ParsedStep[]
  tags: string[]
}

export interface ParsedCases {
  cases: ParsedCase[]
  /** A short remark for the tester, e.g. why nothing was found. */
  note: string | null
}

const FORMAT = `
Answer with exactly one fenced block and nothing after it:
\`\`\`tfb-cases
{"cases": [{"title": "New item is saved", "preconditions": "Logged in as an editor", "steps": [
  {"action": "Open the Items page", "expected": null},
  {"action": "Click New, type the name \\"Test 1\\" and click Save", "expected": "\\"Test 1\\" is shown in the list"}
], "tags": ["items"]}], "note": null}
\`\`\`
- "steps": one user action per step, in order. "expected" is what must be true right after that step, or null.
- "preconditions": what must be true before the first step, or "".
- "note": one plain sentence for the tester when something needs their attention, otherwise null.
`.trim()

export const CASES_SYSTEM_PROMPT = `
# You are inside "QA-STE100-Studio"
A desktop app where QA testers (often not developers) build automated tests for their team's web
application. Test cases are the baseline: the tester later records the real test against each one.
You only read files and answer; you never change anything.

${FORMAT}
`.trim()

/** Reading the test cases written in a document or pasted text. */
export function importPrompt(file: string, originalName: string): string {
  return `
Read ${file} (the tester's "${originalName}") and extract every test case in it.
- Keep the team's own wording, names and data. Do not add, merge or invent steps or checks.
- A table row, a numbered block or a heading with steps is usually one test case. Split steps written
  in one cell or paragraph ("1. … 2. …") into separate steps.
- Put an expected result on the step where it is checked. An expected result written for the whole
  case goes on the last step.
- If there are no test cases in it, return an empty list and say what the file seems to be in "note".
`.trim()
}

/** Suggesting test cases the team does not have yet. */
export function suggestPrompt(input: {
  existingFile: string
  basedOn: { title: string } | null
  knowledge: { dir: string | null; files: string[] }
}): string {
  const docs = input.knowledge.dir && input.knowledge.files.length
    ? `Documentation of the application is in ${input.knowledge.dir}: ${input.knowledge.files.join(', ')}. Read what is relevant.`
    : 'There is no documentation of the application; rely on the existing test cases.'
  const focus = input.basedOn
    ? `Suggest up to 5 variations of the test case "${input.basedOn.title}": other data, wrong or missing input, limits, other roles, what happens after cancelling or going back.`
    : 'Suggest up to 8 test cases that are missing: negative cases (wrong or missing input), limits (empty, longest, special characters), permissions, what happens after reload, cancel or going back, and important flows that have no case yet.'
  return `
The team's existing test cases are in ${input.existingFile}. ${docs}
${focus}
- Only use pages, fields, buttons and rules that the existing cases or the documentation mention.
  Don't invent features. If you aren't sure something exists, leave it out.
- Don't repeat a case that already exists. Write them in the same style and language as the existing cases.
- Add one tag per case saying what kind it is: "negative", "limits", "permissions", "flow" or "variation".
`.trim()
}

/** Reads the assistant's answer. Throws with a plain reason when it isn't in the agreed shape. */
export function parseCases(answer: string): ParsedCases {
  const block = /```tfb-cases\s*\n([\s\S]*?)```/.exec(answer)?.[1]
  if (!block) throw new Error('The answer has no tfb-cases block.')
  let json: unknown
  try {
    json = JSON.parse(block)
  } catch (error) {
    throw new Error(`The tfb-cases block is not valid JSON: ${(error as Error).message}`)
  }
  const root = json as { cases?: unknown; note?: unknown }
  if (!root || !Array.isArray(root.cases)) throw new Error('The tfb-cases block has no "cases" list.')

  const cases = root.cases.map((item, index): ParsedCase => {
    const raw = item as { title?: unknown; preconditions?: unknown; steps?: unknown; tags?: unknown }
    const title = text(raw.title)
    if (!title) throw new Error(`Case ${index + 1} has no title.`)
    if (!Array.isArray(raw.steps) || raw.steps.length === 0) throw new Error(`Case "${title}" has no steps.`)
    const steps = raw.steps.map((step, stepIndex): ParsedStep => {
      const s = step as { action?: unknown; expected?: unknown }
      const action = text(s.action)
      if (!action) throw new Error(`Step ${stepIndex + 1} of "${title}" has no action.`)
      return { action, expected: text(s.expected) || null }
    })
    const tags = Array.isArray(raw.tags) ? raw.tags.map(text).filter(Boolean) : []
    return { title, preconditions: text(raw.preconditions), steps, tags }
  })
  return { cases, note: text(root.note) || null }
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : ''
}
