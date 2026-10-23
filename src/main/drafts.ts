import { app, BrowserWindow } from 'electron'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { IPC, type Draft, type DraftRun, type DraftsUpdate, type TestReport, type Translation } from '../shared/api'
import { getAccount, getAccountPassword } from './account'
import { getDebuggingEndpoint, startBrowser } from './liveBrowser'
import { playwrightTestCli, unpackedModules } from './nodeRunner'
import { freshPath, quote, runCommand } from './process'
import { readTestReport } from './testReport'

// Draft tests: the tester's own tests, kept by the app, written as simple standard Playwright
// tests. They run in the live browser (through its debugging port), so the tester watches them.
// The framework is not needed for a draft; strong drafts are translated into it later.

const runnerDir = (): string => join(app.getPath('userData'), 'runner')
const runnerBin = (): string => join(runnerDir(), 'bin')
export const draftsDir = (projectId: string): string => join(runnerDir(), 'drafts', projectId)
const registryFile = (projectId: string): string => join(draftsDir(projectId), 'drafts.json')

/** The drafts running in the live browser now; one run at a time, it shares the tester's browser. */
let running: { projectId: string; draftIds: string[]; controller: AbortController } | null = null
/** Runs kept per test; older ones (and their screenshots) are removed. */
const KEPT_RUNS = 10
/** Each run's screenshots and videos, so a new run doesn't overwrite the ones in the history. */
const runsDir = (projectId: string): string => join(draftsDir(projectId), 'runs')

/**
 * The test runner (Playwright Test) comes with the app. This writes the `playwright` command the
 * assistant and the app run drafts with: for cmd/PowerShell and for Git Bash (Claude's shell).
 * Drafts find `@playwright/test` through NODE_PATH (see draftEnv).
 */
export function ensureRunner(): void {
  // Earlier versions installed the runner here with npm. Node would find that copy before NODE_PATH.
  for (const old of ['node_modules', 'package.json', 'package-lock.json']) {
    rmSync(join(runnerDir(), old), { recursive: true, force: true })
  }
  mkdirSync(runnerBin(), { recursive: true })
  const electron = process.execPath
  const cli = playwrightTestCli()
  writeFileSync(join(runnerBin(), 'playwright.cmd'), `@echo off\r\nsetlocal\r\nset ELECTRON_RUN_AS_NODE=1\r\n"${electron}" "${cli}" %*\r\n`)
  const slashes = (path: string): string => path.replace(/\\/g, '/')
  writeFileSync(join(runnerBin(), 'playwright'), `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec "${slashes(electron)}" "${slashes(cli)}" "$@"\n`)
}

/** The drafts folder with the app's own config and fixtures (rewritten, so they stay current). */
export function ensureDraftsProject(projectId: string): string {
  const dir = draftsDir(projectId)
  mkdirSync(join(dir, 'tests'), { recursive: true })
  writeFileSync(join(dir, 'playwright.config.ts'), CONFIG)
  writeFileSync(join(dir, 'fixtures.ts'), FIXTURES)
  return dir
}

/** Environment for draft runs: the live browser and the tester's environment. */
export function draftEnv(reportFile?: string): Record<string, string> {
  const account = getAccount()
  return {
    // The app's own `playwright` command first, and the app's Playwright packages for the drafts' imports.
    PATH: `${runnerBin()};${freshPath()}`,
    NODE_PATH: unpackedModules(),
    FORCE_COLOR: '0',
    QA_CDP_ENDPOINT: getDebuggingEndpoint() ?? '',
    QA_UI_URL: account?.appUrl ?? '',
    QA_API_URL: account?.apiUrl ?? '',
    QA_USERNAME: account?.username ?? '',
    QA_PASSWORD: getAccountPassword() ?? '',
    ...(reportFile ? { PLAYWRIGHT_JSON_OUTPUT_FILE: reportFile } : {})
  }
}

// --- The tester's list of drafts --------------------------------------------------------

function readRegistry(projectId: string): Draft[] {
  try {
    return JSON.parse(readFileSync(registryFile(projectId), 'utf8'))
  } catch {
    return []
  }
}

