import { app, BrowserWindow } from 'electron'
import { existsSync } from 'node:fs'
import { IPC, type Tool, type CheckResult, type PrepareStatus, type PrepareStep, type PrepareStepId, type Project } from '../shared/api'
import { fixCheck, runChecks } from './checks'
import { connectProject, listProjects, setSetupDone } from './projects'
import { getFrameworkSource } from './repo'
import { runCommand } from './process'
import { loadSettings } from './settings'

// "Preparing": gets the QA team's framework ready on this computer without the user doing
// anything technical. Only problems the user can't fix in the app are shown, in plain words.

const STEP_TITLES: Record<PrepareStepId, string> = {
  framework: 'Getting the test framework',
  workingCopy: 'Making a working copy',
  packages: 'Installing what the tests need',
  browsers: 'Installing the test browser',
  code: 'Checking that everything works'
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
    // Git (to get the framework) and Node.js (for the test runner) come first.
    const missing = await missingTools()
    if (missing.length) {
      update({ missingTools: missing })
      const names = missing.map((tool) => TOOL_NAMES[tool]).join(' and ')
      return stop('framework', `${names} must be installed on this computer first. Click Install below.`)
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

    setStep('packages', 'running')
    let checks = await runChecks(project)
    const blocker = toolBlocker(checks)
    if (blocker) return stop('packages', blocker)

    // Packages, browser and code check exist only for Node (Playwright) frameworks. Others are only
    // read by the app; draft tests use the app's own runner.
    if (!find(checks, 'dependencies')) {
      for (const step of ['packages', 'browsers', 'code'] as const) setStep(step, 'done', 'Not needed for this framework.')
    } else {
      if (find(checks, 'dependencies')?.state !== 'ok') checks = await fixCheck(project, 'dependencies', log)
      if (find(checks, 'dependencies')?.state !== 'ok') {
        return stop('packages', 'Could not install what the tests need. Check your internet connection and try again.')
      }
      setStep('packages', 'done')

      // The test browser exists as a check only for Playwright frameworks.
      if (!find(checks, 'browsers')) {
        setStep('browsers', 'done', 'Not needed for this framework.')
      } else {
        setStep('browsers', 'running')
        if (find(checks, 'browsers')?.state !== 'ok') checks = await fixCheck(project, 'browsers', log)
        if (find(checks, 'browsers')?.state !== 'ok') {
          return stop('browsers', 'Could not install the test browser. Check your internet connection and try again.')
        }
        setStep('browsers', 'done')
      }

      // The code check exists only when the framework has TypeScript.
      const typecheck = find(checks, 'typecheck')
      if (!typecheck) setStep('code', 'done', 'Not needed for this framework.')
      // A code problem belongs to the QA team; the user can still record tests.
      else if (typecheck.state === 'ok') setStep('code', 'done')
      else setStep('code', 'warning', 'The QA team has a problem in the framework right now. You can still record tests.')
    }

    setSetupDone(project.id, true)
    update({ running: false })
  } catch (error) {
    stop(status.steps.find((s) => s.state === 'running')?.id ?? 'framework', `Something went wrong: ${(error as Error).message}`)
  }
}

function stop(step: PrepareStepId, message: string): void {
  setStep(step, 'failed', message)
  update({ running: false, blocker: message })
}

function find(checks: CheckResult[], id: CheckResult['id']): CheckResult | undefined {
  return checks.find((check) => check.id === id)
}

/** Git or Node.js missing: something IT has to install. */
const TOOL_NAMES: Record<Tool, string> = { git: 'Git', node: 'Node.js' }
const WINGET_IDS: Record<Tool, string> = { git: 'Git.Git', node: 'OpenJS.NodeJS.LTS' }
const MIN_NODE_MAJOR = 20

async function missingTools(): Promise<Tool[]> {
  const cwd = app.getPath('userData')
  const missing: Tool[] = []
  if ((await runCommand('git --version', { cwd, timeoutMs: 15_000 })).code !== 0) missing.push('git')
  const node = await runCommand('node --version', { cwd, timeoutMs: 15_000 })
  if (node.code !== 0 || Number(/^v(\d+)/.exec(node.output.trim())?.[1] ?? 0) < MIN_NODE_MAJOR) missing.push('node')
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
  const installed = !(await missingTools()).includes(tool)
  if (installed) return { ok: true, message: `${TOOL_NAMES[tool]} is installed.` }
  return {
    ok: false,
    message: result.code === 0
      ? `${TOOL_NAMES[tool]} was installed, but the app can't find it yet. Close and open the app again.`
      : `${TOOL_NAMES[tool]} could not be installed. Ask IT to install it.`
  }
}

function toolBlocker(checks: CheckResult[]): string | null {
  const missing = checks.filter((c) => (c.id === 'git' || c.id === 'node') && c.state === 'error').map((c) => c.title)
  if (missing.length === 0) return null
  return `${missing.join(' and ')} must be installed on this computer first. Ask your IT team or QA team to install ${missing.length > 1 ? 'them' : 'it'}.`
}

function samePath(a: string, b: string): boolean {
  return a.replace(/[\\/]+$/, '').toLowerCase() === b.replace(/[\\/]+$/, '').toLowerCase()
}
