import { app } from 'electron'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AzureItem, AzureTestPlansConfig, Project } from '../shared/api'
import { htmlToText } from './documents'
import { runCommand } from './process'
import { getSecret, setSecret } from './secrets'
import { addProposals, setTestCasesBusy } from './testCases'
import type { ParsedCase, ParsedStep } from './testCasesPrompt'

// Test cases from Azure DevOps Test Plans: the tester connects once (organization, project and a
// personal access token with "Test Management: Read" and "Work Items: Read"), picks a plan and a
// suite, and its test cases arrive as proposals. The steps are read directly; no assistant needed.

const TOKEN_SECRET = 'azure-test-plans-token'
const API_VERSION = '7.1'
const configFile = (): string => join(app.getPath('userData'), 'azure-test-plans.json')

interface SavedConfig {
  orgUrl: string
  project: string
}

function readConfig(): SavedConfig | null {
  try {
    return JSON.parse(readFileSync(configFile(), 'utf8')) as SavedConfig
  } catch {
    return null
  }
}

/** The saved connection, or the organization and project of the framework's repository when it is on Azure DevOps. */
export async function getAzureConfig(project: Project | null): Promise<AzureTestPlansConfig> {
  const hasToken = getSecret(TOKEN_SECRET) !== null
  const saved = readConfig()
  if (saved) return { ...saved, hasToken }
  const remote = project ? (await runCommand('git remote get-url origin', { cwd: project.workspacePath, timeoutMs: 15_000 })).output.trim() : ''
  const azure = /ssh\.dev\.azure\.com:v3\/([^/]+)\/([^/]+)\//.exec(remote) ?? /dev\.azure\.com\/([^/]+)\/([^/]+)\/_git\//.exec(remote)
  return azure
    ? { orgUrl: `https://dev.azure.com/${azure[1]}`, project: decodeURIComponent(azure[2]), hasToken }
    : { orgUrl: '', project: '', hasToken }
}

/** Saves the connection (an empty token keeps the saved one) and checks that it works. */
export async function saveAzureConfig(
  orgUrl: string,
  projectName: string,
  token: string
): Promise<{ ok: boolean; message: string; config: AzureTestPlansConfig }> {
  const url = orgUrl.trim().replace(/\/+$/, '')
  const name = projectName.trim()
  const fail = (message: string) => ({ ok: false, message, config: { orgUrl: url, project: name, hasToken: getSecret(TOKEN_SECRET) !== null } })
  if (!/^https:\/\/(dev\.azure\.com\/[^/\s]+|[^/\s]+\.visualstudio\.com)$/.test(url)) {
    return fail('The organization link looks like https://dev.azure.com/your-organization')
  }
  if (!name) return fail('Type the name of the Azure DevOps project.')
  if (token.trim()) setSecret(TOKEN_SECRET, token.trim())
  if (!getSecret(TOKEN_SECRET)) return fail('Paste a personal access token.')
  mkdirSync(app.getPath('userData'), { recursive: true })
  writeFileSync(configFile(), JSON.stringify({ orgUrl: url, project: name }, null, 2))
  try {
    await listAzurePlans()
    return { ok: true, message: 'Connected.', config: { orgUrl: url, project: name, hasToken: true } }
  } catch (error) {
    return fail((error as Error).message)
  }
}

