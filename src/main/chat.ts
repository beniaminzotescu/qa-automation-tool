import { app, BrowserWindow } from 'electron'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { extname, isAbsolute, join, relative } from 'node:path'
import { STAGES, IPC, type Chat, type ChatItem, type ChatSummary, type Project, type Stage, type TestReport } from '../shared/api'
import { buildChatPrompt, type PromptApplication } from './chatPrompt'
import { runTurn, type ContentBlock, type McpServer, type StreamMessage } from './claudeRunner'
import { freshPath, quote, runCommand } from './process'
import { getAccount, getAccountPassword } from './account'
import { draftEnv, draftsDir, ensureDraftsProject, ensureRunner, listDrafts, recordRun, registerDraft } from './drafts'
import { getProject } from './projects'
import { baseBranchOf, commitTranslation, findPython, frameworkKind, prepareTranslationBranch } from './translate'
import { buildTranslationPrompt } from './translatePrompt'
import { knowledgeDir, knowledgeForPrompt } from './knowledge'
import { getDebuggingEndpoint, logInIfNeeded, startBrowser } from './liveBrowser'
import { setActor, stepsDir, takeUnsharedSteps } from './steps'
import { readTestReport } from './testReport'

// The test chat: one conversation per project at a time. Claude works in the tester's drafts
// folder (simple Playwright tests run in the live browser) and only reads the QA framework.
// This module starts each turn and turns Claude's messages into plain-language chat items.

const PLAYWRIGHT_MCP = '@playwright/mcp@0.0.83'
const BROWSER_SERVER = 'browser'

const running = new Map<string, AbortController>()

// All conversations of a project are kept: chats/<project>/conversations/<chat>/chat.json, plus
// files Claude may read (the tester's environment). current.json says which one is open.
const chatDir = (projectId: string): string => join(app.getPath('userData'), 'chats', projectId)
const conversationsDir = (projectId: string): string => join(chatDir(projectId), 'conversations')
const conversationDir = (projectId: string, chatId: string): string => join(conversationsDir(projectId), chatId)
const currentFile = (projectId: string): string => join(chatDir(projectId), 'current.json')

function readChat(projectId: string, chatId: string): Chat | null {
  const file = join(conversationDir(projectId, chatId), 'chat.json')
  if (!existsSync(file)) return null
  try {
    const chat: Chat = JSON.parse(readFileSync(file, 'utf8'))
    // A turn can't still be running after the app restarted.
    if (chat.status !== 'idle' && !running.has(projectId)) chat.status = 'idle'
    return chat
  } catch {
    return null
  }
}

/** Earlier versions kept one conversation in chats/<project>/chat.json: move it into the list. */
function migrateSingleChat(projectId: string): void {
  const legacy = join(chatDir(projectId), 'chat.json')
  if (!existsSync(legacy)) return
  try {
    const chat: Chat = JSON.parse(readFileSync(legacy, 'utf8'))
    mkdirSync(conversationDir(projectId, chat.id), { recursive: true })
    renameSync(legacy, join(conversationDir(projectId, chat.id), 'chat.json'))
    setCurrent(projectId, chat.id)
  } catch {
    rmSync(legacy, { force: true })
  }
}

function setCurrent(projectId: string, chatId: string | null): void {
  mkdirSync(chatDir(projectId), { recursive: true })
  writeFileSync(currentFile(projectId), JSON.stringify({ id: chatId }))
}

/** The open conversation, or null when the tester starts a new one. */
export function getChat(projectId: string): Chat | null {
  migrateSingleChat(projectId)
  try {
    const { id } = JSON.parse(readFileSync(currentFile(projectId), 'utf8')) as { id: string | null }
    return id ? readChat(projectId, id) : null
  } catch {
    return null
  }
}

function save(chat: Chat): void {
  mkdirSync(conversationDir(chat.projectId, chat.id), { recursive: true })
  writeFileSync(join(conversationDir(chat.projectId, chat.id), 'chat.json'), JSON.stringify(chat, null, 1))
  setCurrent(chat.projectId, chat.id)
  emit(chat.projectId, chat)
}

function emit(projectId: string, chat: Chat | null): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(IPC.chatUpdate, { projectId, chat })
  }
}

