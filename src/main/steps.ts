import { app, BrowserWindow } from 'electron'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BrowserContext, Page } from 'playwright-core'
import { IPC, type ElementInfo, type RecordedStep, type RecordedStepType, type RecorderMode, type StepLog } from '../shared/api'
import { describeStep } from '../shared/steps'
import { RECORDER_SCRIPT } from './recorderScript'

// The step log: what the tester (and Claude) did in the live browser while recording.
// One log per project, kept in the app's data folder with a screenshot per step.

const SCREENSHOT_DELAY_MS = { action: 700, navigate: 2000 }

interface RecorderEvent {
  type: RecordedStepType
  element: ElementInfo | null
  value: string | null
  masked: boolean
}

let projectId: string | null = null
let log: StepLog = emptyLog()
let actor: 'user' | 'claude' = 'user'
/** While the app itself logs in, nothing is recorded. */
let paused = false
/** Latest frame of the live view, used as the step's screenshot. */
let latestFrame: { data: string; at: number } | null = null
let context: BrowserContext | null = null

function emptyLog(): StepLog {
  return { recording: false, mode: 'record', steps: [], sharedWithClaude: 0 }
}

export const stepsDir = (id: string): string => join(app.getPath('userData'), 'steps', id)
const logFile = (id: string): string => join(stepsDir(id), 'steps.json')

/** Loads the project's step log; the live browser records into it. */
export function getStepLog(id: string): StepLog {
  if (projectId !== id) {
    projectId = id
    try {
      log = existsSync(logFile(id)) ? { ...JSON.parse(readFileSync(logFile(id), 'utf8')), recording: false, mode: 'record' } : emptyLog()
    } catch {
      log = emptyLog()
    }
  }
  return log
}

function save(): void {
  if (!projectId) return
  mkdirSync(stepsDir(projectId), { recursive: true })
  writeFileSync(logFile(projectId), JSON.stringify(log, null, 1))
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
  rmSync(stepsDir(id), { recursive: true, force: true })
  log = { ...emptyLog(), recording: log.recording }
  save()
}

/**
 * The steps Claude has not seen yet, as text for the next chat message, and marks them as shared.
 * Returns null when there are none.
 */
export function takeUnsharedSteps(id: string): string | null {
  getStepLog(id)
  const fresh = log.steps.slice(log.sharedWithClaude)
  if (fresh.length === 0) return null
  const start = log.sharedWithClaude
  log.sharedWithClaude = log.steps.length
  save()
  const lines = fresh.map((step, i) => `${start + i + 1}. ${step.by === 'claude' ? '(you) ' : ''}${describeStep(step)}`)
  return [
    'Steps recorded in the live browser since my last message (lines starting with "Check:" are what must be true):',
    ...lines,
    `Full details (element role, name, label, test id, text, CSS path, page address) and a screenshot per step are in ${logFile(id)}.`
  ].join('\n')
}

export function pauseRecording(pause: boolean): void {
  paused = pause
}

function addStep(type: RecordedStepType, element: ElementInfo | null, value: string | null, masked: boolean, url?: string, page?: Page): void {
  if (!projectId || !log.recording || paused) return
  const pageUrl = url ?? page?.url() ?? context?.pages().at(-1)?.url() ?? ''

  // Several page changes in a row (redirects, in-page routing) are one step.
  const last = log.steps[log.steps.length - 1]
  if (type === 'navigate' && last?.type === 'navigate') {
    last.url = pageUrl
    void refreshTitle(last, page)
    save()
    scheduleScreenshot(last, SCREENSHOT_DELAY_MS.navigate)
    return
  }
  // Typing into the same field again replaces the earlier value.
  if (type === 'fill' && last?.type === 'fill' && last.element?.css === element?.css) {
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
    by: actor
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
    const path = join(stepsDir(id), `step-${step.id.slice(0, 8)}-${Date.now()}.jpg`)
    mkdirSync(stepsDir(id), { recursive: true })
    writeFileSync(path, Buffer.from(latestFrame.data, 'base64'))
    if (step.screenshot) rmSync(step.screenshot, { force: true })
    step.screenshot = path
    save()
  }, delayMs)
}
