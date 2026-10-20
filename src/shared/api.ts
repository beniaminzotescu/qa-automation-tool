// Contract between the renderer (UI) and the main process.
// No credential (API key or Claude login) ever crosses this boundary back to the UI.

/** How the app talks to Claude. */
export type AiMode = 'claude-code' | 'api-key'

export interface ApiKeyStatus {
  hasKey: boolean
  /** Last 4 characters, so the user can recognise which key is saved. */
  hint: string | null
}

export type SaveApiKeyResult =
  | { ok: true; status: ApiKeyStatus }
  | { ok: false; message: string }

/**
 * State of the Claude Code program on this computer. The app only runs it;
 * the user signs in through Claude Code's own login, and the app never sees the credentials.
 */
export type ClaudeCodeStatus =
  | { state: 'not-installed' }
  | { state: 'signed-out'; version: string }
  | { state: 'ready'; version: string; account: string | null; plan: string | null }
  | { state: 'error'; message: string }

export interface AiSettings {
  mode: AiMode
  apiKey: ApiKeyStatus
}

/** Supported for now: TypeScript (and JavaScript, the same Node tooling) and Python frameworks. */
export type FrameworkKind = 'typescript' | 'python' | 'other'

/** What the app found in a framework folder. Read from files only; nothing is run. */
export interface FrameworkProfile {
  name: string
  /** What kind of framework it is. "other" is not supported yet. Only TypeScript frameworks need the Node setup steps. */
  kind: FrameworkKind
  /** Test tools found, e.g. ["Playwright", "pytest", "Selenium"]. */
  tools: string[]
  playwrightVersion: string | null
  configFile: string | null
  language: 'typescript' | 'javascript' | 'python' | 'other'
  /** Folders under the test directory, each with its number of spec files. */
  suites: { folder: string; specFiles: number }[]
  pageObjects: number
  fixtures: number
  apiClients: number
  teamRules: { claudeMd: boolean; guidelines: boolean; skills: string[] }
  hasEnvExample: boolean
  /** baseBranch: where new tests start (develop, main or master, else the remote's default). */
  git: { remote: string | null; branch: string | null; baseBranch: string | null }
}

export type InspectResult =
  | { ok: true; path: string; profile: FrameworkProfile; warnings: string[] }
  | { ok: false; path: string; problems: string[] }

export interface Project {
  id: string
  name: string
  /** The user's own folder. The app never changes files or branches there. */
  sourcePath: string
  /** The app's own working copy (a git worktree of sourcePath), where everything runs. */
  workspacePath: string
  addedAt: string
  /** True once the setup checks and platform settings are done. */
  setupDone?: boolean
  /** The branch new tests start from. Older projects without it use develop. */
  baseBranch?: string
}

export type ConnectResult =
  | { ok: true; project: Project; warnings: string[] }
  | { ok: false; message: string }

export type CheckId = 'git' | 'node' | 'dependencies' | 'browsers' | 'typecheck'

export type CheckState = 'ok' | 'warning' | 'error' | 'blocked'

export interface CheckResult {
  id: CheckId
  title: string
  state: CheckState
  /** Plain-language explanation of the state and what to do. */
  detail: string
  /** A button the app can run to fix the problem, if there is one. */
  fix: { label: string } | null
  /** A command the user runs themselves (for example, to install a program). */
  manualCommand?: string
  link?: { label: string; url: string }
  /** Command output, shown under "Show details". */
  output?: string
}

export interface TaskOutputEvent {
  taskId: string
  chunk: string
}

/** One setting from the framework's .env.example. */
export interface EnvField {
  key: string
  label: string
  /** The comment above the setting in .env.example. */
  hint: string | null
  value: string
  /** Shown as dots with a "Show" button (passwords, tokens). */
  masked: boolean
}

export interface EnvGroup {
  id: string
  title: string
  description: string | null
  /** The Playwright project these settings log in to, for "Test connection". */
  playwrightProject: string | null
  /** Technical settings, shown collapsed under "Advanced". */
  advanced: boolean
  fields: EnvField[]
}

export interface PlatformSettings {
  /** False when the framework has no .env.example to build the form from. */
  available: boolean
  groups: EnvGroup[]
}

