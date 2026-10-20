import { execFileSync, spawn } from 'node:child_process'

// Runs command-line tools (git, node, npm, npx) for the framework. Commands are built
// by the app from fixed strings and quoted paths, never from free text the user typed.

export interface CommandResult {
  code: number
  output: string
}

interface RunOptions {
  cwd: string
  timeoutMs?: number
  env?: Record<string, string>
  onOutput?(chunk: string): void
}

/** Output kept for "Show details". The full output still streams through onOutput. */
const MAX_KEPT_OUTPUT = 200_000

export function runCommand(command: string, options: RunOptions): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(command, {
      cwd: options.cwd,
      shell: true,
      windowsHide: true,
      env: { ...process.env, PATH: freshPath(), FORCE_COLOR: '0', ...options.env }
    })

    let output = ''
    const collect = (data: Buffer): void => {
      const chunk = data.toString()
      output = (output + chunk).slice(-MAX_KEPT_OUTPUT)
      options.onOutput?.(chunk)
    }
    child.stdout.on('data', collect)
    child.stderr.on('data', collect)

    const timer = options.timeoutMs
      ? setTimeout(() => {
          output += '\n[Stopped: the command took too long.]'
          killTree(child.pid)
        }, options.timeoutMs)
      : null

    child.on('error', (error) => {
      if (timer) clearTimeout(timer)
      resolve({ code: -1, output: output + error.message })
    })
    child.on('close', (code) => {
      if (timer) clearTimeout(timer)
      resolve({ code: code ?? -1, output })
    })
  })
}

export function quote(value: string): string {
  return `"${value.replace(/"/g, '')}"`
}

function killTree(pid: number | undefined): void {
  if (!pid) return
  // The shell starts the real process as a child, so kill the whole tree.
  spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true })
}

/**
 * PATH as Windows has it now. The app's own PATH is fixed when it starts, so without this
 * a program the user installs while the app is open (Node.js, Git) would not be found.
 */
let cachedPath: { value: string; at: number } | null = null

export function freshPath(): string {
  if (process.platform !== 'win32') return process.env.PATH ?? ''
  if (cachedPath && Date.now() - cachedPath.at < 10_000) return cachedPath.value
  cachedPath = { value: readPathFromRegistry(), at: Date.now() }
  return cachedPath.value
}

function readPathFromRegistry(): string {
  try {
    const script =
      "[Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')"
    const fromRegistry = execFileSync('powershell.exe', ['-NoProfile', '-Command', script], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 10_000
    }).trim()
    return `${fromRegistry};${process.env.PATH ?? ''}`
  } catch {
    return process.env.PATH ?? ''
  }
}