export async function listAzurePlans(): Promise<AzureItem[]> {
  const plans = await getAll<{ id: number; name: string }>('testplan/plans')
  return plans.map(({ id, name }) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
}

/** The plan's suites, named with their parents ("Release 5 / Login"). */
export async function listAzureSuites(planId: number): Promise<AzureItem[]> {
  const suites = await getAll<{ id: number; name: string; parentSuite?: { id: number } }>(`testplan/Plans/${planId}/suites`)
  const byId = new Map(suites.map((suite) => [suite.id, suite]))
  const path = (suite: (typeof suites)[number]): string => {
    const parent = suite.parentSuite && byId.get(suite.parentSuite.id)
    // The root suite has the plan's name; leave it out of the path.
    return parent && parent.parentSuite ? `${path(parent)} / ${suite.name}` : suite.name
  }
  return suites.map((suite) => ({ id: suite.id, name: path(suite) })).sort((a, b) => a.name.localeCompare(b.name))
}

/** Reads the suite's test cases into the proposals. Runs in the background; progress shows on the screen. */
export async function importAzureSuite(projectId: string, planId: number, suiteId: number): Promise<void> {
  setTestCasesBusy(projectId, 'Getting the test cases from Azure DevOps…')
  try {
    const entries = await getAll<{ workItem: { id: number } }>(`testplan/Plans/${planId}/Suites/${suiteId}/TestCase`)
    const ids = entries.map((entry) => entry.workItem.id)
    const cases: ParsedCase[] = []
    // The work items API takes up to 200 ids at a time.
    for (let i = 0; i < ids.length; i += 200) {
      const chunk = ids.slice(i, i + 200)
      const items = await request<{ value: { id: number; fields: Record<string, string | undefined> }[] }>(
        `${org()}/_apis/wit/workitems?ids=${chunk.join(',')}&fields=System.Title,Microsoft.VSTS.TCM.Steps&api-version=${API_VERSION}`
      )
      for (const id of chunk) {
        const item = items.body.value.find((v) => v.id === id)
        if (!item) continue
        const steps = parseAdoSteps(item.fields['Microsoft.VSTS.TCM.Steps'] ?? '')
        cases.push({
          title: item.fields['System.Title'] ?? `Test case ${id}`,
          preconditions: '',
          steps: steps.length ? steps : [{ action: '(no steps written in Azure DevOps)', expected: null }],
          tags: []
        })
      }
    }
    setTestCasesBusy(projectId, null)
    addProposals(projectId, cases, { kind: 'ado', name: 'Azure DevOps' }, ids.map(String))
  } catch (error) {
    setTestCasesBusy(projectId, null, (error as Error).message)
  }
}

/**
 * The steps field of an Azure DevOps test case: XML with one <step> per step, each holding two
 * HTML strings (action, expected result). Shared steps (<compref>) are named by their work item.
 */
export function parseAdoSteps(xml: string): ParsedStep[] {
  const steps: ParsedStep[] = []
  for (const match of xml.matchAll(/<step\b[^>]*>([\s\S]*?)<\/step>|<compref\b[^>]*\bref="(\d+)"[^>]*>/g)) {
    if (match[2]) {
      steps.push({ action: `Do the shared steps of work item ${match[2]}`, expected: null })
      continue
    }
    const [action = '', expected = ''] = [...match[1].matchAll(/<parameterizedString\b[^>]*>([\s\S]*?)<\/parameterizedString>/g)].map((m) =>
      richText(m[1])
    )
    if (action || expected) steps.push({ action: action || '(no action written)', expected: expected || null })
  }
  return steps
}

/** An XML-escaped HTML string from the steps field, as plain text. */
function richText(escaped: string): string {
  const html = escaped
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
  return htmlToText(html.replace(/<\/div>/gi, '</p>').replace(/<div[^>]*>/gi, '<p>'))
    .replace(/\n{2,}/g, '\n')
    .trim()
}

// --- Talking to Azure DevOps -----------------------------------------------------------------

function org(): string {
  const config = readConfig()
  if (!config) throw new Error('Connect to Azure DevOps first.')
  return config.orgUrl
}

function projectApi(path: string): string {
  const config = readConfig()
  if (!config) throw new Error('Connect to Azure DevOps first.')
  return `${config.orgUrl}/${encodeURIComponent(config.project)}/_apis/${path}`
}

/** Every page of a Test Plans list (it pages with a continuation token). */
async function getAll<T>(path: string): Promise<T[]> {
  const all: T[] = []
  let token: string | null = null
  do {
    const url = `${projectApi(path)}?api-version=${API_VERSION}${token ? `&continuationToken=${encodeURIComponent(token)}` : ''}`
    const page: { body: { value: T[] }; continuation: string | null } = await request<{ value: T[] }>(url)
    all.push(...page.body.value)
    token = page.continuation
  } while (token)
  return all
}

async function request<T>(url: string): Promise<{ body: T; continuation: string | null }> {
  const token = getSecret(TOKEN_SECRET)
  if (!token) throw new Error('Paste a personal access token first.')
  let response: Response
  try {
    response = await fetch(url, {
      headers: { Authorization: `Basic ${Buffer.from(`:${token}`).toString('base64')}`, Accept: 'application/json' },
      redirect: 'manual'
    })
  } catch {
    throw new Error('Azure DevOps could not be reached. Check your internet connection.')
  }
  // A refused token gets a sign-in page (203 or a redirect) instead of an error code.
  if (response.status === 401 || response.status === 203 || (response.status >= 300 && response.status < 400)) {
    throw new Error('Azure DevOps refused the access token. Check that it is valid and may read Test Management and Work Items.')
  }
  if (response.status === 404) throw new Error('The organization or project was not found. Check both names.')
  if (!response.ok) throw new Error(`Azure DevOps answered with an error (${response.status}).`)
  return { body: (await response.json()) as T, continuation: response.headers.get('x-ms-continuationtoken') }
}
