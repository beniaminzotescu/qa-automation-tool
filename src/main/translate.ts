import { app, dialog, shell, type BrowserWindow } from 'electron'
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { Draft, FrameworkKind, Project, SendResult } from '../shared/api'
import { draftsDir, listDrafts, setTranslation } from './drafts'
import { scanFramework } from './framework'
import { quote, runCommand } from './process'
import { getAccount } from './account'
import { repoAuthEnv } from './repo'

// S6: a strong draft is translated into the QA team's framework (by the assistant, in the app's
// working copy, on its own branch), committed locally, and sent for review: pushed with the
// tester's SSH key, with the pull-request page opened in the browser. Or exported as a zip.

const git = (project: Project, args: string, timeoutMs = 120_000) =>
  runCommand(`git ${args}`, { cwd: project.workspacePath, timeoutMs, env: repoAuthEnv() })

/** Projects connected before the base branch was detected used develop. */
export function baseBranchOf(project: Project): string {
  return project.baseBranch ?? 'develop'
}

/**
 * A fresh branch for the translation, from the latest base branch. Earlier translations are
 * committed on their own branches, so switching away loses nothing.
 */
export async function prepareTranslationBranch(project: Project, draft: Draft): Promise<string> {
  const base = baseBranchOf(project)
  await git(project, `fetch origin ${base}`)
  // Leftovers from an unfinished translation are thrown away; finished ones are committed.
  await git(project, 'reset --hard')
  await git(project, 'clean -fd')

  const slug = draft.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'test'
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  let branch = `feature/qa-${slug}-${stamp}`
  for (let n = 2; (await git(project, `rev-parse --verify --quiet refs/heads/${branch}`)).code === 0; n++) {
    branch = `feature/qa-${slug}-${stamp}-${n}`
  }
  const created = await git(project, `switch -c ${branch} origin/${base}`)
  if (created.code !== 0) throw new Error(`Could not start a branch for the translation: ${created.output.trim().split('\n').pop()}`)

  // The QA team's own settings (git-ignored, e.g. .env) live in their folder; the framework needs them to run.
  for (const file of ['.env']) {
    const source = join(project.sourcePath, file)
    if (existsSync(source) && !existsSync(join(project.workspacePath, file))) copyFileSync(source, join(project.workspacePath, file))
  }
  return branch
}

/** Is Python there to run a Python framework's test? Returns the command to use, or null. */
export async function findPython(project: Project): Promise<string | null> {
  for (const command of ['python', 'py']) {
    const result = await runCommand(`${command} --version`, { cwd: project.workspacePath, timeoutMs: 15_000 })
    if (result.code === 0 && /Python 3/.test(result.output)) return command
  }
  return null
}

export async function frameworkKind(project: Project): Promise<FrameworkKind> {
  return (await scanFramework(project.workspacePath)).kind
}

/** After the assistant's "translated" card: commit the test files locally on the branch. */
export async function commitTranslation(
  project: Project,
  draftId: string,
  card: { files: string[]; summary: string; verified: boolean; notes: string }
): Promise<void> {
  const draft = listDrafts(project.id).find((d) => d.id === draftId)
  if (!draft) return
  const branch = (await git(project, 'rev-parse --abbrev-ref HEAD')).output.trim()

  // Only the files the assistant names, and never settings or results.
  const files = card.files.filter((file) => !/(^|\/)\.env|storage-state|test-results|node_modules/.test(file))
  if (files.length) await git(project, `add -- ${files.map(quote).join(' ')}`)
  const message = [`Add test: ${draft.name}`, '', card.summary, '', card.verified ? 'Verified: ran and passed.' : 'Not verified: the test was not run in the framework.']
  if (card.notes) message.push('', card.notes)
  message.push('', 'Made with QA-STE100-Studio from a tester\'s recording.')
  const messageFile = join(app.getPath('temp'), `qa-commit-${Date.now()}.txt`)
  writeFileSync(messageFile, message.join('\n'))
  let commit = await git(project, `commit -F ${quote(messageFile)}`)
  // Git on this computer may not know the tester's name yet: use their environment's username.
  if (commit.code !== 0 && /tell me who you are|user\.email|user\.name/i.test(commit.output)) {
    const username = getAccount()?.username || 'QA tester'
    const email = username.includes('@') ? username : 'qa-ste100-studio@localhost'
    commit = await git(project, `-c user.name=${quote(username)} -c user.email=${quote(email)} commit -F ${quote(messageFile)}`)
  }
  rmSync(messageFile, { force: true })

  setTranslation(project.id, draftId, {
    branch,
    files,
    summary: card.summary,
    verified: card.verified,
    notes: card.notes,
    committed: commit.code === 0,
    translatedAt: new Date().toISOString(),
    sentAt: null,
    prUrl: null
  })
}

