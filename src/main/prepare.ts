import { app, BrowserWindow } from 'electron'
import { existsSync } from 'node:fs'
import { IPC, type Tool, type CheckResult, type PrepareStatus, type PrepareStep, type PrepareStepId, type Project } from '../shared/api'
import { fixCheck, runChecks } from './checks'
import { connectProject, listProjects, setSetupDone } from './projects'
import { getFrameworkSource } from './repo'
import { runCommand } from './process'
import { loadSettings } from './settings'

// "Preparing": gets the QA team's framework onto this computer without the user doing anything
// technical. Only problems the user can't fix in the app are shown, in plain words.
// It only gets the framework and makes the app's copy: that is all a tester needs to start. What the
// framework needs to run its own tests (its packages and browser) is installed in the background
// afterwards, and is only needed when a test is translated into the framework.

const STEP_TITLES: Record<PrepareStepId, string> = {
  framework: 'Getting the test framework',
  workingCopy: 'Making a working copy'
}

let status: PrepareStatus = { running: false, steps: freshSteps(), project: null, blocker: null, missingTools: [] }

function freshSteps(): PrepareStep[] {
  return (Object.keys(STEP_TITLES) as PrepareStepId[]).map((id) => ({ id, title: STEP_TITLES[id], state: 'waiting' }))
}

/** The prepared project for the current repository settings, if there is one. */
export function currentProject(): Project | null {
  const { repo } = loadSettings()
  const projects = listProjects().filter((p) => p.setupDone && existsSync(p.workspacePath))
  if (repo.localFolder) return projects.find((p) => samePath(p.sourcePath, repo.localFolder!)) ?? null
  if (repo.url) {
    const name = repo.url.split(/[/:]/).pop()?.replace(/\.git$/, '') ?? ''
    return projects.find((p) => /[\\/]repos[\\/]/.test(p.sourcePath) && p.sourcePath.endsWith(name)) ?? null
  }
  return null
}

export function getPrepareStatus(): PrepareStatus {
  return { ...status, project: status.running ? null : currentProject() }
}

function update(changes: Partial<PrepareStatus>): void {
  status = { ...status, ...changes }
  for (const window of BrowserWindow.getAllWindows()) window.webContents.send(IPC.prepareUpdate, getPrepareStatus())
}

function setStep(id: PrepareStepId, state: PrepareStep['state'], message?: string): void {
  update({ steps: status.steps.map((step) => (step.id === id ? { ...step, state, message } : step)) })
}

export async function startPrepare(): Promise<void> {
  if (status.running) return
  update({ running: true, steps: freshSteps(), blocker: null, missingTools: [] })
  const log = (): void => {}

  try {
    setStep('framework', 'running')
    // Git gets the framework. Nothing else has to be installed to start.
    const missing = await missingTools(['git'])
    if (missing.length) {
      update({ missingTools: missing })
      return stop('framework', 'Git must be installed on this computer first. Click Install below.')
    }
    let source: string
    try {
      source = await getFrameworkSource(log)
    } catch (error) {
      const message = (error as Error).message
      return stop(
        'framework',
        message === 'not-configured'
          ? 'No framework is chosen yet. Open Repository and choose a folder or clone a repository.'
          : 'Could not get the test framework. Check your internet connection, then try again. If it keeps failing, tell your QA team.'
      )
    }
    setStep('framework', 'done')

    setStep('workingCopy', 'running')
    const connected = await connectProject(source, log)
    if (!connected.ok) return stop('workingCopy', `Could not prepare the framework: ${connected.message}`)
    const project = connected.project
    setStep('workingCopy', 'done')

    setSetupDone(project.id, true)
    update({ running: false })
    void ensureFrameworkReady(project)
  } catch (error) {
    stop(status.steps.find((s) => s.state === 'running')?.id ?? 'framework', `Something went wrong: ${(error as Error).message}`)
  }
}

function stop(step: PrepareStepId, message: string): void {
  setStep(step, 'failed', message)
  update({ running: false, blocker: message })
}

// --- In the background: what the framework needs to run its own tests -----------------------

export interface FrameworkReady {
  ok: boolean
  /** Plain-language reason when it is not ready. */
  message: string | null
}

const readiness = new Map<string, Promise<FrameworkReady>>()
const ready = new Set<string>()

/** True once the framework's packages and browser are installed (in this session). */
export function isFrameworkReady(projectId: string): boolean {
  return ready.has(projectId)
}

