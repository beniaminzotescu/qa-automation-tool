import { app, BrowserWindow } from 'electron'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BrowserContext, Page } from 'playwright-core'
import { IPC, type ElementInfo, type RecordedStep, type RecordedStepType, type RecorderMode, type StepLog } from '../shared/api'
import { describeStep } from '../shared/steps'
import { RECORDER_SCRIPT } from './recorderScript'

// The step log: what the tester (and Claude) did in the live browser while recording, kept in the
// app's data folder with a screenshot per step. Without a test case open there is one free log per
// project; each open test case has its own log, where every action belongs to one of the case's steps.

const SCREENSHOT_DELAY_MS = { action: 700, navigate: 2000 }

interface RecorderEvent {
  type: RecordedStepType
  element: ElementInfo | null
  value: string | null
  masked: boolean
}

let projectId: string | null = null
/** The test case open in the Studio, or null for free recording. */
let caseId: string | null = null
let log: StepLog = emptyLog(null)
let actor: 'user' | 'claude' = 'user'
/** While the app itself logs in, nothing is recorded. */
let paused = false
/** Latest frame of the live view, used as the step's screenshot. */
let latestFrame: { data: string; at: number } | null = null
let context: BrowserContext | null = null

function emptyLog(forCase: string | null): StepLog {
  return { recording: false, mode: 'record', steps: [], sharedWithClaude: 0, caseId: forCase, currentCaseStepId: null }
}

export const stepsDir = (id: string): string => join(app.getPath('userData'), 'steps', id)
/** The folder of a log: the project's folder for free recording, a sub-folder per test case. */
const logDir = (id: string, forCase: string | null): string => (forCase ? join(stepsDir(id), 'cases', forCase) : stepsDir(id))
const logFile = (id: string, forCase: string | null): string => join(logDir(id, forCase), 'steps.json')
const activeCaseFile = (id: string): string => join(stepsDir(id), 'active-case.json')

/** The test case open in the Studio for this project, or null. */
export function getActiveCaseId(id: string): string | null {
  try {
    return (JSON.parse(readFileSync(activeCaseFile(id), 'utf8')) as { caseId: string | null }).caseId
  } catch {
    return null
  }
}

/** Loads the project's step log (of its open test case, if any); the live browser records into it. */
export function getStepLog(id: string): StepLog {
  if (projectId !== id) load(id, getActiveCaseId(id))
  return log
}

function load(id: string, forCase: string | null): void {
  projectId = id
  caseId = forCase
  const file = logFile(id, forCase)
  try {
    const saved = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as Partial<StepLog>) : {}
    log = { ...emptyLog(forCase), ...saved, recording: false, mode: 'record', caseId: forCase }
  } catch {
    log = emptyLog(forCase)
  }
}

/**
 * Opens a test case in the Studio (null closes it: back to free recording). Its own log is loaded,
 * and the step to record next is the first one without actions.
 */
export function openCase(id: string, forCase: string | null, caseStepIds: string[]): StepLog {
  const wasRecording = projectId === id && log.recording
  mkdirSync(stepsDir(id), { recursive: true })
  writeFileSync(activeCaseFile(id), JSON.stringify({ caseId: forCase }))
  load(id, forCase)
  log.recording = wasRecording
  if (forCase) {
    const known = log.currentCaseStepId && caseStepIds.includes(log.currentCaseStepId)
    if (!known) log.currentCaseStepId = caseStepIds.find((stepId) => !log.steps.some((s) => s.caseStepId === stepId)) ?? caseStepIds[0] ?? null
  }
  save()
  return log
}

/** The case step the next recorded actions belong to. */
export function setCurrentCaseStep(id: string, caseStepId: string | null): void {
  getStepLog(id)
  log.currentCaseStepId = caseStepId
  save()
}

/** Removes the actions recorded for one case step, so it can be recorded again. */
export function clearCaseStep(id: string, caseStepId: string): void {
  getStepLog(id)
  // Steps Claude has seen are always the first ones; removing some keeps that true.
  const shared = new Set(log.steps.slice(0, log.sharedWithClaude).map((s) => s.id))
  for (const step of log.steps) if (step.caseStepId === caseStepId && step.screenshot) rmSync(step.screenshot, { force: true })
  log.steps = log.steps.filter((s) => s.caseStepId !== caseStepId)
  log.sharedWithClaude = log.steps.filter((s) => shared.has(s.id)).length
  log.currentCaseStepId = caseStepId
  save()
}