/** Pushes the translation's branch with the tester's key and opens the prefilled pull request. */
export async function sendForReview(project: Project, draftId: string): Promise<SendResult> {
  const draft = listDrafts(project.id).find((d) => d.id === draftId)
  const translation = draft?.translation
  if (!draft || !translation?.committed) return { ok: false, message: 'Translate the test into the framework first.' }

  const push = await git(project, `push -u origin ${translation.branch}`, 180_000)
  if (push.code !== 0) {
    if (/Permission denied|publickey|403|401|Authentication/i.test(push.output)) {
      return {
        ok: false,
        message: 'Your key may not push to this repository. Check it in Repository, and that your account may push branches.'
      }
    }
    return { ok: false, message: `The branch could not be sent: ${push.output.trim().split('\n').pop()}` }
  }

  const remote = (await git(project, 'remote get-url origin')).output.trim()
  const prUrl = pullRequestUrl(remote, translation.branch, baseBranchOf(project))
  if (prUrl) void shell.openExternal(prUrl)
  setTranslation(project.id, draftId, { ...translation, sentAt: new Date().toISOString(), prUrl })
  return {
    ok: true,
    message: prUrl
      ? 'Sent. The pull request page is open in your browser: check it and click Create.'
      : `Sent as the branch ${translation.branch}. Open a pull request for it on your git server.`,
    prUrl
  }
}

/** The page that creates a pull request from the branch into the base branch, for Azure DevOps and GitHub. */
export function pullRequestUrl(remote: string, branch: string, base: string): string | null {
  const q = (value: string): string => encodeURIComponent(value)
  // git@ssh.dev.azure.com:v3/org/project/repo  or  https://[user@]dev.azure.com/org/project/_git/repo
  const azureSsh = /ssh\.dev\.azure\.com:v3\/([^/]+)\/([^/]+)\/([^/\s]+)/.exec(remote)
  const azureHttps = /dev\.azure\.com\/([^/]+)\/([^/]+)\/_git\/([^/\s]+)/.exec(remote)
  const azure = azureSsh ?? azureHttps
  if (azure) {
    const [, org, projectName, repo] = azure
    return `https://dev.azure.com/${org}/${projectName}/_git/${repo.replace(/\.git$/, '')}/pullrequestcreate?sourceRef=${q(branch)}&targetRef=${q(base)}`
  }
  // git@github.com:owner/repo.git  or  https://github.com/owner/repo
  const github = /github\.com[:/]([^/]+)\/([^/\s]+?)(\.git)?$/.exec(remote)
  // GitHub reads branch names with "/" as they are in the compare path.
  if (github) return `https://github.com/${github[1]}/${github[2]}/compare/${base}...${branch}?expand=1`
  return null
}

/** A zip for the QA team: the translated files (if any), the draft, and a plain description. */
export async function exportForQa(project: Project, draftId: string, window: BrowserWindow | null): Promise<SendResult> {
  const draft = listDrafts(project.id).find((d) => d.id === draftId)
  if (!draft) return { ok: false, message: 'This test no longer exists.' }

  const options = { title: 'Save the test for the QA team', defaultPath: `${draft.name.replace(/[^\w -]+/g, '')}.zip`, filters: [{ name: 'Zip', extensions: ['zip'] }] }
  const target = window ? await dialog.showSaveDialog(window, options) : await dialog.showSaveDialog(options)
  if (target.canceled || !target.filePath) return { ok: false, message: 'Cancelled.' }

  const staging = join(app.getPath('temp'), `qa-export-${Date.now()}`)
  mkdirSync(join(staging, 'draft'), { recursive: true })
  copyFileSync(join(draftsDir(project.id), draft.file), join(staging, 'draft', basename(draft.file)))
  const translation = draft.translation
  if (translation?.files.length) {
    for (const file of translation.files) {
      const source = join(project.workspacePath, file)
      if (!existsSync(source)) continue
      const destination = join(staging, 'framework', file)
      mkdirSync(join(destination, '..'), { recursive: true })
      copyFileSync(source, destination)
    }
  }
  writeFileSync(
    join(staging, 'README.md'),
    [
      `# ${draft.name}`,
      '',
      draft.summary || '(no description)',
      '',
      translation
        ? `Translated into the framework on branch \`${translation.branch}\` (${translation.verified ? 'verified: ran and passed' : 'not verified'}).\n\n${translation.summary}${translation.notes ? `\n\n${translation.notes}` : ''}`
        : 'Not translated into the framework yet: `draft/` has the simple Playwright version.',
      '',
      'Made with QA-STE100-Studio.'
    ].join('\n')
  )
  rmSync(target.filePath, { force: true })
  const zip = await runCommand(
    `powershell -NoProfile -Command "Compress-Archive -Path '${staging}\\*' -DestinationPath '${target.filePath}'"`,
    { cwd: staging, timeoutMs: 120_000 }
  )
  rmSync(staging, { recursive: true, force: true })
  return zip.code === 0 ? { ok: true, message: `Saved as ${target.filePath}.`, prUrl: null } : { ok: false, message: 'The zip could not be made.' }
}
