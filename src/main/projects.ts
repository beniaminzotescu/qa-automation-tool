import { app } from 'electron'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { ConnectResult, Project } from '../shared/api'
import { inspectFolder } from './framework'
import { quote, runCommand } from './process'
import { repoAuthEnv } from './repo'
import { loadSettings, updateSettings } from './settings'

// A project is a framework folder the user connected. The app works in its own git worktree
// of that folder, so it never switches branches or touches uncommitted work in the user's folder.

const workspacesDir = (): string => join(app.getPath('userData'), 'workspaces')

export function listProjects(): Project[] {
  return loadSettings().projects
}

export function getProject(id: string): Project {
  const project = listProjects().find((p) => p.id === id)
  if (!project) throw new Error(`Unknown project: ${id}`)
  return project
}

export async function connectProject(sourcePath: string, onOutput: (chunk: string) => void): Promise<ConnectResult> {
  const existing = listProjects().find((p) => samePath(p.sourcePath, sourcePath))
  if (existing && existsSync(existing.workspacePath)) return { ok: true, project: existing, warnings: [] }

  const inspection = await inspectFolder(sourcePath)
  if (!inspection.ok) return { ok: false, message: inspection.problems.join(' ') }

  const warnings: string[] = []
  const git = (args: string, cwd = sourcePath, timeoutMs = 120_000) =>
    runCommand(`git ${args}`, {
      cwd,
      timeoutMs,
      // The shared token, and never wait for a password prompt the user can't see.
      env: repoAuthEnv(),
      onOutput
    })

  const base = inspection.profile.git.baseBranch!
  onOutput(`Getting the latest version of ${base}…\n`)
  const fetch = await git(`fetch origin ${base}`)
  if (fetch.code !== 0) {
    warnings.push(
      `Could not get the latest ${base} from the server, so the app used the copy on this computer. ` +
        'Check your network and your access to the repository.'
    )
  }

  const name = inspection.profile.name
  const workspacePath = uniqueWorkspacePath(name)
  mkdirSync(workspacesDir(), { recursive: true })

  onOutput('\nCreating the app\'s working copy…\n')
  // Forget working copies whose folders were deleted, so git does not refuse the new one.
  await git('worktree prune')
  const add = await git(`worktree add --detach ${quote(workspacePath)} origin/${base}`)
  if (add.code !== 0) {
    return { ok: false, message: 'Could not create the app\'s working copy of the framework. Details:\n' + add.output.trim() }
  }

  const project: Project = {
    id: randomUUID(),
    name,
    sourcePath,
    workspacePath,
    addedAt: new Date().toISOString(),
    baseBranch: base
  }
  updateSettings({
    projects: [...listProjects().filter((p) => !samePath(p.sourcePath, sourcePath)), project]
  })
  return { ok: true, project, warnings }
}

export function setSetupDone(id: string, done: boolean): Project[] {
  getProject(id)
  return updateSettings({ projects: listProjects().map((p) => (p.id === id ? { ...p, setupDone: done } : p)) }).projects
}

export async function removeProject(id: string): Promise<Project[]> {
  const project = getProject(id)
  // Removes only the app's working copy. The user's folder stays as it is.
  // `git worktree remove` fails on long node_modules paths on Windows, so delete the folder
  // with Node (which handles long paths), then let git forget it.
  rmSync(project.workspacePath, { recursive: true, force: true, maxRetries: 3 })
  await runCommand('git worktree prune', { cwd: project.sourcePath, timeoutMs: 60_000 })
  return updateSettings({ projects: listProjects().filter((p) => p.id !== id) }).projects
}

function uniqueWorkspacePath(name: string): string {
  const safe = name.replace(/[^a-zA-Z0-9._-]/g, '-')
  let candidate = join(workspacesDir(), safe)
  for (let n = 2; existsSync(candidate); n++) candidate = join(workspacesDir(), `${safe}-${n}`)
  return candidate
}

function samePath(a: string, b: string): boolean {
  return a.replace(/[\\/]+$/, '').toLowerCase() === b.replace(/[\\/]+$/, '').toLowerCase()
}