/** Where Claude is in writing the test. Shown as a progress bar above the chat. */
export const STAGES = ['understand', 'plan', 'explore', 'write', 'check', 'ready'] as const
export type Stage = (typeof STAGES)[number]

export interface TestCaseResult {
  title: string
  file: string
  status: 'passed' | 'failed' | 'flaky' | 'skipped'
  durationMs: number
  /** First lines of the error, for failed tests. */
  error: string | null
  screenshots: string[]
  video: string | null
  trace: string | null
}

export interface TestReport {
  passed: number
  failed: number
  flaky: number
  skipped: number
  durationMs: number
  tests: TestCaseResult[]
}

export type ChatItem =
  | { kind: 'user'; id: string; text: string }
  /** Claude's text. May contain ```tfb-question / tfb-scenarios / tfb-ready blocks the UI shows as cards. */
  | { kind: 'assistant'; id: string; text: string }
  /** One thing Claude did, in plain words, with the technical detail for "Show details". */
  | { kind: 'activity'; id: string; label: string; detail: string | null }
  | { kind: 'screenshot'; id: string; path: string }
  | { kind: 'test-result'; id: string; report: TestReport }
  | { kind: 'notice'; id: string; tone: 'info' | 'error'; text: string }

export interface Chat {
  id: string
  projectId: string
  createdAt: string
  /** Claude session, resumed on every turn. */
  sessionId: string | null
  /** A separate session for translations: it works in the framework folder, not the drafts folder. */
  translationSessionId?: string | null
  /** While set, messages go to the translation of this draft. */
  translatingDraftId?: string | null
  /** The branch this test is written on, made from the project's base branch. */
  branch: string | null
  stage: Stage
  /** The recording this test was made from; Claude can read its folder. */
  recordingDir?: string | null
  status: 'idle' | 'preparing' | 'working'
  items: ChatItem[]
  costUsd: number
}

export interface ChatUpdate {
  projectId: string
  chat: Chat | null
}

/** Where the QA team's framework comes from. Set by an admin; users never see it. */
export interface RepoConfig {
  /** HTTPS link of the repository, cloned with the shared service-account token. */
  url: string | null
  /** Developer option: use a folder on this computer instead of cloning. */
  localFolder: string | null
  hasToken: boolean
}

export type RepoAccessResult = { ok: true } | { ok: false; message: string }

/** The tester's SSH key for git. Only the public key ever leaves the main process. */
export interface SshKeyStatus {
  hasKey: boolean
  /** The line to paste into Azure DevOps or GitHub ("ssh-rsa AAAA… comment"). */
  publicKey: string | null
}

export type SshKeyResult = { ok: true; status: SshKeyStatus } | { ok: false; message: string }

export type PrepareStepId = 'framework' | 'workingCopy' | 'packages' | 'browsers' | 'code'

export interface PrepareStep {
  id: PrepareStepId
  title: string
  state: 'waiting' | 'running' | 'done' | 'warning' | 'failed'
  /** Plain-language explanation when something went wrong. */
  message?: string
}

export interface PrepareStatus {
  running: boolean
  steps: PrepareStep[]
  /** The project once the framework is ready. */
  project: Project | null
  /** Set when preparing stopped on a problem the user can't fix in the app. */
  blocker: string | null
  /** Programs the computer needs and doesn't have; the app can install them. */
  missingTools: Tool[]
}

export type Tool = 'git' | 'node'

/** Manual testers get the plain-language app; the technical mode comes later. */
export type UserType = 'manual' | 'technical'

/**
 * The tester's own environment: their tenant's application link and their account.
 * Nothing platform-specific: the tester logs in by hand once in the live browser.
 */
export interface Account {
  /** The UI: the address of the website. */
  appUrl: string
  /** The API (back end), when the application has a separate one. Empty if not given. */
  apiUrl: string
  username: string
  hasPassword: boolean
}

export interface AccountInput {
  appUrl: string
  apiUrl: string
  username: string
  /** Empty keeps the saved password. */
  password: string
}

/** What the live browser shows, for the toolbar. */
export interface BrowserState {
  running: boolean
  url: string
  title: string
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
  /** The page shows a password field: the app can log in with the tester's environment. */
  loginForm: boolean
  /** Plain-language problem, e.g. the browser could not start. */
  error: string | null
}

