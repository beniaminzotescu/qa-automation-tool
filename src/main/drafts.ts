import { app, BrowserWindow } from 'electron'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { IPC, type Draft, type DraftsUpdate, type TestReport, type Translation } from '../shared/api'
import { getAccount, getAccountPassword } from './account'
import { getDebuggingEndpoint, startBrowser } from './liveBrowser'
import { freshPath, quote, runCommand } from './process'
import { readTestReport } from './testReport'

// Draft tests: the tester's own tests, kept by the app, written as simple standard Playwright
// tests. They run in the live browser (through its debugging port), so the tester watches them.
// The framework is not needed for a draft; strong drafts are translated into it later.

// The test runner matches the app's own Playwright version.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const PLAYWRIGHT_VERSION: string = require('playwright-core/package.json').version

const runnerDir = (): string => join(app.getPath('userData'), 'runner')
export const draftsDir = (projectId: string): string => join(runnerDir(), 'drafts', projectId)
const registryFile = (projectId: string): string => join(draftsDir(projectId), 'drafts.json')

let runningDraft: { projectId: string; draftId: string } | null = null

/** Installs the test runner (Playwright Test) once, next to the drafts, so drafts can import it. */
export async function ensureRunner(onProgress?: (message: string) => void): Promise<void> {
  const installed = join(runnerDir(), 'node_modules', '@playwright', 'test', 'package.json')
  const current = existsSync(installed) ? (JSON.parse(readFileSync(installed, 'utf8')) as { version: string }).version : null
  if (current === PLAYWRIGHT_VERSION) return

  onProgress?.('Preparing the test runner. This takes a minute, only the first time…')
  mkdirSync(runnerDir(), { recursive: true })
  writeFileSync(
    join(runnerDir(), 'package.json'),
    JSON.stringify({ name: 'qa-asd-ste100-runner', private: true, dependencies: { '@playwright/test': PLAYWRIGHT_VERSION } }, null, 2)
  )
  const result = await runCommand('npm install --no-audit --no-fund', { cwd: runnerDir(), timeoutMs: 10 * 60_000 })
  if (result.code !== 0) throw new Error('The test runner could not be installed. Check your internet connection.')
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
    PATH: freshPath(),
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
    runningDraftId: runningDraft?.projectId === projectId ? runningDraft.draftId : null
  }
}

/** From the assistant's "ready" card: the test's name and summary. */
export function registerDraft(projectId: string, info: { name: string; file: string; summary: string }): void {
  const drafts = listDrafts(projectId)
  const file = `tests/${basename(info.file)}`
  const existing = drafts.find((draft) => basename(draft.file) === basename(file))
  const now = new Date().toISOString()
  if (existing) Object.assign(existing, { name: info.name || existing.name, summary: info.summary || existing.summary, updatedAt: now })
  else drafts.push({ id: randomUUID(), name: info.name || nameFromFile(file), file, summary: info.summary, createdAt: now, updatedAt: now, lastRun: null })
  writeRegistry(projectId, drafts)
}

/** Stores the latest result of each draft that was in a run. */
export function recordRun(projectId: string, report: TestReport): void {
  const drafts = listDrafts(projectId)
  for (const draft of drafts) {
    const tests = report.tests.filter((test) => basename(test.file) === basename(draft.file))
    if (tests.length === 0) continue
    const failed = tests.filter((test) => test.status === 'failed').length
    draft.lastRun = { status: failed ? 'failed' : 'passed', at: new Date().toISOString(), passed: tests.length - failed, failed }
  }
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
  writeRegistry(
    projectId,
    drafts.filter((d) => d.id !== draftId)
  )
}

/** Runs one draft in the live browser. Returns its report, or null when nothing ran. */
export async function runDraft(projectId: string, draftId: string): Promise<TestReport | null> {
  if (runningDraft) throw new Error('A test is already running.')
  const draft = listDrafts(projectId).find((d) => d.id === draftId)
  if (!draft) throw new Error('This test no longer exists.')

  runningDraft = { projectId, draftId }
  writeRegistry(projectId, listDrafts(projectId))
  try {
    await ensureRunner()
    await startBrowser()
    const dir = ensureDraftsProject(projectId)
    const reportFile = join(dir, 'last-run.json')
    rmSync(reportFile, { force: true })
    await runCommand(`npx playwright test ${quote(draft.file)} --reporter=line,json`, {
      cwd: dir,
      timeoutMs: 10 * 60_000,
      env: draftEnv(reportFile)
    })
    const report = readTestReport(reportFile)
    if (report) recordRun(projectId, report)
    return report
  } finally {
    runningDraft = null
    writeRegistry(projectId, listDrafts(projectId))
  }
}

function nameFromFile(file: string): string {
  const words = basename(file).replace(/\.spec\.[jt]s$/, '').replace(/[-_]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

// --- Files the app writes into the drafts folder -------------------------------------------

const CONFIG = `// Written by QA-ASD-STE100. Draft tests run in the app's live browser.
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

const FIXTURES = `// Written by QA-ASD-STE100. Draft tests import { test, expect } from '../fixtures'.
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