/** Past conversations, newest first, titled by their first message. */
export function listChats(projectId: string): ChatSummary[] {
  migrateSingleChat(projectId)
  if (!existsSync(conversationsDir(projectId))) return []
  const summaries: ChatSummary[] = []
  for (const id of readdirSync(conversationsDir(projectId))) {
    const chat = readChat(projectId, id)
    if (!chat || chat.items.length === 0) continue
    const first = chat.items.find((item) => item.kind === 'user')
    const updatedAt = statSync(join(conversationDir(projectId, id), 'chat.json')).mtime.toISOString()
    summaries.push({
      id,
      title: first && first.kind === 'user' ? first.text.replace(/\s+/g, ' ').slice(0, 80) : 'Conversation',
      createdAt: chat.createdAt,
      updatedAt,
      messages: chat.items.filter((item) => item.kind === 'user' || item.kind === 'assistant').length
    })
  }
  return summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

/** Reopens a past conversation; the next message continues it. */
export function openChat(projectId: string, chatId: string): Chat | null {
  if (running.has(projectId)) throw new Error('Wait until the assistant has finished.')
  const chat = readChat(projectId, chatId)
  if (!chat) return null
  setCurrent(projectId, chatId)
  emit(projectId, chat)
  return chat
}

export function deleteChat(projectId: string, chatId: string): ChatSummary[] {
  const current = getChat(projectId)
  if (current?.id === chatId) {
    if (running.has(projectId)) throw new Error('Wait until the assistant has finished.')
    setCurrent(projectId, null)
    emit(projectId, null)
  }
  const chat = readChat(projectId, chatId)
  if (chat?.recordingDir) rmSync(chat.recordingDir, { recursive: true, force: true })
  rmSync(conversationDir(projectId, chatId), { recursive: true, force: true })
  return listChats(projectId)
}

/** A chat item without its id, for each kind of item. */
type NewItem = ChatItem extends infer T ? (T extends ChatItem ? Omit<T, 'id'> : never) : never

function push(chat: Chat, item: NewItem): void {
  chat.items.push({ ...item, id: randomUUID() } as ChatItem)
}

function notice(chat: Chat, text: string, tone: 'info' | 'error' = 'info'): void {
  push(chat, { kind: 'notice', tone, text })
  save(chat)
}

interface SendOptions {
  /** What the chat shows instead of the full prompt (e.g. for a recording hand-off). */
  display?: string
  /** A recording folder Claude may read (recording.json and screenshots). */
  recordingDir?: string
  /** Start translating this draft into the framework (S6). */
  translateDraftId?: string
}

/** What a turn works on: drafts (in the drafts folder) or a translation (in the framework copy). */
type TurnMode = { kind: 'draft' } | { kind: 'translate'; draftId: string }

export async function sendMessage(project: Project, text: string, options: SendOptions = {}): Promise<void> {
  if (running.has(project.id)) throw new Error('Still working on the previous message.')
  const controller = new AbortController()
  running.set(project.id, controller)

  const chat: Chat = getChat(project.id) ?? newChat(project.id)
  if (options.recordingDir) chat.recordingDir = options.recordingDir
  push(chat, { kind: 'user', text: options.display ?? text })
  // Steps recorded in the live browser since the last message go with this message.
  const recorded = takeUnsharedSteps(project.id)
  const prompt = recorded ? [recorded, text].join('\n\n') : text
  chat.status = 'preparing'
  save(chat)

  try {
    await ensureRunner((message) => notice(chat, message))
    const application = await connectBrowser(project)
    if (options.translateDraftId) {
      const draft = listDrafts(project.id).find((d) => d.id === options.translateDraftId)
      if (!draft) throw new Error('This test no longer exists.')
      notice(chat, 'Getting the latest version of the framework…')
      await prepareTranslationBranch(project, draft)
      chat.translatingDraftId = draft.id
      // A new translation starts a fresh conversation in the framework folder.
      chat.translationSessionId = null
    }
    const mode: TurnMode = chat.translatingDraftId ? { kind: 'translate', draftId: chat.translatingDraftId } : { kind: 'draft' }
    chat.status = 'working'
    save(chat)
    await runClaude(project, chat, prompt, application, mode, controller.signal)
  } catch (error) {
    if (!controller.signal.aborted) {
      push(chat, { kind: 'notice', tone: 'error', text: `Something went wrong: ${(error as Error).message}` })
    }
  } finally {
    running.delete(project.id)
    chat.status = 'idle'
    save(chat)
  }
}

export function stopChat(projectId: string): void {
  const controller = running.get(projectId)
  if (!controller) return
  controller.abort()
  const chat = getChat(projectId)
  if (chat) notice(chat, 'Stopped. Send a message to continue.')
}

/** Starts a new conversation. The current one stays in the past chats; kept tests are not touched. */
export async function discardChat(project: Project): Promise<void> {
  if (running.has(project.id)) throw new Error('Wait until the assistant has finished.')
  setCurrent(project.id, null)
  emit(project.id, null)
}

/**
 * Claude uses the live browser the tester sees (through its debugging port), so every action
 * Claude takes is visible in the Studio. The tester's own login session is already in it.
 */
async function connectBrowser(project: Project): Promise<PromptApplication> {
  const projectId = project.id
  const account = getAccount()
  if (!account) throw new Error('Your environment is not set up. Open "Your environment" first.')
  await startBrowser()
  // A login page is the app's job, not the assistant's: log in first if the tester gave a login.
  await logInIfNeeded()

  // The tester's environment, for logging in and for tests. These are the tester's own test
  // account details (not secrets of the team), kept in the app's data folder, outside the framework.
  let environmentFile: string | null = null
  const password = getAccountPassword()
  if (account.username || password) {
    environmentFile = join(chatDir(projectId), 'environment.json')
    mkdirSync(chatDir(projectId), { recursive: true })
    writeFileSync(
      environmentFile,
      JSON.stringify({ uiUrl: account.appUrl, apiUrl: account.apiUrl || null, username: account.username || null, password }, null, 2)
    )
  }
  return {
    websiteUrl: account.appUrl,
    apiUrl: account.apiUrl,
    environmentFile,
    browserServer: getDebuggingEndpoint() ? BROWSER_SERVER : null,
    frameworkPath: project.workspacePath
  }
}

async function runClaude(
  project: Project,
  chat: Chat,
  prompt: string,
  application: PromptApplication,
  mode: TurnMode,
  signal: AbortSignal
): Promise<void> {
  // Files for this turn (instructions, settings, results, screenshots) live with the conversation.
  const dir = conversationDir(project.id, chat.id)
  // Drafts: Claude works in the tester's drafts folder and only reads the framework.
  // Translation: Claude works in the app's copy of the framework, on the branch the app made.
  const cwd = mode.kind === 'draft' ? ensureDraftsProject(project.id) : project.workspacePath
  const reportFile = join(dir, 'report.json')

  const mcpServers: Record<string, McpServer> = {}
  if (application.browserServer) {
    mcpServers[application.browserServer] = {
      command: 'cmd',
      args: [
        '/c', 'npx', '-y', PLAYWRIGHT_MCP,
        '--cdp-endpoint', getDebuggingEndpoint()!,
        '--output-dir', join(dir, 'browser')
      ]
    }
  }

  // Reading is allowed everywhere (the framework is read to learn its naming). Edits are not in the
  // list: in acceptEdits mode they are accepted only inside the working folders, so the framework
  // copy can't be changed.
  const commands =
    mode.kind === 'draft'
      ? ['npx playwright test', 'npx tsc', 'node', 'ls', 'dir']
      : ['npx playwright test', 'npm run', 'npx tsc', 'node', 'python -m pytest', 'py -m pytest', 'pytest', 'git status', 'git diff', 'git log', 'ls', 'dir']
  const allow = [
    'Read', 'Glob', 'Grep', 'TodoWrite', 'Task',
    ...(mode.kind === 'translate' ? ['Skill'] : []),
    ...['Bash', 'PowerShell'].flatMap((shell) => commands.map((command) => `${shell}(${command}:*)`)),
    ...Object.keys(mcpServers).map((name) => `mcp__${name}`)
  ]
  const deny = [
    // The QA team's settings with secrets are used by the framework, never read by the assistant.
    ...(mode.kind === 'translate' ? ['Read(./.env)', 'Read(./.env.*)', 'Read(./storage-state/**)'] : []),
    ...['Bash', 'PowerShell'].flatMap((shell) =>
      ['commit', 'push', 'checkout', 'switch', 'reset', 'branch', 'stash', 'rebase', 'merge', 'clean'].map(
        (command) => `${shell}(git ${command}:*)`
      )
    ),
    'AskUserQuestion', 'EnterPlanMode', 'ExitPlanMode', 'WebSearch'
  ]
  // Claude may read only the documentation links of the knowledge base and of the recording.
  const knowledge = knowledgeForPrompt(project.id)
  knowledge.links.push(...recordingDocLinks(chat.recordingDir).map((url) => ({ url, note: '' })))
  for (const host of new Set(knowledge.links.map((link) => hostOf(link.url)).filter(Boolean))) {
    allow.push(`WebFetch(domain:${host})`)
  }

  const appendSystemPrompt =
    mode.kind === 'draft' ? buildChatPrompt(application, knowledge) : await translationPrompt(project, mode.draftId)
  const systemPromptFile = join(dir, 'system-prompt.md')
  const settingsFile = join(dir, 'claude-settings.json')
  const mcpConfigFile = join(dir, 'mcp.json')
  mkdirSync(dir, { recursive: true })
  writeFileSync(systemPromptFile, appendSystemPrompt)
  writeFileSync(settingsFile, JSON.stringify({ permissions: { allow, deny } }, null, 2))
  writeFileSync(mcpConfigFile, JSON.stringify({ mcpServers }, null, 2))

  const toolUses = new Map<string, { name: string; input: Record<string, unknown> }>()

  // While Claude works, what happens in the live browser is Claude's doing.
  setActor('claude')
  try {
    await runTurn({
      addDirs: [
        stepsDir(project.id),
        chatDir(project.id),
        knowledgeDir(project.id),
        ...(mode.kind === 'translate' ? [draftsDir(project.id)] : []),
        ...(chat.recordingDir ? [chat.recordingDir] : [])
      ],
      cwd,
      prompt,
      sessionId: mode.kind === 'draft' ? chat.sessionId : (chat.translationSessionId ?? null),
      appendSystemPrompt,
      systemPromptFile,
      settingsFile,
      mcpConfigFile,
      mcpServers,
      allow,
      deny,
      // Drafts: the live browser and the tester's environment, so Claude's runs work like the app's.
      // Translations: the framework runs with the QA team's own settings, in the background.
      env:
        mode.kind === 'draft'
          ? draftEnv(reportFile)
          : { PATH: freshPath(), HEADLESS: 'true', FORCE_COLOR: '0', PLAYWRIGHT_JSON_OUTPUT_FILE: reportFile },
      signal,
      onMessage: (message) => {
        handleMessage(chat, message, { cwd, dir, reportFile, toolUses, mode, project })
        save(chat)
      }
    })
  } finally {
    setActor('user')
  }
}

interface TurnContext {
  mode: TurnMode
  project: Project
  cwd: string
  dir: string
  reportFile: string
  toolUses: Map<string, { name: string; input: Record<string, unknown> }>
}

function handleMessage(chat: Chat, message: StreamMessage, context: TurnContext): void {
  if (message.session_id) {
    if (context.mode.kind === 'draft') chat.sessionId = message.session_id
    else chat.translationSessionId = message.session_id
  }
  const blocks = Array.isArray(message.message?.content) ? message.message.content : []

  if (message.type === 'assistant') {
    for (const block of blocks) {
      if (block.type === 'text' && block.text?.trim()) {
        push(chat, { kind: 'assistant', text: block.text.trim() })
        if (block.text.includes('```tfb-scenarios')) advance(chat, 'plan')
        if (block.text.includes('```tfb-ready')) {
          advance(chat, 'ready')
          keepDraft(chat.projectId, block.text)
        }
        if (block.text.includes('```tfb-translated') && context.mode.kind === 'translate') {
          finishTranslation(chat, context.project, context.mode.draftId, block.text)
        }
      } else if (block.type === 'tool_use' && block.id && block.name) {
        const input = block.input ?? {}
        context.toolUses.set(block.id, { name: block.name, input })
        const { label, detail, stage } = describeTool(block.name, input, context.cwd)
        push(chat, { kind: 'activity', label, detail })
        if (stage) advance(chat, stage)
      }
    }
  } else if (message.type === 'user') {
    for (const block of blocks) {
      if (block.type !== 'tool_result' || !block.tool_use_id) continue
      const tool = context.toolUses.get(block.tool_use_id)
      saveImages(chat, block, context.dir)
      if (tool && isTestRun(tool.name, tool.input)) collectReport(chat, context.reportFile)
    }
  } else if (message.type === 'result') {
    chat.costUsd += message.total_cost_usd ?? 0
    if (message.is_error) {
      push(chat, { kind: 'notice', tone: 'error', text: `The assistant stopped with an error: ${message.result ?? message.subtype}` })
    }
    if (message.permission_denials?.length) {
      // Skipped commands are technical details, not news for the tester: they go with the
      // assistant's steps (under "Show details"), before its last message.
      const what = [...new Set(message.permission_denials.map((d) => describeTool(d.tool_name, d.tool_input, context.cwd).detail ?? d.tool_name))]
      const skipped: ChatItem[] = what.map((detail) => ({
        kind: 'activity',
        id: randomUUID(),
        label: "Skipped a command the app doesn't allow",
        detail
      }))
      const lastAssistant = chat.items.map((item) => item.kind).lastIndexOf('assistant')
      chat.items.splice(lastAssistant === -1 ? chat.items.length : lastAssistant, 0, ...skipped)
    }
  }
}

function advance(chat: Chat, stage: Stage): void {
  if (STAGES.indexOf(stage) > STAGES.indexOf(chat.stage)) chat.stage = stage
}

function isTestRun(name: string, input: Record<string, unknown>): boolean {
  return (name === 'Bash' || name === 'PowerShell') && /playwright test/.test(String(input.command ?? ''))
}

function collectReport(chat: Chat, reportFile: string): void {
  const report = readTestReport(reportFile)
  if (!report) return
  push(chat, { kind: 'test-result', report })
  recordRun(chat.projectId, report)
  // Keep it out of the way of the next run.
  renameSync(reportFile, `${reportFile}.${Date.now()}`)
}

/** Screenshots from the browser come back as images in tool results. */
function saveImages(chat: Chat, block: ContentBlock, dir: string): void {
  const parts = Array.isArray(block.content) ? block.content : []
  for (const part of parts) {
    const data = part.source?.data ?? (part as { data?: string }).data
    if (part.type !== 'image' || !data) continue
    const mediaType = part.source?.media_type ?? (part as { mimeType?: string }).mimeType ?? 'image/png'
    const imagesDir = join(dir, 'screenshots')
    mkdirSync(imagesDir, { recursive: true })
    const path = join(imagesDir, `${Date.now()}${mediaType.includes('jpeg') ? '.jpg' : '.png'}`)
    writeFileSync(path, Buffer.from(data, 'base64'))
    push(chat, { kind: 'screenshot', path })
  }
}

/** One plain-language line for each thing Claude does. */
function describeTool(
  name: string,
  input: Record<string, unknown>,
  cwd: string
): { label: string; detail: string | null; stage: Stage | null } {
  const file = typeof input.file_path === 'string' ? relative(cwd, input.file_path).replace(/\\/g, '/') : null
  const command = typeof input.command === 'string' ? input.command : null

  if (name.startsWith(`mcp__${BROWSER_SERVER}__`)) {
    const action = name.split('__').pop() ?? ''
    const target = String(input.element ?? input.url ?? '')
    const labels: Record<string, string> = {
      browser_navigate: `Opening ${input.url ?? 'a page'}`,
      browser_click: `Clicking ${target || 'on the page'}`,
      browser_type: `Typing into ${target || 'a field'}`,
      browser_fill_form: 'Filling in a form',
      browser_snapshot: 'Looking at the page',
      browser_take_screenshot: 'Taking a screenshot',
      browser_wait_for: 'Waiting for the page',
      browser_network_requests: 'Checking what the page sends to the server'
    }
    return { label: labels[action] ?? 'Using the application', detail: `${action} ${target}`.trim(), stage: 'explore' }
  }

  switch (name) {
    case 'Read':
    case 'Glob':
    case 'Grep':
      return { label: 'Reading the framework', detail: file ?? String(input.pattern ?? ''), stage: null }
    case 'Edit':
    case 'Write':
    case 'MultiEdit': {
      const label = file?.startsWith('tests/')
        ? 'Writing the test'
        : file?.startsWith('pages/')
          ? 'Updating the description of a page'
          : 'Updating the test setup'
      return { label, detail: file, stage: 'write' }
    }
    case 'Bash':
    case 'PowerShell':
      if (command && /playwright test/.test(command)) return { label: 'Running the test', detail: command, stage: 'check' }
      if (command && /typecheck|tsc/.test(command)) return { label: 'Checking the code for mistakes', detail: command, stage: null }
      if (command && /^git /.test(command)) return { label: 'Looking at the changes', detail: command, stage: null }
      return { label: 'Running a helper command', detail: command, stage: null }
    case 'Skill':
      return { label: "Following the team's test-writing guide", detail: String(input.skill ?? input.command ?? ''), stage: null }
    case 'TodoWrite':
      return { label: 'Planning the work', detail: null, stage: null }
    case 'Task':
    case 'Agent':
      return { label: 'Working on a part of the task', detail: String(input.description ?? ''), stage: null }
    default:
      return { label: 'Working', detail: name, stage: null }
  }
}

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webm': 'video/webm',
  '.mp4': 'video/mp4'
}