/**
 * Installs the framework's packages and test browser, once. Started after preparing and when the app
 * opens; a translation waits for it. Everyone who asks meanwhile shares the same run.
 */
export function ensureFrameworkReady(project: Project): Promise<FrameworkReady> {
  const running = readiness.get(project.id)
  if (running) return running
  const run = installFrameworkNeeds(project).then((result) => {
    if (result.ok) ready.add(project.id)
    // A failure is tried again by the next translation.
    else readiness.delete(project.id)
    return result
  })
  readiness.set(project.id, run)
  return run
}

async function installFrameworkNeeds(project: Project): Promise<FrameworkReady> {
  const log = (): void => {}
  try {
    // The code check takes minutes and only matters to the QA team (Admin shows it).
    let checks = await runChecks(project, { typecheck: false })
    // No package.json: not a Node framework. The app only reads it until a translation runs it.
    if (!find(checks, 'dependencies')) return { ok: true, message: null }
    if (find(checks, 'node')?.state !== 'ok') {
      return {
        ok: false,
        message: 'Node.js is needed to run tests in this framework, and it is not installed. Ask IT to install Node.js, then try again.'
      }
    }
    if (find(checks, 'dependencies')?.state !== 'ok') checks = await fixCheck(project, 'dependencies', log)
    if (find(checks, 'dependencies')?.state !== 'ok') {
      return { ok: false, message: 'Could not install what the framework needs. Check your internet connection and try again.' }
    }
    if (find(checks, 'browsers') && find(checks, 'browsers')?.state !== 'ok') checks = await fixCheck(project, 'browsers', log)
    if (find(checks, 'browsers') && find(checks, 'browsers')?.state !== 'ok') {
      return { ok: false, message: "Could not install the framework's test browser. Check your internet connection and try again." }
    }
    return { ok: true, message: null }
  } catch (error) {
    return { ok: false, message: `Could not get the framework ready: ${(error as Error).message}` }
  }
}

function find(checks: CheckResult[], id: CheckResult['id']): CheckResult | undefined {
  return checks.find((check) => check.id === id)
}

/** Git or Node.js missing: something IT has to install. */
const TOOL_NAMES: Record<Tool, string> = { git: 'Git', node: 'Node.js' }
const WINGET_IDS: Record<Tool, string> = { git: 'Git.Git', node: 'OpenJS.NodeJS.LTS' }
const MIN_NODE_MAJOR = 20

async function missingTools(tools: Tool[]): Promise<Tool[]> {
  const cwd = app.getPath('userData')
  const missing: Tool[] = []
  if (tools.includes('git') && (await runCommand('git --version', { cwd, timeoutMs: 15_000 })).code !== 0) missing.push('git')
  if (tools.includes('node')) {
    const node = await runCommand('node --version', { cwd, timeoutMs: 15_000 })
    if (node.code !== 0 || Number(/^v(\d+)/.exec(node.output.trim())?.[1] ?? 0) < MIN_NODE_MAJOR) missing.push('node')
  }
  return missing
}

/** Installs Git or Node.js with winget, Windows' own installer. Windows may ask for permission. */
export async function installTool(tool: Tool): Promise<{ ok: boolean; message: string }> {
  const cwd = app.getPath('userData')
  if ((await runCommand('winget --version', { cwd, timeoutMs: 15_000 })).code !== 0) {
    return { ok: false, message: `Windows' installer (winget) is not available. Ask IT to install ${TOOL_NAMES[tool]}.` }
  }
  const result = await runCommand(
    `winget install --id ${WINGET_IDS[tool]} -e --silent --accept-package-agreements --accept-source-agreements`,
    { cwd, timeoutMs: 15 * 60_000 }
  )
  // winget exits with an error code when the program is already installed and up to date.
  const installed = (await missingTools([tool])).length === 0
  if (installed) return { ok: true, message: `${TOOL_NAMES[tool]} is installed.` }
  return {
    ok: false,
    message: result.code === 0
      ? `${TOOL_NAMES[tool]} was installed, but the app can't find it yet. Close and open the app again.`
      : `${TOOL_NAMES[tool]} could not be installed. Ask IT to install it.`
  }
}

function samePath(a: string, b: string): boolean {
  return a.replace(/[\\/]+$/, '').toLowerCase() === b.replace(/[\\/]+$/, '').toLowerCase()
}
