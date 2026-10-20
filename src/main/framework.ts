import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, join, relative } from 'node:path'
import type { FrameworkProfile, InspectResult } from '../shared/api'
import { pickBaseBranch } from './baseBranch'
import { runCommand } from './process'

// Reads a framework folder to describe it. TypeScript (and JavaScript) and Python frameworks are
// accepted, with any test tool (Playwright, Cypress, WebdriverIO, pytest, Selenium…): drafts don't
// need the framework, it is read to learn the team's standards. More languages can come later. Only file names and dependency lists are read;
// .env and storage-state/ are never opened.

const CONFIG_FILES = ['playwright.config.ts', 'playwright.config.js', 'playwright.config.mjs']
const SKIPPED_DIRS = new Set(['node_modules', '.git', 'test-results', 'playwright-report', 'allure-results', 'allure-report', '.venv', 'venv', '__pycache__', '.tox'])
const PYTHON_FILES = ['requirements.txt', 'pyproject.toml', 'setup.py', 'setup.cfg', 'tox.ini', 'pytest.ini', 'Pipfile']
const TEST_FILE = /\.spec\.[jt]s$|\.test\.[jt]s$|^test_.*\.py$|_test\.py$/

export async function inspectFolder(path: string): Promise<InspectResult> {
  const problems: string[] = []

  if (!existsSync(path) || !statSync(path).isDirectory()) {
    return { ok: false, path, problems: ['This folder does not exist.'] }
  }

  if (!existsSync(join(path, '.git'))) {
    problems.push('This folder is not a git repository. Pick the folder you cloned from Azure DevOps or GitHub.')
  }
  if (problems.length > 0) return { ok: false, path, problems }

  const profile = await scanFramework(path)
  if (profile.kind === 'other') {
    return { ok: false, path, problems: ['For now the app supports frameworks in TypeScript or Python.'] }
  }
  if (!profile.git.remote) {
    return { ok: false, path, problems: ['This repository has no remote ("origin"). The app needs it to share tests for review.'] }
  }
  if (!profile.git.baseBranch) {
    return { ok: false, path, problems: ['The repository has no branches on its remote yet.'] }
  }

  const warnings: string[] = []
  if (profile.tools.length === 0) {
    warnings.push('No known test tool was found. The assistant learns the team\'s style from the existing tests.')
  }
  if (!profile.teamRules.claudeMd) warnings.push('No CLAUDE.md found: the assistant learns the team rules from the existing tests.')
  return { ok: true, path, profile, warnings }
}

export async function scanFramework(path: string): Promise<FrameworkProfile> {
  const pkg = readPackageJson(path)
  const configFile = CONFIG_FILES.find((file) => existsSync(join(path, file))) ?? null
  const testDir = join(path, 'tests')
  const nodePlaywright = Boolean(pkg?.devDependencies?.['@playwright/test'] ?? pkg?.dependencies?.['@playwright/test'])
  const python = PYTHON_FILES.some((file) => existsSync(join(path, file)))
  const typescript = existsSync(join(path, 'tsconfig.json')) || Boolean(pkg?.devDependencies?.typescript ?? pkg?.dependencies?.typescript)
  // A package.json makes it a Node (TypeScript/JavaScript) framework; Python files a Python one.
  const kind = pkg ? 'typescript' : python ? 'python' : 'other'

  return {
    name: pkg?.name ?? basename(path),
    kind,
    tools: detectTools(path, pkg, python),
    playwrightVersion: (pkg?.devDependencies?.['@playwright/test'] ?? pkg?.dependencies?.['@playwright/test'] ?? null)?.replace(/^[\^~]/, '') ?? null,
    configFile,
    language: pkg ? (typescript ? 'typescript' : 'javascript') : python ? 'python' : 'other',
    suites: scanSuites(testDir),
    pageObjects: countFiles(join(path, 'pages'), /\.(ts|js|py)$/),
    fixtures: countFiles(join(path, 'fixtures'), /\.(ts|js|py)$/),
    apiClients: countFiles(join(path, 'api'), /\.(ts|js|py)$/),
    teamRules: {
      claudeMd: existsSync(join(path, 'CLAUDE.md')),
      guidelines: existsSync(join(path, '.claude', 'qa-test-guidelines.md')),
      skills: listDirs(join(path, '.claude', 'skills'))
    },
    hasEnvExample: existsSync(join(path, '.env.example')),
    git: await readGitInfo(path)
  }
}