function writeRegistry(projectId: string, drafts: Draft[]): void {
  mkdirSync(draftsDir(projectId), { recursive: true })
  writeFileSync(registryFile(projectId), JSON.stringify(drafts, null, 1))
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(IPC.draftsUpdate, getDraftsUpdate(projectId))
  }
}

/** The registry, plus test files written without a "ready" card, minus files that are gone. */
export function listDrafts(projectId: string): Draft[] {
  const testsDir = join(draftsDir(projectId), 'tests')
  const files = existsSync(testsDir) ? readdirSync(testsDir).filter((f) => /\.spec\.[jt]s$/.test(f)) : []
  const known = readRegistry(projectId).filter((draft) => files.includes(basename(draft.file)))
  for (const file of files) {
    if (known.some((draft) => basename(draft.file) === file)) continue
    const now = new Date().toISOString()
    known.push({ id: randomUUID(), name: nameFromFile(file), file: `tests/${file}`, summary: '', createdAt: now, updatedAt: now, lastRun: null })
  }
  return known
}

export function getDraftsUpdate(projectId: string): DraftsUpdate {
  return {
    projectId,
    drafts: listDrafts(projectId),
    runningDraftIds: running?.projectId === projectId ? running.draftIds : []
  }
}

/** From the assistant's "ready" card: the test's name and summary. */
export function registerDraft(projectId: string, info: { name: string; file: string; summary: string }): string {
  const drafts = listDrafts(projectId)
  const file = `tests/${basename(info.file)}`
  const existing = drafts.find((draft) => basename(draft.file) === basename(file))
  const now = new Date().toISOString()
  const id = existing?.id ?? randomUUID()
  if (existing) Object.assign(existing, { name: info.name || existing.name, summary: info.summary || existing.summary, updatedAt: now })
  else drafts.push({ id, name: info.name || nameFromFile(file), file, summary: info.summary, createdAt: now, updatedAt: now, lastRun: null })
  writeRegistry(projectId, drafts)
  return id
}

/** Stores the result of each draft that was in a run: the latest, and in its history. */
export function recordRun(projectId: string, report: TestReport, by: DraftRun['by'] = 'assistant', runId: string = randomUUID()): void {
  const drafts = listDrafts(projectId)
  const at = new Date().toISOString()
  for (const draft of drafts) {
    const tests = report.tests.filter((test) => basename(test.file) === basename(draft.file))
    if (tests.length === 0) continue
    const count = (status: string): number => tests.filter((test) => test.status === status).length
    const failed = count('failed')
    draft.lastRun = { status: failed ? 'failed' : 'passed', at, passed: tests.length - failed, failed }
    const own: TestReport = {
      passed: count('passed'),
      failed,
      flaky: count('flaky'),
      skipped: count('skipped'),
      durationMs: tests.reduce((sum, test) => sum + test.durationMs, 0),
      tests
    }
    draft.runs = [{ id: runId, at, by, report: own }, ...(draft.runs ?? [])].slice(0, KEPT_RUNS)
  }
  writeRegistry(projectId, drafts)
  removeOldRuns(projectId, drafts)
}

/** Run folders no kept run points to. */
function removeOldRuns(projectId: string, drafts: Draft[]): void {
  if (!existsSync(runsDir(projectId))) return
  const kept = new Set(drafts.flatMap((draft) => (draft.runs ?? []).map((run) => run.id)))
  for (const name of readdirSync(runsDir(projectId))) {
    if (!kept.has(name)) rmSync(join(runsDir(projectId), name), { recursive: true, force: true })
  }
}

export function setDraftPersonal(projectId: string, draftId: string, personal: boolean): void {
  updateDraft(projectId, draftId, { personal })
}

export function renameDraft(projectId: string, draftId: string, name: string): void {
  const clean = name.trim()
  if (!clean) throw new Error('A test needs a name.')
  updateDraft(projectId, draftId, { name: clean })
}

function updateDraft(projectId: string, draftId: string, changes: Partial<Draft>): void {
  const drafts = listDrafts(projectId)
  const draft = drafts.find((d) => d.id === draftId)
  if (!draft) throw new Error('This test no longer exists.')
  Object.assign(draft, changes, { updatedAt: new Date().toISOString() })
  writeRegistry(projectId, drafts)
}