function save(): void {
  if (!projectId) return
  mkdirSync(logDir(projectId, caseId), { recursive: true })
  writeFileSync(logFile(projectId, caseId), JSON.stringify(log, null, 1))
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(IPC.stepLogUpdate, { projectId, log })
  }
}

/** Called by the live browser when it starts: every page gets the recorder script. */
export async function attachRecorder(browserContext: BrowserContext): Promise<void> {
  context = browserContext
  await browserContext.exposeBinding('__qaRecord', (_source, event: RecorderEvent) => {
    addStep(event.type, event.element, event.value, event.masked)
  })
  await browserContext.addInitScript(RECORDER_SCRIPT)
  // Pages already open before the script was added.
  for (const page of browserContext.pages()) await page.evaluate(RECORDER_SCRIPT).catch(() => {})
  for (const page of browserContext.pages()) followPage(page)
  browserContext.on('page', followPage)
}

/** Each new document starts with the script's defaults; give it the current mode and actor. */
function followPage(page: Page): void {
  const apply = (): void => {
    void applyMode(page)
    void applyActor(page)
  }
  apply()
  page.on('domcontentloaded', apply)
}

/** Called by the live browser for every main-frame navigation. */
export function onNavigated(page: Page): void {
  addStep('navigate', null, null, false, page.url(), page)
}

/** Called by the live browser with each frame of the live view. */
export function onFrame(data: string): void {
  latestFrame = { data, at: Date.now() }
}

/** While Claude works, its actions in the live browser are marked as Claude's and highlighted. */
export function setActor(next: 'user' | 'claude'): void {
  actor = next
  for (const page of context?.pages() ?? []) void applyActor(page)
}

async function applyActor(page: Page): Promise<void> {
  await page.evaluate((who) => (window as unknown as { __qaSetActor?(a: string): void }).__qaSetActor?.(who), actor).catch(() => {})
}

export function setRecording(id: string, recording: boolean): void {
  getStepLog(id)
  log.recording = recording
  if (!recording) void setMode(id, 'record')
  save()
}

export async function setMode(id: string, mode: RecorderMode): Promise<void> {
  getStepLog(id)
  log.mode = mode
  for (const page of context?.pages() ?? []) await applyMode(page)
  save()
}

async function applyMode(page: Page): Promise<void> {
  await page.evaluate((mode) => (window as unknown as { __qaSetMode?(m: string): void }).__qaSetMode?.(mode), log.mode).catch(() => {})
}

export function undoStep(id: string): void {
  getStepLog(id)
  // Page changes that followed the removed action go with it.
  while (log.steps.length && log.steps[log.steps.length - 1].type === 'navigate') log.steps.pop()
  const removed = log.steps.pop()
  if (removed?.screenshot) rmSync(removed.screenshot, { force: true })
  log.sharedWithClaude = Math.min(log.sharedWithClaude, log.steps.length)
  save()
}

export function clearSteps(id: string): void {
  getStepLog(id)
  if (caseId) {
    rmSync(logDir(id, caseId), { recursive: true, force: true })
  } else if (existsSync(stepsDir(id))) {
    // The free log only: the test cases' logs and the open case stay.
    for (const name of readdirSync(stepsDir(id))) {
      if (name !== 'cases' && name !== 'active-case.json') rmSync(join(stepsDir(id), name), { recursive: true, force: true })
    }
  }
  log = { ...emptyLog(caseId), recording: log.recording, currentCaseStepId: log.currentCaseStepId }
  save()
}

/** For a test case: the number of the case step an action belongs to (1-based), or null. */
export type CaseStepNumber = (caseStepId: string | null | undefined) => number | null

/**
 * The steps Claude has not seen yet, as text for the next chat message, and marks them as shared.
 * Returns null when there are none.
 */
export function takeUnsharedSteps(id: string, caseStepNumber?: CaseStepNumber): string | null {
  getStepLog(id)
  const fresh = log.steps.slice(log.sharedWithClaude)
  if (fresh.length === 0) return null
  const start = log.sharedWithClaude
  log.sharedWithClaude = log.steps.length
  save()
  const lines = fresh.map((step, i) => `${start + i + 1}. ${stepLine(step, caseStepNumber)}`)
  return [
    'Steps recorded in the live browser since my last message (lines starting with "Check:" are what must be true):',
    ...lines,
    detailsLine(id)
  ].join('\n')
}