export interface BrowserFrame {
  /** JPEG, base64. */
  data: string
  width: number
  height: number
}

export type BrowserInput =
  | {
      kind: 'mouse'
      type: 'mousePressed' | 'mouseReleased' | 'mouseMoved'
      x: number
      y: number
      button: 'none' | 'left' | 'middle' | 'right'
      clickCount: number
      modifiers: number
    }
  | { kind: 'wheel'; x: number; y: number; deltaX: number; deltaY: number; modifiers: number }
  | { kind: 'key'; type: 'keyDown' | 'keyUp'; key: string; code: string; keyCode: number; text: string | null; modifiers: number }
  /** Pasted or typed text inserted as a whole. */
  | { kind: 'text'; text: string }

export type BrowserNavigation = 'back' | 'forward' | 'reload' | 'home'

export type LoginResult = { ok: true; message: string } | { ok: false; message: string }

/** What the recorder knows about the element an action was done on. Used by Claude to find it again. */
export interface ElementInfo {
  tag: string
  role: string | null
  /** Accessible name: aria-label, label text, placeholder, title, alt or visible text. */
  name: string | null
  testId: string | null
  id: string | null
  nameAttr: string | null
  placeholder: string | null
  text: string | null
  css: string
}

export type RecordedStepType = 'navigate' | 'click' | 'fill' | 'press' | 'select' | 'check-text' | 'check-visible'

export interface RecordedStep {
  id: string
  type: RecordedStepType
  element: ElementInfo | null
  /** Typed or chosen value, the key for "press", or the expected text for "check-text". */
  value: string | null
  /** True for password fields: the value is not recorded. */
  masked: boolean
  url: string
  title: string
  at: string
  screenshot: string | null
  /** Who did it in the live browser: the tester, or Claude while it was working. */
  by: 'user' | 'claude'
}

export type RecorderMode = 'record' | 'check-text' | 'check-visible'

/** The steps recorded in the live browser for the current project. */
export interface StepLog {
  /** True while recording: actions in the live browser become steps. */
  recording: boolean
  mode: RecorderMode
  steps: RecordedStep[]
  /** How many steps Claude has already been told about. */
  sharedWithClaude: number
}

/** A documentation file of the application under test, in the knowledge base. */
export interface KnowledgeFile {
  id: string
  name: string
  /** What it is, in a few words (helps the assistant pick what to read). */
  note: string
  path: string
  size: number
  /** False for formats the assistant can't read well (e.g. Word): saving as PDF helps. */
  readable: boolean
  addedAt: string
}

export interface KnowledgeLink {
  id: string
  url: string
  note: string
  addedAt: string
}

export interface KnowledgeBase {
  files: KnowledgeFile[]
  links: KnowledgeLink[]
}

/** A test the tester keeps in the app: a simple Playwright test, run in the live browser. */
export interface Draft {
  id: string
  name: string
  /** Relative to the drafts folder, e.g. "tests/new-item.spec.ts". */
  file: string
  /** What it checks, in plain words. */
  summary: string
  createdAt: string
  updatedAt: string
  lastRun: { status: 'passed' | 'failed'; at: string; passed: number; failed: number } | null
  /** Set once the draft was translated into the framework. */
  translation?: Translation
}

export interface Translation {
  /** The framework branch with the translated test (committed locally until sent). */
  branch: string
  /** Files added or changed in the framework, relative to it. */
  files: string[]
  summary: string
  /** True when it ran and passed in the framework. */
  verified: boolean
  notes: string
  committed: boolean
  translatedAt: string
  sentAt: string | null
  prUrl: string | null
}

export type SendResult = { ok: true; message: string; prUrl: string | null } | { ok: false; message: string }

export interface DraftsUpdate {
  projectId: string
  drafts: Draft[]
  /** The draft running in the live browser right now, if any. */
  runningDraftId: string | null
}

export interface AppApi {
  getAiSettings(): Promise<AiSettings>
  setAiMode(mode: AiMode): Promise<AiSettings>

  /** Checks the key with Anthropic, then stores it encrypted. Nothing is stored if the check fails. */
  saveApiKey(key: string): Promise<SaveApiKeyResult>
  removeApiKey(): Promise<ApiKeyStatus>