export function setTranslation(projectId: string, draftId: string, translation: Translation): void {
  const drafts = listDrafts(projectId)
  const draft = drafts.find((d) => d.id === draftId)
  if (!draft) return
  draft.translation = translation
  writeRegistry(projectId, drafts)
}

export function deleteDraft(projectId: string, draftId: string): void {
  const drafts = listDrafts(projectId)
  const draft = drafts.find((d) => d.id === draftId)
  if (!draft) return
  rmSync(join(draftsDir(projectId), draft.file), { force: true })
  const remaining = drafts.filter((d) => d.id !== draftId)
  writeRegistry(projectId, remaining)
  removeOldRuns(projectId, remaining)
}

/** Runs one draft in the live browser. Returns its report, or null when nothing ran. */
export function runDraft(projectId: string, draftId: string): Promise<TestReport | null> {
  return runDrafts(projectId, [draftId])
}

/**
 * Runs drafts one after another in the live browser, in one go. Returns the report, or null when
 * nothing ran (or the run was stopped before any test finished).
 */
export async function runDrafts(projectId: string, draftIds: string[]): Promise<TestReport | null> {
  if (running) throw new Error('Tests are already running. Wait until they are done, or press Stop.')
  const all = listDrafts(projectId)
  const chosen = draftIds.map((id) => all.find((d) => d.id === id)).filter((d): d is Draft => Boolean(d))
  if (chosen.length === 0) throw new Error('These tests no longer exist.')

  running = { projectId, draftIds: chosen.map((d) => d.id), controller: new AbortController() }
  writeRegistry(projectId, listDrafts(projectId))
  try {
    ensureRunner()
    await startBrowser()
    const dir = ensureDraftsProject(projectId)
    const runId = randomUUID()
    const reportFile = join(dir, 'last-run.json')
    rmSync(reportFile, { force: true })
    const files = chosen.map((d) => quote(d.file)).join(' ')
    await runCommand(`playwright test ${files} --reporter=line,json --output ${quote(join(runsDir(projectId), runId))}`, {
      cwd: dir,
      timeoutMs: 30 * 60_000,
      env: draftEnv(reportFile),
      signal: running.controller.signal
    })
    const report = readTestReport(reportFile)
    if (report) recordRun(projectId, report, 'tester', runId)
    return report
  } finally {
    running = null
    writeRegistry(projectId, listDrafts(projectId))
  }
}

/** Stops the tests running now. */
export function stopDrafts(projectId: string): void {
  if (running?.projectId === projectId) running.controller.abort()
}

export function isDraftRunning(): boolean {
  return running !== null
}

function nameFromFile(file: string): string {
  const words = basename(file).replace(/\.spec\.[jt]s$/, '').replace(/[-_]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

// --- Files the app writes into the drafts folder -------------------------------------------

const CONFIG = `// Written by QA-STE100-Studio. Draft tests run in the app's live browser.
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  // One test at a time: they share the live browser the tester is watching.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: process.env.QA_UI_URL || undefined,
    actionTimeout: 15_000,
    screenshot: 'only-on-failure'
  }
})
`

const FIXTURES = `// Written by QA-STE100-Studio. Draft tests import { test, expect } from '../fixtures'.
// "page" is a new tab in the app's live browser, with the tester's session (already logged in).
// The tester's environment is in process.env: QA_UI_URL, QA_API_URL, QA_USERNAME, QA_PASSWORD.
import { test as base, chromium, expect, type Browser, type BrowserContext, type Page } from '@playwright/test'

export const test = base.extend<{ context: BrowserContext; page: Page }, { liveBrowser: Browser }>({
  liveBrowser: [
    async ({}, use) => {
      const endpoint = process.env.QA_CDP_ENDPOINT
      if (!endpoint) throw new Error('Open the app: draft tests run in its live browser.')
      const browser = await chromium.connectOverCDP(endpoint)
      await use(browser)
      // Disconnect only: the live browser stays open for the tester.
    },
    { scope: 'worker' }
  ],
  context: async ({ liveBrowser }, use) => {
    await use(liveBrowser.contexts()[0])
  },
  page: async ({ context }, use) => {
    const page = await context.newPage()
    await use(page)
    await page.close()
  }
})

export { expect }
`
