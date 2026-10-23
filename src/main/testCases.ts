import { app, BrowserWindow } from 'electron'
import { randomUUID } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { IPC, type CaseStep, type TestCase, type TestCasesState } from '../shared/api'
import { runTask } from './claudeRunner'
import { canConvert, toText } from './documents'
import { knowledgeDir, knowledgeForPrompt } from './knowledge'
import { CASES_SYSTEM_PROMPT, importPrompt, parseCases, suggestPrompt, type ParsedCase, type ParsedCases } from './testCasesPrompt'

// Test cases: what the team wants tested, written by the team (imported from a file, pasted, or from
// Azure DevOps) or suggested by the assistant. They are the baseline the tester records tests against.
// New cases arrive as proposals first; the tester picks which to keep.

const casesDir = (projectId: string): string => join(app.getPath('userData'), 'testcases', projectId)
const casesFile = (projectId: string): string => join(casesDir(projectId), 'cases.json')
const proposalsFile = (projectId: string): string => join(casesDir(projectId), 'proposals.json')
/** Copies of the files the cases were read from. */
const sourcesDir = (projectId: string): string => join(casesDir(projectId), 'sources')
/** The assistant's working folder for test case jobs. */
const taskDir = (projectId: string): string => join(casesDir(projectId), 'task')

/** Formats the assistant reads without conversion. */
const READ_AS_IS = new Set(['.pdf', '.png', '.jpg', '.jpeg', '.gif', '.webp'])

const jobs = new Map<string, { busy: string | null; error: string | null; note: string | null }>()

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T
  } catch {
    return fallback
  }
}

export function getTestCases(projectId: string): TestCasesState {
  const job = jobs.get(projectId) ?? { busy: null, error: null, note: null }
  return {
    cases: readJson<TestCase[]>(casesFile(projectId), []),
    proposals: readJson<TestCase[]>(proposalsFile(projectId), []),
    ...job
  }
}

export function getTestCase(projectId: string, caseId: string): TestCase | null {
  return getTestCases(projectId).cases.find((c) => c.id === caseId) ?? null
}

function emit(projectId: string): TestCasesState {
  const state = getTestCases(projectId)
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(IPC.testCasesUpdate, { projectId, state })
  }
  return state
}

function writeCases(projectId: string, cases: TestCase[]): TestCasesState {
  mkdirSync(casesDir(projectId), { recursive: true })
  writeFileSync(casesFile(projectId), JSON.stringify(cases, null, 1))
  return emit(projectId)
}

function writeProposals(projectId: string, proposals: TestCase[]): TestCasesState {
  mkdirSync(casesDir(projectId), { recursive: true })
  writeFileSync(proposalsFile(projectId), JSON.stringify(proposals, null, 1))
  return emit(projectId)
}

function setJob(projectId: string, changes: Partial<{ busy: string | null; error: string | null; note: string | null }>): void {
  jobs.set(projectId, { ...(jobs.get(projectId) ?? { busy: null, error: null, note: null }), ...changes })
  emit(projectId)
}

// --- Editing ---------------------------------------------------------------------------------

export function saveTestCase(projectId: string, input: TestCase): TestCasesState {
  const title = String(input.title ?? '').trim()
  if (!title) throw new Error('A test case needs a title.')
  const steps: CaseStep[] = (Array.isArray(input.steps) ? input.steps : [])
    .map((step) => ({
      id: step.id || randomUUID(),
      action: String(step.action ?? '').trim(),
      expected: String(step.expected ?? '').trim() || null
    }))
    .filter((step) => step.action || step.expected)
  const cases = getTestCases(projectId).cases
  const now = new Date().toISOString()
  const existing = cases.find((c) => c.id === input.id)
  const saved: TestCase = {
    ...(existing ?? newCase({ kind: 'manual' })),
    title,
    preconditions: String(input.preconditions ?? '').trim(),
    steps,
    tags: Array.isArray(input.tags) ? input.tags.map(String) : [],
    updatedAt: now
  }
  return writeCases(projectId, existing ? cases.map((c) => (c.id === saved.id ? saved : c)) : [...cases, saved])
}

export function deleteTestCase(projectId: string, caseId: string): TestCasesState {
  return writeCases(
    projectId,
    getTestCases(projectId).cases.filter((c) => c.id !== caseId)
  )
}

/** Progress of a case in the Studio, and the draft test made from it. */
export function updateCaseProgress(projectId: string, caseId: string, changes: Partial<Pick<TestCase, 'status' | 'draftId'>>): void {
  const cases = getTestCases(projectId).cases
  if (!cases.some((c) => c.id === caseId)) return
  writeCases(
    projectId,
    cases.map((c) => (c.id === caseId ? { ...c, ...changes, updatedAt: new Date().toISOString() } : c))
  )
}

export function acceptProposals(projectId: string, ids: string[]): TestCasesState {
  const { cases, proposals } = getTestCases(projectId)
  const chosen = proposals.filter((p) => ids.includes(p.id))
  writeCases(projectId, [...cases, ...chosen])
  setJob(projectId, { note: null, error: null })
  return writeProposals(projectId, [])
}

export function discardProposals(projectId: string): TestCasesState {
  setJob(projectId, { note: null, error: null })
  return writeProposals(projectId, [])
}