/** Screenshots and videos from test runs, only from the working copy or the chat folder. */
export function readAttachment(project: Project, path: string): string | null {
  const roots = [project.workspacePath, chatDir(project.id), stepsDir(project.id)]
  const allowed = roots.some((root) => isInside(root, path))
  const mime = MIME[extname(path).toLowerCase()]
  if (!allowed || !mime || !existsSync(path)) return null
  return `data:${mime};base64,${readFileSync(path).toString('base64')}`
}

export function openTrace(project: Project, path: string): void {
  if (!isInside(project.workspacePath, path) || !existsSync(path)) return
  void runCommand(`npx playwright show-trace ${quote(path)}`, { cwd: project.workspacePath })
}

function isInside(root: string, path: string): boolean {
  const rel = relative(root, path)
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

function hostOf(link: string): string {
  try {
    return new URL(link).hostname
  } catch {
    return ''
  }
}

/** Documentation links the user gave for this test when recording it. */
function recordingDocLinks(dir: string | null | undefined): string[] {
  if (!dir) return []
  try {
    return (JSON.parse(readFileSync(join(dir, 'recording.json'), 'utf8')) as { docLinks?: string[] }).docLinks ?? []
  } catch {
    return []
  }
}


/** The ready card names the finished test: keep it in the tester's list. */
function keepDraft(projectId: string, text: string): void {
  const json = /```tfb-ready\s*\n([\s\S]*?)```/.exec(text)?.[1]
  if (!json) return
  try {
    const card = JSON.parse(json) as { name?: string; file?: string; summary?: string }
    if (card.file) registerDraft(projectId, { name: card.name ?? '', file: card.file, summary: card.summary ?? '' })
  } catch {
    // Not valid JSON: the test file is still listed under its file name.
  }
}

/** A run started from the Tests list: its result goes into the conversation too. */
export function addRunResult(projectId: string, name: string, report: TestReport | null): void {
  const chat = getChat(projectId) ?? newChat(projectId)
  if (report) {
    push(chat, { kind: 'notice', tone: 'info', text: `You ran "${name}".` })
    push(chat, { kind: 'test-result', report })
  } else {
    push(chat, { kind: 'notice', tone: 'error', text: `"${name}" could not run. Try again, or ask in the chat what is wrong.` })
  }
  save(chat)
}

function newChat(projectId: string): Chat {
  return {
    id: randomUUID(),
    projectId,
    createdAt: new Date().toISOString(),
    sessionId: null,
    branch: null,
    stage: 'understand',
    status: 'idle',
    items: [],
    costUsd: 0
  }
}

async function translationPrompt(project: Project, draftId: string): Promise<string> {
  const draft = listDrafts(project.id).find((d) => d.id === draftId)
  if (!draft) throw new Error('This test no longer exists.')
  const kind = await frameworkKind(project)
  return buildTranslationPrompt({
    kind,
    draftFile: join(draftsDir(project.id), draft.file),
    draftName: draft.name,
    draftSummary: draft.summary,
    stepsFile: join(stepsDir(project.id), 'steps.json'),
    python: kind === 'python' ? await findPython(project) : null,
    baseBranch: baseBranchOf(project)
  })
}

/** The "translated" card: commit the files locally; the tester sends them for review from Your tests. */
function finishTranslation(chat: Chat, project: Project, draftId: string, text: string): void {
  const json = /```tfb-translated\s*\n([\s\S]*?)```/.exec(text)?.[1]
  if (!json) return
  try {
    const card = JSON.parse(json) as { files?: string[]; summary?: string; verified?: boolean; notes?: string }
    chat.translatingDraftId = null
    void commitTranslation(project, draftId, {
      files: card.files ?? [],
      summary: card.summary ?? '',
      verified: card.verified === true,
      notes: card.notes ?? ''
    })
  } catch {
    // Not valid JSON: the translation stays open; the tester can ask again.
  }
}

/** Starts translating a draft: the conversation continues in the framework copy. */
export function translateDraft(projectId: string, draftId: string): void {
  const project = getProject(projectId)
  const draft = listDrafts(projectId).find((d) => d.id === draftId)
  if (!draft) return
  void sendMessage(
    project,
    `Translate the test "${draft.name}" into the QA team's framework, following its standards. Then run it there.`,
    { translateDraftId: draftId }
  )
}