  checkClaudeCode(): Promise<ClaudeCodeStatus>
  /** Opens a terminal window that runs `claude auth login` (Anthropic's own sign-in flow). */
  openClaudeLogin(): Promise<void>

  /** Opens the Windows folder picker. Returns null when the user cancels. */
  chooseFolder(): Promise<string | null>
  inspectFolder(path: string): Promise<InspectResult>
  getProfile(id: string): Promise<FrameworkProfile>

  runChecks(projectId: string): Promise<CheckResult[]>
  /** Runs the fix for one check, streaming its output as task output, then checks again. */
  fixCheck(projectId: string, checkId: CheckId, taskId: string): Promise<CheckResult[]>


  getChat(projectId: string): Promise<Chat | null>
  /** Sends a message. The first message prepares a new branch from the base branch. Progress arrives via onChatUpdate. */
  sendMessage(projectId: string, text: string): Promise<void>
  /** Stops Claude's current work. */
  stopChat(projectId: string): Promise<void>
  /** Throws the test away: deletes the branch and its changes, clears the chat. */
  discardChat(projectId: string): Promise<void>
  onChatUpdate(listener: (update: ChatUpdate) => void): () => void

  /** A screenshot or video from a test run, as a data: URL the UI can show. */
  readAttachment(projectId: string, path: string): Promise<string | null>
  /** Opens Playwright's replay viewer for a test run. */
  openTrace(projectId: string, path: string): Promise<void>

  getRepoConfig(): Promise<RepoConfig>
  /** Saves the repository link and token (token: empty keeps the saved one). Checks access first. */
  saveRepoConfig(url: string, token: string): Promise<RepoAccessResult>
  useLocalFolder(path: string | null): Promise<RepoConfig>

  getSshKey(): Promise<SshKeyStatus>
  createSshKey(): Promise<SshKeyResult>
  /** Opens a file picker for the private key, then imports it. null when cancelled. */
  importSshKey(): Promise<SshKeyResult | null>
  removeSshKey(): Promise<SshKeyStatus>

  getPrepareStatus(): Promise<PrepareStatus>
  /** Gets the framework ready (clone, working copy, packages, browsers, code check). Progress via onPrepareUpdate. */
  startPrepare(): Promise<void>
  onPrepareUpdate(listener: (status: PrepareStatus) => void): () => void
  /** Installs Git or Node.js with Windows' own installer (winget). */
  installTool(tool: Tool): Promise<{ ok: boolean; message: string }>

  getUserType(): Promise<UserType | null>
  setUserType(type: UserType): Promise<void>

  getAccount(): Promise<Account | null>
  saveAccount(input: AccountInput): Promise<LoginResult>

  /** Starts the live browser (once) and opens the application link. */
  startBrowser(): Promise<BrowserState>
  /** The size of the live view in the Studio; the browser's page size follows it. */
  setBrowserViewport(width: number, height: number): void
  browserInput(input: BrowserInput): void
  browserNavigate(action: BrowserNavigation | { url: string }): Promise<void>
  /** Fills in the login form on the current page with the tester's environment and submits it. */
  browserLogin(): Promise<LoginResult>
  onBrowserFrame(listener: (frame: BrowserFrame) => void): () => void
  onBrowserState(listener: (state: BrowserState) => void): () => void

  getStepLog(projectId: string): Promise<StepLog>
  setRecording(projectId: string, recording: boolean): Promise<void>
  /** Check modes make the next click in the live browser a check instead of a click. */
  setRecorderMode(projectId: string, mode: RecorderMode): Promise<void>
  undoStep(projectId: string): Promise<void>
  clearSteps(projectId: string): Promise<void>
  /** Starts (or continues) the chat with the recorded steps: Claude makes a test from them. */
  askClaudeAboutSteps(projectId: string): Promise<void>
  onStepLogUpdate(listener: (update: { projectId: string; log: StepLog }) => void): () => void

