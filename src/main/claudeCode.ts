import { exec, execFile, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { ClaudeCodeStatus } from '../shared/api'

// Runs the user's own, unmodified Claude Code program. The user signs in through
// `claude auth login`; this module only reads whether they are signed in.

const COMMAND_TIMEOUT_MS = 20_000

/** Places Claude Code installs to when it is not on PATH (apps started from the Start menu can miss it). */
function fallbackPaths(): string[] {
  const paths = [join(homedir(), '.local', 'bin', 'claude.exe')]
  if (process.env.APPDATA) paths.push(join(process.env.APPDATA, 'npm', 'claude.cmd'))
  return paths
}

function run(file: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const options = { timeout: COMMAND_TIMEOUT_MS, windowsHide: true }
    const done = (error: Error | null, stdout: string): void => (error ? reject(error) : resolve(stdout))
    // .cmd shims (npm installs) can only be started through a shell on Windows.
    // The args are fixed strings from this module, never user input.
    if (file.toLowerCase().endsWith('.cmd')) exec(`"${file}" ${args.join(' ')}`, options, done)
    else execFile(file, args, options, done)
  })
}

export async function findClaude(): Promise<string | null> {
  try {
    const found = (await run('where.exe', ['claude'])).split(/\r?\n/).map((l) => l.trim())
    // Prefer something Windows can start directly (claude.exe or claude.cmd) over a bare shell script.
    const runnable = found.find((p) => /\.(exe|cmd)$/i.test(p))
    if (runnable) return runnable
  } catch {
    // Not on PATH.
  }
  return fallbackPaths().find((p) => existsSync(p)) ?? null
}

interface AuthStatus {
  loggedIn?: boolean
  email?: string
  subscriptionType?: string
}

export async function checkClaudeCode(): Promise<ClaudeCodeStatus> {
  const claude = await findClaude()
  if (!claude) return { state: 'not-installed' }

  let version: string
  try {
    version = (await run(claude, ['--version'])).trim().split(' ')[0]
  } catch {
    return { state: 'error', message: 'Claude Code is installed but did not start. Try reinstalling it.' }
  }

  let auth: AuthStatus
  try {
    auth = JSON.parse(await run(claude, ['auth', 'status', '--json']))
  } catch (error) {
    // `auth status` exits with an error code when nobody is signed in, but still prints JSON.
    const stdout = (error as { stdout?: string }).stdout
    try {
      auth = JSON.parse(stdout ?? '')
    } catch {
      return { state: 'signed-out', version }
    }
  }

  if (!auth.loggedIn) return { state: 'signed-out', version }
  return {
    state: 'ready',
    version,
    account: auth.email ?? null,
    plan: auth.subscriptionType ?? null
  }
}

export async function openClaudeLogin(): Promise<void> {
  const claude = await findClaude()
  if (!claude) throw new Error('Claude Code is not installed.')
  // A visible terminal window, so the user completes Anthropic's own sign-in flow there.
  spawn('cmd.exe', ['/c', 'start', 'Sign in to Claude', 'cmd.exe', '/k', claude, 'auth', 'login'], {
    detached: true,
    stdio: 'ignore'
  }).unref()
}
