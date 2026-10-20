import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { query } from '@anthropic-ai/claude-agent-sdk'
import { getApiKey } from './apiKey'
import { findClaude } from './claudeCode'
import { loadSettings } from './settings'

// Runs one chat turn with Claude and streams its messages (the Claude Code stream-json format).
// Claude Code mode runs the user's own `claude` program; API key mode uses the Agent SDK.

export interface McpServer {
  command: string
  args: string[]
}

export interface TurnOptions {
  cwd: string
  /** Folders outside cwd Claude may read (the recording). */
  addDirs: string[]
  prompt: string
  sessionId: string | null
  appendSystemPrompt: string
  /** Files written by the caller, used in Claude Code mode. */
  systemPromptFile: string
  settingsFile: string
  mcpConfigFile: string
  mcpServers: Record<string, McpServer>
  allow: string[]
  deny: string[]
  env: Record<string, string>
  signal: AbortSignal
  /** Each message from Claude: system init, assistant, user (tool results), result. */
  onMessage(message: StreamMessage): void
}

/** Loose shape of a stream-json message; only the fields the app reads. */
export interface StreamMessage {
  type: string
  subtype?: string
  session_id?: string
  message?: { content?: ContentBlock[] | string }
  is_error?: boolean
  result?: string
  total_cost_usd?: number
  permission_denials?: { tool_name: string; tool_input: Record<string, unknown> }[]
}

export interface ContentBlock {
  type: string
  text?: string
  id?: string
  name?: string
  input?: Record<string, unknown>
  tool_use_id?: string
  content?: ContentBlock[] | string
  is_error?: boolean
  source?: { type: string; media_type?: string; data?: string }
}

export async function runTurn(options: TurnOptions): Promise<void> {
  if (loadSettings().aiMode === 'api-key') return runWithSdk(options)
  return runWithCli(options)
}

async function runWithCli(options: TurnOptions): Promise<void> {
  const claude = await findClaude()
  if (!claude) throw new Error('Claude Code is not installed. Open Settings to set it up.')

  const args = [
    '-p',
    '--input-format', 'stream-json',
    '--output-format', 'stream-json',
    '--verbose',
    '--append-system-prompt-file', options.systemPromptFile,
    '--settings', options.settingsFile,
    '--mcp-config', options.mcpConfigFile,
    '--strict-mcp-config',
    '--permission-mode', 'acceptEdits',
    ...options.addDirs.flatMap((dir) => ['--add-dir', dir]),
    ...(options.sessionId ? ['--resume', options.sessionId] : [])
  ]

  // npm installs claude as a .cmd file, which Windows can only start through a shell.
  const viaShell = claude.toLowerCase().endsWith('.cmd')
  const child = viaShell
    ? spawn([claude, ...args].map((a) => `"${a}"`).join(' '), {
        cwd: options.cwd,
        shell: true,
        windowsHide: true,
        env: { ...process.env, ...options.env }
      })
    : spawn(claude, args, { cwd: options.cwd, windowsHide: true, env: { ...process.env, ...options.env } })

  const abort = (): void => {
    if (child.pid) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true })
  }
  options.signal.addEventListener('abort', abort)

  let stderr = ''
  child.stderr.on('data', (data: Buffer) => (stderr = (stderr + data.toString()).slice(-4000)))

  const lines = createInterface({ input: child.stdout })
  lines.on('line', (line) => {
    if (!line.trim()) return
    try {
      options.onMessage(JSON.parse(line))
    } catch {
      // Not a JSON line (a warning). Ignore it.
    }
  })

  // One user message, then close stdin: Claude finishes the turn and exits.
  child.stdin.write(
    JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: options.prompt }] } }) + '\n'
  )
  child.stdin.end()

  const code = await new Promise<number | null>((resolve) => child.on('close', resolve))
  options.signal.removeEventListener('abort', abort)
  if (code !== 0 && !options.signal.aborted) {
    throw new Error(`Claude Code stopped unexpectedly (exit ${code}). ${stderr.trim()}`)
  }
}

async function runWithSdk(options: TurnOptions): Promise<void> {
  const apiKey = getApiKey()
  if (!apiKey) throw new Error('No Claude API key is saved. Open Settings to add one.')

  const abortController = new AbortController()
  options.signal.addEventListener('abort', () => abortController.abort())

  const mcpServers = Object.fromEntries(
    Object.entries(options.mcpServers).map(([name, server]) => [name, { type: 'stdio' as const, ...server }])
  )

  const conversation = query({
    prompt: options.prompt,
    options: {
      cwd: options.cwd,
      resume: options.sessionId ?? undefined,
      systemPrompt: { type: 'preset', preset: 'claude_code', append: options.appendSystemPrompt },
      mcpServers,
      allowedTools: options.allow,
      disallowedTools: options.deny,
      permissionMode: 'acceptEdits',
      abortController,
      additionalDirectories: options.addDirs,
      env: { ...process.env, ...options.env, ANTHROPIC_API_KEY: apiKey }
    }
  })

  try {
    for await (const message of conversation) {
      options.onMessage(message as unknown as StreamMessage)
    }
  } catch (error) {
    if (!options.signal.aborted) throw error
  }
}