  getKnowledge(projectId: string): Promise<KnowledgeBase>
  /** Opens a file picker; the chosen files are copied into the knowledge base. */
  addKnowledgeFiles(projectId: string): Promise<KnowledgeBase>
  addKnowledgeLink(projectId: string, url: string, note: string): Promise<{ ok: true; knowledge: KnowledgeBase } | { ok: false; message: string }>
  updateKnowledgeNote(projectId: string, id: string, note: string): Promise<KnowledgeBase>
  removeKnowledgeItem(projectId: string, id: string): Promise<KnowledgeBase>

  getDrafts(projectId: string): Promise<DraftsUpdate>
  /** Runs a kept test in the live browser; the result also appears in the chat. */
  runDraft(projectId: string, draftId: string): Promise<void>
  deleteDraft(projectId: string, draftId: string): Promise<void>
  /** The assistant translates a passing draft into the framework (progress in the chat). */
  translateDraft(projectId: string, draftId: string): Promise<void>
  /** Pushes the translation with the tester's key and opens the prefilled pull request. */
  sendForReview(projectId: string, draftId: string): Promise<SendResult>
  /** Saves a zip for the QA team. */
  exportDraft(projectId: string, draftId: string): Promise<SendResult>
  onDraftsUpdate(listener: (update: DraftsUpdate) => void): () => void

  /** Subscribes to output of long-running tasks. Returns an unsubscribe function. */
  onTaskOutput(listener: (event: TaskOutputEvent) => void): () => void
}

export const IPC = {
  getAiSettings: 'ai:settings',
  setAiMode: 'ai:setMode',
  saveApiKey: 'apiKey:save',
  removeApiKey: 'apiKey:remove',
  checkClaudeCode: 'claudeCode:check',
  openClaudeLogin: 'claudeCode:login',
  chooseFolder: 'project:chooseFolder',
  inspectFolder: 'project:inspect',
  getProfile: 'project:profile',
  runChecks: 'checks:run',
  fixCheck: 'checks:fix',
  getChat: 'chat:get',
  sendMessage: 'chat:send',
  stopChat: 'chat:stop',
  discardChat: 'chat:discard',
  chatUpdate: 'chat:update',
  readAttachment: 'chat:readAttachment',
  getRepoConfig: 'repo:get',
  saveRepoConfig: 'repo:save',
  useLocalFolder: 'repo:localFolder',
  getSshKey: 'ssh:get',
  createSshKey: 'ssh:create',
  importSshKey: 'ssh:import',
  removeSshKey: 'ssh:remove',
  getPrepareStatus: 'prepare:status',
  startPrepare: 'prepare:start',
  prepareUpdate: 'prepare:update',
  installTool: 'prepare:installTool',
  getUserType: 'user:getType',
  setUserType: 'user:setType',
  startBrowser: 'browser:start',
  setBrowserViewport: 'browser:viewport',
  browserInput: 'browser:input',
  browserNavigate: 'browser:navigate',
  browserLogin: 'browser:login',
  browserFrame: 'browser:frame',
  browserState: 'browser:state',
  getKnowledge: 'knowledge:get',
  addKnowledgeFiles: 'knowledge:addFiles',
  addKnowledgeLink: 'knowledge:addLink',
  updateKnowledgeNote: 'knowledge:note',
  removeKnowledgeItem: 'knowledge:remove',
  knowledgeUpdate: 'knowledge:update',
  getDrafts: 'drafts:get',
  runDraft: 'drafts:run',
  deleteDraft: 'drafts:delete',
  draftsUpdate: 'drafts:update',
  translateDraft: 'drafts:translate',
  sendForReview: 'drafts:send',
  exportDraft: 'drafts:export',
  getStepLog: 'steps:get',
  setRecording: 'steps:setRecording',
  setRecorderMode: 'steps:setMode',
  undoStep: 'steps:undo',
  clearSteps: 'steps:clear',
  askClaudeAboutSteps: 'steps:askClaude',
  stepLogUpdate: 'steps:update',
  getAccount: 'account:get',
  saveAccount: 'account:save',
  openTrace: 'chat:openTrace',
  taskOutput: 'task:output'
} as const

export const LINKS = {
  consoleApiKeys: 'https://platform.claude.com/settings/keys',
  claudeCodeSetup: 'https://code.claude.com/docs/en/setup',
  nodeDownload: 'https://nodejs.org/en/download',
  gitDownload: 'https://git-scm.com/downloads/win'
} as const