interface PackageJson {
  name?: string
  scripts?: Record<string, string>
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

export function readPackageJson(path: string): PackageJson | null {
  try {
    return JSON.parse(readFileSync(join(path, 'package.json'), 'utf8'))
  } catch {
    return null
  }
}

/** Each folder directly under tests/ is a suite; spec files at the top level count as "tests". */
function scanSuites(testDir: string): FrameworkProfile['suites'] {
  if (!existsSync(testDir)) return []
  const suites: FrameworkProfile['suites'] = []
  const topLevel = countFiles(testDir, TEST_FILE, false)
  if (topLevel > 0) suites.push({ folder: 'tests', specFiles: topLevel })
  for (const dir of listDirs(testDir)) {
    const specFiles = countFiles(join(testDir, dir), TEST_FILE)
    if (specFiles > 0) suites.push({ folder: relative(join(testDir, '..'), join(testDir, dir)).replace(/\\/g, '/'), specFiles })
  }
  return suites
}

function countFiles(dir: string, pattern: RegExp, recursive = true): number {
  if (!existsSync(dir)) return 0
  let count = 0
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (recursive && !SKIPPED_DIRS.has(entry.name)) count += countFiles(join(dir, entry.name), pattern)
    } else if (pattern.test(entry.name)) {
      count++
    }
  }
  return count
}

function listDirs(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !SKIPPED_DIRS.has(entry.name))
    .map((entry) => entry.name)
}

async function readGitInfo(path: string): Promise<FrameworkProfile['git']> {
  const git = async (args: string): Promise<string | null> => {
    const result = await runCommand(`git ${args}`, { cwd: path, timeoutMs: 15_000 })
    return result.code === 0 ? result.output.trim() : null
  }
  const [remote, branch, remoteBranches, remoteHead] = await Promise.all([
    git('remote get-url origin'),
    git('rev-parse --abbrev-ref HEAD'),
    git('branch -r --format=%(refname:short)'),
    git('symbolic-ref --quiet --short refs/remotes/origin/HEAD')
  ])
  const branches = (remoteBranches ?? '')
    .split(/\r?\n/)
    .map((name) => name.trim())
    .filter((name) => name.startsWith('origin/') && name !== 'origin/HEAD')
    .map((name) => name.slice('origin/'.length))
  const defaultBranch = remoteHead?.replace(/^origin\//, '') ?? null
  return { remote, branch: branch === 'HEAD' ? null : branch, baseBranch: pickBaseBranch(branches, defaultBranch) }
}

/** The test tools named in the dependency lists, for a plain description. */
function detectTools(path: string, pkg: PackageJson | null, python: boolean): string[] {
  const tools: string[] = []
  const nodeDeps = { ...pkg?.dependencies, ...pkg?.devDependencies }
  if (nodeDeps['@playwright/test'] || nodeDeps.playwright) tools.push('Playwright')
  if (nodeDeps['selenium-webdriver'] || nodeDeps.webdriverio) tools.push('Selenium')
  if (nodeDeps.cypress) tools.push('Cypress')
  if (python) {
    const text = PYTHON_FILES.map((file) => {
      try {
        return readFileSync(join(path, file), 'utf8').toLowerCase()
      } catch {
        return ''
      }
    }).join('\n')
    if (/\bpytest\b/.test(text)) tools.push('pytest')
    if (/\bplaywright\b/.test(text) && !tools.includes('Playwright')) tools.push('Playwright')
    if (/\bselenium\b/.test(text) && !tools.includes('Selenium')) tools.push('Selenium')
    if (tools.length === 0) tools.push('Python')
  }
  return tools
}