/** Everything recorded for the open test case, grouped by case step, and marks it all as shared. */
export function caseRecordingText(id: string, caseSteps: { id: string; action: string }[]): string {
  getStepLog(id)
  log.sharedWithClaude = log.steps.length
  save()
  const lines: string[] = []
  caseSteps.forEach((caseStep, index) => {
    lines.push(`Case step ${index + 1}: ${caseStep.action}`)
    const actions = log.steps.filter((s) => s.caseStepId === caseStep.id)
    if (actions.length === 0) lines.push('  (nothing recorded)')
    for (const step of actions) lines.push(`  - ${stepLine(step)}`)
  })
  const other = log.steps.filter((s) => !caseSteps.some((c) => c.id === s.caseStepId))
  if (other.length) lines.push('Recorded outside the case steps:', ...other.map((step) => `  - ${stepLine(step)}`))
  return ['What was recorded in the live browser for each step of the test case:', ...lines, detailsLine(id)].join('\n')
}

function stepLine(step: RecordedStep, caseStepNumber?: CaseStepNumber): string {
  const number = caseStepNumber?.(step.caseStepId)
  return `${number ? `[case step ${number}] ` : ''}${step.by === 'claude' ? '(you) ' : ''}${describeStep(step)}`
}

function detailsLine(id: string): string {
  return `Full details (element role, name, label, test id, text, CSS path, page address) and a screenshot per step are in ${logFile(id, caseId)}.`
}

export function pauseRecording(pause: boolean): void {
  paused = pause
}

function addStep(type: RecordedStepType, element: ElementInfo | null, value: string | null, masked: boolean, url?: string, page?: Page): void {
  if (!projectId || !log.recording || paused) return
  const pageUrl = url ?? page?.url() ?? context?.pages().at(-1)?.url() ?? ''

  // Several page changes in a row (redirects, in-page routing) are one step, within one case step.
  const caseStepId = caseId ? log.currentCaseStepId : null
  const last = log.steps[log.steps.length - 1]
  const sameCaseStep = (last?.caseStepId ?? null) === caseStepId
  if (type === 'navigate' && last?.type === 'navigate' && sameCaseStep) {
    last.url = pageUrl
    void refreshTitle(last, page)
    save()
    scheduleScreenshot(last, SCREENSHOT_DELAY_MS.navigate)
    return
  }
  // Typing into the same field again replaces the earlier value.
  if (type === 'fill' && last?.type === 'fill' && last.element?.css === element?.css && sameCaseStep) {
    last.value = value
    save()
    return
  }
  // A page can take a while to draw; retake its screenshot now, as the tester saw it before acting.
  if (type !== 'navigate' && last?.type === 'navigate') scheduleScreenshot(last, 0)

  const step: RecordedStep = {
    id: randomUUID(),
    type,
    element,
    value,
    masked,
    url: pageUrl,
    title: '',
    at: new Date().toISOString(),
    screenshot: null,
    by: actor,
    caseStepId
  }
  log.steps.push(step)
  if (type === 'check-text' || type === 'check-visible') void setMode(projectId, 'record')
  void refreshTitle(step, page)
  save()
  scheduleScreenshot(step, type === 'navigate' ? SCREENSHOT_DELAY_MS.navigate : SCREENSHOT_DELAY_MS.action)
}

async function refreshTitle(step: RecordedStep, page?: Page): Promise<void> {
  const source = page ?? context?.pages().at(-1)
  step.title = (await source?.title().catch(() => '')) ?? ''
  save()
}

function scheduleScreenshot(step: RecordedStep, delayMs: number): void {
  const id = projectId
  setTimeout(() => {
    if (!id || id !== projectId || !log.steps.includes(step) || !latestFrame) return
    const dir = logDir(id, caseId)
    const path = join(dir, `step-${step.id.slice(0, 8)}-${Date.now()}.jpg`)
    mkdirSync(dir, { recursive: true })
    writeFileSync(path, Buffer.from(latestFrame.data, 'base64'))
    if (step.screenshot) rmSync(step.screenshot, { force: true })
    step.screenshot = path
    save()
  }, delayMs)
}
