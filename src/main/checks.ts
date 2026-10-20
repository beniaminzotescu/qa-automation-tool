import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { LINKS, type CheckId, type CheckResult, type Project } from '../shared/api'
import { readPackageJson } from './framework'
import { runCommand } from './process'

// Setup checks for a project's working copy. Each check says in plain words what is wrong
// and, where the app can, offers a button that fixes it.

const MIN_NODE_MAJOR = 20

type Output = (chunk: string) => void

export async function runChecks(project: Project): Promise<CheckResult[]> {
  const cwd = project.workspacePath
  const results: CheckResult[] = []

  results.push(await checkGit(cwd))
  // Node.js is needed by the app's own test runner, whatever the framework is.
  const node = await checkNode(cwd)
  results.push(node)
  // Packages, browser and code check are for TypeScript (Node) frameworks only.
  const pkg = readPackageJson(cwd)
  if (!pkg) return results
  const packages = { ...pkg.dependencies, ...pkg.devDependencies }
  const usesPlaywright = Boolean(packages['@playwright/test'] || packages.playwright)
  const hasTypeScript = Boolean(pkg.scripts?.typecheck) || existsSync(join(cwd, 'tsconfig.json'))

  const deps = node.state === 'ok' ? checkDependencies(cwd) : blocked('dependencies', 'Test packages', 'Node.js')
  results.push(deps)

  const depsReady = deps.state === 'ok'
  // The test browser only for Playwright frameworks; the code check only when there is TypeScript.
  if (usesPlaywright) {
    results.push(depsReady ? await checkBrowsers(cwd) : blocked('browsers', 'Test browsers', 'the test packages'))
  }
  if (hasTypeScript) {
    results.push(depsReady ? await checkTypecheck(cwd) : blocked('typecheck', 'Framework code', 'the test packages'))
  }

  return results
}

export async function fixCheck(project: Project, id: CheckId, onOutput: Output): Promise<CheckResult[]> {
  const cwd = project.workspacePath
  switch (id) {
    case 'dependencies': {
      // npm ci installs exactly what package-lock.json lists, like the team's pipeline does.
      const command = existsSync(join(cwd, 'package-lock.json')) ? 'npm ci' : 'npm install'
      onOutput(`> ${command}\n`)
      await runCommand(command, { cwd, onOutput, timeoutMs: 15 * 60_000 })
      break
    }
    case 'browsers':
      onOutput('> npx playwright install chromium\n')
      await runCommand('npx playwright install chromium', { cwd, onOutput, timeoutMs: 15 * 60_000 })
      break
    default:
      // Git, Node.js and code errors are fixed outside the app.
      break
  }
  return runChecks(project)
}

async function checkGit(cwd: string): Promise<CheckResult> {
  const result = await runCommand('git --version', { cwd, timeoutMs: 15_000 })
  if (result.code === 0) {
    return ok('git', 'Git', `Installed (${result.output.trim().replace('git version ', '')}).`)
  }
  return {
    id: 'git',
    title: 'Git',
    state: 'error',
    detail: 'Git is not installed. The app needs it to get the framework and to share your tests.',
    fix: null,
    manualCommand: 'winget install --id Git.Git -e',
    link: { label: 'Download Git', url: LINKS.gitDownload }
  }
}

async function checkNode(cwd: string): Promise<CheckResult> {
  const result = await runCommand('node --version', { cwd, timeoutMs: 15_000 })
  const version = result.output.trim()
  const major = Number(/^v(\d+)/.exec(version)?.[1] ?? 0)
  if (result.code === 0 && major >= MIN_NODE_MAJOR) return ok('node', 'Node.js', `Installed (${version}).`)

  return {
    id: 'node',
    title: 'Node.js',
    state: 'error',
    detail:
      result.code === 0
        ? `Node.js ${version} is too old. Version ${MIN_NODE_MAJOR} or newer is needed.`
        : 'Node.js is not installed. The tests run on Node.js.',
    fix: null,
    manualCommand: 'winget install OpenJS.NodeJS.LTS',
    link: { label: 'Download Node.js', url: LINKS.nodeDownload }
  }
}

function checkDependencies(cwd: string): CheckResult {
  // npm writes node_modules/.package-lock.json after every install, whatever the packages are.
  if (existsSync(join(cwd, 'node_modules', '.package-lock.json'))) {
    return ok('dependencies', 'Test packages', 'Installed.')
  }
  return {
    id: 'dependencies',
    title: 'Test packages',
    state: 'error',
    detail: 'The packages the framework needs are not installed yet. This takes a few minutes.',
    fix: { label: 'Install packages' }
  }
}

async function checkBrowsers(cwd: string): Promise<CheckResult> {
  // --dry-run lists where each browser should be, without downloading anything.
  const result = await runCommand('npx playwright install --dry-run chromium', { cwd, timeoutMs: 60_000 })
  const locations = [...result.output.matchAll(/Install location:\s+(.+)/g)].map((m) => m[1].trim())
  if (result.code === 0 && locations.length > 0 && locations.every((path) => existsSync(path))) {
    return ok('browsers', 'Test browsers', 'Chromium is installed.')
  }
  return {
    id: 'browsers',
    title: 'Test browsers',
    state: 'error',
    detail: 'The browser the tests run in is not installed yet. This downloads about 200 MB.',
    fix: { label: 'Install browser' },
    output: result.code === 0 ? undefined : result.output
  }
}

async function checkTypecheck(cwd: string): Promise<CheckResult> {
  const hasScript = Boolean(readPackageJson(cwd)?.scripts?.typecheck)
  const result = await runCommand(hasScript ? 'npm run typecheck' : 'npx tsc --noEmit', { cwd, timeoutMs: 5 * 60_000 })
  if (result.code === 0) return ok('typecheck', 'Framework code', 'No errors.')
  return {
    id: 'typecheck',
    title: 'Framework code',
    state: 'error',
    detail:
      'The framework code has errors, so new tests could fail for reasons that are not yours. ' +
      'Tell the framework owner. You can still continue.',
    fix: null,
    output: result.output
  }
}

function ok(id: CheckId, title: string, detail: string): CheckResult {
  return { id, title, state: 'ok', detail, fix: null }
}

function blocked(id: CheckId, title: string, waitingFor: string): CheckResult {
  return { id, title, state: 'blocked', detail: `Waiting for ${waitingFor}.`, fix: null }
}