/** Cases that need no assistant (from Azure DevOps): straight into the proposals. */
export function addProposals(projectId: string, parsed: ParsedCase[], source: TestCase['source'], refs: string[] = []): void {
  const proposals = parsed.map((item, index) => fromParsed(item, { ...source, ref: refs[index] ?? source.ref }))
  writeProposals(projectId, [...getTestCases(projectId).proposals, ...proposals])
  setJob(projectId, { error: null, note: proposals.length ? null : 'No test cases were found there.' })
}

export function setTestCasesBusy(projectId: string, busy: string | null, error: string | null = null): void {
  setJob(projectId, { busy, error })
}

// --- Jobs for the assistant ------------------------------------------------------------------

/** Reads the test cases in a file the tester chose. */
export async function importFile(projectId: string, path: string): Promise<void> {
  const name = basename(path)
  const ext = extname(path).toLowerCase()
  if (!canConvert(path) && !READ_AS_IS.has(ext)) {
    setJob(projectId, { error: `"${name}" can't be read. Save it as Excel (.xlsx), Word (.docx), PDF or text, and try again.` })
    return
  }
  mkdirSync(sourcesDir(projectId), { recursive: true })
  const copy = join(sourcesDir(projectId), `${randomUUID().slice(0, 8)}-${name}`)
  copyFileSync(path, copy)
  let file = copy
  if (ext === '.docx' || ext === '.xlsx') {
    try {
      const text = await toText(copy)
      if (!text?.trim()) {
        setJob(projectId, { error: `"${name}" is empty.` })
        return
      }
      file = `${copy}.txt`
      writeFileSync(file, text)
    } catch {
      setJob(projectId, { error: `"${name}" could not be opened. It may be damaged or protected with a password.` })
      return
    }
  }
  await runJob(projectId, `Reading the test cases in "${name}"…`, importPrompt(file, name), { kind: 'file', name })
}

/** Reads test cases the tester pasted. */
export async function importText(projectId: string, text: string): Promise<void> {
  if (!text.trim()) return
  mkdirSync(sourcesDir(projectId), { recursive: true })
  const file = join(sourcesDir(projectId), `pasted-${Date.now()}.txt`)
  writeFileSync(file, text)
  await runJob(projectId, 'Reading the test cases you pasted…', importPrompt(file, 'pasted text'), { kind: 'paste', name: 'Pasted text' })
}

/** Suggests cases the team doesn't have yet, or variations of one case. */
export async function suggest(projectId: string, basedOnCaseId: string | null): Promise<void> {
  const { cases } = getTestCases(projectId)
  const basedOn = basedOnCaseId ? (cases.find((c) => c.id === basedOnCaseId) ?? null) : null
  mkdirSync(taskDir(projectId), { recursive: true })
  const existingFile = join(taskDir(projectId), 'existing-cases.json')
  const brief = cases.map((c) => ({ title: c.title, preconditions: c.preconditions, steps: c.steps.map(({ action, expected }) => ({ action, expected })) }))
  writeFileSync(existingFile, JSON.stringify(brief, null, 1))
  const knowledge = knowledgeForPrompt(projectId)
  const prompt = suggestPrompt({
    existingFile,
    basedOn,
    knowledge: { dir: knowledge.filesDir, files: knowledge.files.map((f) => f.name) }
  })
  await runJob(projectId, basedOn ? `Thinking of variations of "${basedOn.title}"…` : 'Thinking of test cases you don\'t have yet…', prompt, {
    kind: 'generated',
    ...(basedOn ? { ref: basedOn.id } : {})
  })
}

async function runJob(projectId: string, busy: string, prompt: string, source: TestCase['source']): Promise<void> {
  if (jobs.get(projectId)?.busy) {
    setJob(projectId, { error: 'Still working on the previous request. Wait until it is done.' })
    return
  }
  setJob(projectId, { busy, error: null, note: null })
  try {
    const parsed = await askForCases(projectId, prompt)
    const proposals = parsed.cases.map((item) => fromParsed(item, source))
    writeProposals(projectId, [...getTestCases(projectId).proposals, ...proposals])
    setJob(projectId, { busy: null, note: parsed.note ?? (proposals.length ? null : 'No test cases were found.') })
  } catch (error) {
    setJob(projectId, { busy: null, error: `The assistant could not do it: ${(error as Error).message}` })
  }
}

/** One question to the assistant; an answer in the wrong shape gets one more try. */
async function askForCases(projectId: string, prompt: string): Promise<ParsedCases> {
  const ask = (text: string): Promise<string> =>
    runTask({
      dir: taskDir(projectId),
      readDirs: [sourcesDir(projectId), knowledgeDir(projectId)].filter((dir) => existsSync(dir)),
      prompt: text,
      systemPrompt: CASES_SYSTEM_PROMPT
    })
  const answer = await ask(prompt)
  try {
    return parseCases(answer)
  } catch (error) {
    return parseCases(await ask(`${prompt}\n\nYour last answer could not be read (${(error as Error).message}). Answer again in exactly the required format.`))
  }
}

function fromParsed(item: ParsedCase, source: TestCase['source']): TestCase {
  return {
    ...newCase(source),
    title: item.title,
    preconditions: item.preconditions,
    steps: item.steps.map((step) => ({ id: randomUUID(), action: step.action, expected: step.expected })),
    tags: item.tags
  }
}

function newCase(source: TestCase['source']): TestCase {
  const now = new Date().toISOString()
  return {
    id: randomUUID(),
    title: '',
    preconditions: '',
    steps: [],
    tags: [],
    source,
    status: 'new',
    draftId: null,
    createdAt: now,
    updatedAt: now
  }
}
