import { app } from 'electron'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { RepoAccessResult, RepoConfig } from '../shared/api'
import { quote, runCommand } from './process'
import { deleteSecret, getSecret, setSecret } from './secrets'
import { loadSettings, updateSettings } from './settings'
import { getSshKey, sshEnv } from './sshKey'
import { parseLsRemote, pickBaseBranch } from './baseBranch'

// The QA team's framework repository. An admin sets the link and a read-only token once; the app
// clones and fetches with it, only to learn how the QA team writes tests. It never pushes.

const TOKEN_SECRET = 'repo-token'

export function getRepoConfig(): RepoConfig {
  const { repo } = loadSettings()
  return { ...repo, hasToken: getSecret(TOKEN_SECRET) !== null }
}

/**
 * Environment for git commands that talk to the server. The token goes in through git's
 * GIT_CONFIG_* variables, so it is never on a command line or written to .git/config.
 */
export function repoAuthEnv(): Record<string, string> {
  // SSH addresses use the tester's key; HTTPS addresses use the read-only token.
  const env: Record<string, string> = { GIT_TERMINAL_PROMPT: '0', ...sshEnv() }
  const token = getSecret(TOKEN_SECRET)
  if (token) Object.assign(env, tokenEnv(token))
  return env
}

export function isSshUrl(url: string): boolean {
  return /^(ssh:\/\/|[\w.-]+@[\w.-]+:)/.test(url.trim())
}

function tokenEnv(token: string): Record<string, string> {
  const basic = Buffer.from(`:${token}`).toString('base64')
  return {
    GIT_CONFIG_COUNT: '2',
    GIT_CONFIG_KEY_0: 'http.extraHeader',
    GIT_CONFIG_VALUE_0: `Authorization: Basic ${basic}`,
    // No credential helper: a refused token must fail, not open a Windows sign-in window.
    GIT_CONFIG_KEY_1: 'credential.helper',
    GIT_CONFIG_VALUE_1: '',
    GCM_INTERACTIVE: 'never'
  }
}

export async function saveRepoConfig(url: string, token: string): Promise<RepoAccessResult> {
  const cleanUrl = url.trim()
  const ssh = isSshUrl(cleanUrl)
  if (!ssh && !/^https:\/\/\S+$/.test(cleanUrl)) {
    return { ok: false, message: 'Paste the repository address: an SSH address (git@…) or an https:// link.' }
  }
  let env: Record<string, string>
  if (ssh) {
    if (!getSshKey().hasKey) return { ok: false, message: 'Create or import your SSH key first (below).' }
    env = { GIT_TERMINAL_PROMPT: '0', ...sshEnv() }
  } else {
    const useToken = token.trim() || getSecret(TOKEN_SECRET)
    if (!useToken) return { ok: false, message: 'Paste the read-only token, or use the SSH address with your key.' }
    env = { GIT_TERMINAL_PROMPT: '0', ...tokenEnv(useToken) }
  }

  const check = await runCommand(`git ls-remote --symref ${quote(cleanUrl)}`, {
    cwd: app.getPath('userData'),
    timeoutMs: 60_000,
    env
  })
  if (check.code !== 0) {
    if (ssh && /Permission denied|publickey/i.test(check.output)) {
      return {
        ok: false,
        message: 'The SSH key was not accepted. Add the public key (below) to your Azure DevOps or GitHub account, then try again.'
      }
    }
    // "could not read Username": the server refused the token and git wanted to ask for a login.
    if (/Authentication failed|could not read Username|401|403/i.test(check.output)) {
      return { ok: false, message: 'The token was not accepted. Check that it is valid and has Code (Read) access.' }
    }
    if (/not found|404/i.test(check.output)) return { ok: false, message: 'The repository was not found. Check the link.' }
    return { ok: false, message: `Could not reach the repository: ${check.output.trim().split('\n').pop()}` }
  }
  const { branches, defaultBranch } = parseLsRemote(check.output)
  if (!pickBaseBranch(branches, defaultBranch)) {
    return { ok: false, message: 'The repository has no branches yet.' }
  }

  if (!ssh && token.trim()) setSecret(TOKEN_SECRET, token.trim())
  updateSettings({ repo: { url: cleanUrl, localFolder: null } })
  return { ok: true }
}

export function useLocalFolder(path: string | null): RepoConfig {
  updateSettings({ repo: { ...loadSettings().repo, localFolder: path } })
  return getRepoConfig()
}

export function removeRepoToken(): void {
  deleteSecret(TOKEN_SECRET)
}

/**
 * Returns the folder the app's working copy is made from: the admin's local folder, or the
 * app's own clone of the repository (cloned the first time, fetched after).
 */
export async function getFrameworkSource(onOutput: (chunk: string) => void): Promise<string> {
  const { repo } = loadSettings()
  if (repo.localFolder) return repo.localFolder
  if (!repo.url) throw new Error('not-configured')

  const name = repo.url.split(/[/:]/).pop()?.replace(/\.git$/, '') || 'framework'
  const reposDir = join(app.getPath('userData'), 'repos')
  const clonePath = join(reposDir, name)
  if (existsSync(join(clonePath, '.git'))) return clonePath

  mkdirSync(reposDir, { recursive: true })
  const clone = await runCommand(`git clone ${quote(repo.url)} ${quote(clonePath)}`, {
    cwd: reposDir,
    timeoutMs: 10 * 60_000,
    env: repoAuthEnv(),
    onOutput
  })
  if (clone.code !== 0) throw new Error(`clone-failed:${clone.output.trim().split('\n').pop()}`)
  return clonePath
}
