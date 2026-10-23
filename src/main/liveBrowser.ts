import { app, BrowserWindow } from 'electron'
import { existsSync } from 'node:fs'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { chromium, type BrowserContext, type CDPSession, type Page } from 'playwright-core'
import { IPC, type BrowserInput, type BrowserInstall, type BrowserNavigation, type BrowserState, type LoginResult } from '../shared/api'
import { getAccount, getAccountPassword } from './account'
import { NODE_MODE, nodeCommandLine, playwrightCoreCli } from './nodeRunner'
import { runCommand } from './process'
import * as steps from './steps'
import * as apiWorkbench from './apiWorkbench'

// The live browser: one real Chromium, started by the app, with a persistent profile so the
// tester stays logged in. The Studio shows it live (DevTools screencast) and passes the tester's
// mouse and keyboard to it. Claude and test runs will use the same browser (its debugging port),
// so every action is visible in one place.

const DEFAULT_VIEWPORT = { width: 1280, height: 800 }
const SCREENCAST_QUALITY = 70

let context: BrowserContext | null = null
let starting: Promise<void> | null = null
let page: Page | null = null
let cdp: CDPSession | null = null
let viewport = { ...DEFAULT_VIEWPORT }
let debuggingPort: number | null = null
let retriedAfterInstall = false
let state: BrowserState = {
  running: false,
  url: '',
  title: '',
  loading: false,
  canGoBack: false,
  canGoForward: false,
  loginForm: false,
  error: null
}

/** The browser's DevTools endpoint, for Claude and test runs (used from S3). */
export function getDebuggingEndpoint(): string | null {
  return debuggingPort ? `http://127.0.0.1:${debuggingPort}` : null
}

export function getBrowserState(): BrowserState {
  return state
}

function send(channel: string, data: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(channel, data)
  }
}

function updateState(changes: Partial<BrowserState>): void {
  state = { ...state, ...changes }
  send(IPC.browserState, state)
}

export async function startBrowser(): Promise<BrowserState> {
  if (context) return state
  starting ??= launch().finally(() => (starting = null))
  await starting
  return state
}

async function launch(): Promise<void> {
  if (install.state !== 'ready') {
    updateState({ running: false, loading: true, error: null, url: 'Installing the browser… This takes a minute, only the first time.' })
    const installed = await installBrowser()
    updateState({ loading: false, url: '' })
    if (!installed) {
      updateState({ error: 'The browser could not be installed. Check your internet connection and open the Studio again.' })
      return
    }
  }
  try {
    debuggingPort = await freePort()
    context = await chromium.launchPersistentContext(join(app.getPath('userData'), 'browser-profile'), {
      headless: true,
      viewport,
      args: [`--remote-debugging-port=${debuggingPort}`],
      // Playwright hides page scroll bars by default; the tester needs to see them in the live view.
      ignoreDefaultArgs: ['--hide-scrollbars']
    })
  } catch (error) {
    context = null
    // The browser folder was removed while the app was open: download it again, once.
    const missing = /Executable doesn't exist/i.test((error as Error).message)
    if (missing && !retriedAfterInstall) {
      retriedAfterInstall = true
      updateState({ loading: true, url: 'Installing the browser… This takes a minute, only the first time.' })
      const installed = await installBrowser(true)
      updateState({ loading: false, url: '' })
      if (installed) return launch()
    }
    updateState({
      running: false,
      error: missing
        ? 'The browser could not be installed. Check your internet connection and open the Studio again.'
        : `The browser could not start: ${(error as Error).message.split('\n')[0]}`
    })
    return
  }

  await steps.attachRecorder(context)
  apiWorkbench.attachCapture(context)
  context.on('page', (newPage) => void showPage(newPage))
  context.on('close', () => {
    context = null
    page = null
    cdp = null
    updateState({ running: false })
  })

  updateState({ running: true, error: null })
  const first = context.pages()[0] ?? (await context.newPage())
  await showPage(first)
  const appUrl = getAccount()?.appUrl
  if (appUrl && (first.url() === 'about:blank' || first.url() === '')) await goto(appUrl)
}

/** Shows a page in the live view: the newest tab, like a normal browser would. */
async function showPage(next: Page): Promise<void> {
  if (cdp) await cdp.detach().catch(() => {})
  page = next
  cdp = await context!.newCDPSession(next)

  cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
    send(IPC.browserFrame, { data, width: metadata.deviceWidth, height: metadata.deviceHeight })
    steps.onFrame(data)
    void cdp?.send('Page.screencastFrameAck', { sessionId }).catch(() => {})
  })
  await next.setViewportSize(viewport).catch(() => {})
  await startScreencast()

  const refresh = (): void => void refreshState()
  next.on('framenavigated', (frame) => {
    if (frame !== next.mainFrame()) return
    refresh()
    steps.onNavigated(next)
  })
  next.on('load', refresh)
  next.on('domcontentloaded', refresh)
  next.on('close', () => {
    if (page !== next) return
    const remaining = context?.pages().filter((p) => p !== next) ?? []
    if (remaining.length) void showPage(remaining[remaining.length - 1])
  })
  await refreshState()
}

async function startScreencast(): Promise<void> {
  await cdp
    ?.send('Page.startScreencast', {
      format: 'jpeg',
      quality: SCREENCAST_QUALITY,
      maxWidth: viewport.width,
      maxHeight: viewport.height,
      everyNthFrame: 1
    })
    .catch(() => {})
}

async function refreshState(): Promise<void> {
  if (!page || !cdp) return
  const history = await cdp.send('Page.getNavigationHistory').catch(() => null)
  updateState({
    url: page.url(),
    title: await page.title().catch(() => ''),
    canGoBack: history ? history.currentIndex > 0 : false,
    canGoForward: history ? history.currentIndex < history.entries.length - 1 : false,
    loginForm: await hasLoginForm(page)
  })
}

async function hasLoginForm(target: Page): Promise<boolean> {
  return (await target.locator(PASSWORD_FIELD).count().catch(() => 0)) > 0
}

const PASSWORD_FIELD = 'input[type="password"]:visible'
/** Text-like fields a username can go in. */
const USERNAME_FIELD =
  'input:visible:not([type]), input[type="text"]:visible, input[type="email"]:visible, input[type="tel"]:visible'
const SUBMIT_BUTTON =
  'button[type="submit"]:visible, input[type="submit"]:visible, button:visible:text-matches("log ?in|sign ?in|continue|next|submit", "i")'

/**
 * Logs in on the current page with the tester's environment. Works the same for any platform:
 * the username goes in the last text field before the password field, then the form is submitted.
 * Two-step logins (username first, password on the next screen) are handled too.
 */
export async function logIn(): Promise<LoginResult> {
  const account = getAccount()
  const password = getAccountPassword()
  if (!account?.username || !password) {
    return { ok: false, message: 'Add your username and password in "Your environment" first.' }
  }
  if (!page) await startBrowser()
  if (!page) return { ok: false, message: 'The browser is not running.' }
  const target = page

  // The app's own typing is not part of any test.
  steps.pauseRecording(true)
  try {
    if (await hasLoginForm(target)) {
      await fillUsernameBeforePassword(target, account.username)
    } else {
      // Maybe a two-step login: the username first, the password on the next screen.
      const username = target.locator(USERNAME_FIELD).first()
      if ((await username.count()) === 0) return { ok: false, message: 'There is no login form on this page.' }
      await username.fill(account.username)
      await submit(target, username)
      await target.locator(PASSWORD_FIELD).first().waitFor({ timeout: 10_000 }).catch(() => {})
      if (!(await hasLoginForm(target))) return { ok: false, message: 'The login form did not ask for a password.' }
    }

    const passwordField = target.locator(PASSWORD_FIELD).first()
    await passwordField.fill(password)
    await submit(target, passwordField)
    await target.waitForLoadState('domcontentloaded', { timeout: 15_000 }).catch(() => {})
    await target.waitForTimeout(1500)
    await refreshState()
    if (await hasLoginForm(target)) {
      return { ok: false, message: 'The login page is still shown. Check the username and password in "Your environment".' }
    }
    return { ok: true, message: 'Logged in.' }
  } catch (error) {
    return { ok: false, message: `The login did not work: ${(error as Error).message.split('\n')[0]}` }
  } finally {
    steps.pauseRecording(false)
  }
}

/** The username goes in the last visible text field before the password field. */
async function fillUsernameBeforePassword(target: Page, username: string): Promise<void> {
  const index = await target.evaluate(() => {
    const visible = (el: Element): boolean => (el as HTMLElement).offsetParent !== null
    const passwordField = Array.from(document.querySelectorAll('input[type="password"]')).find(visible)
    if (!passwordField) return -1
    const textFields = Array.from(
      document.querySelectorAll('input:not([type]), input[type="text"], input[type="email"], input[type="tel"]')
    ).filter(visible)
    let found = -1
    textFields.forEach((el, i) => {
      if (el.compareDocumentPosition(passwordField) & Node.DOCUMENT_POSITION_FOLLOWING) found = i
    })
    return found
  })
  if (index >= 0) await target.locator(USERNAME_FIELD).nth(index).fill(username)
}

/** Submits a form: its submit button if there is one, otherwise Enter in the field. */
async function submit(target: Page, field: ReturnType<Page['locator']>): Promise<void> {
  const formButton = field.locator('xpath=ancestor::form[1]').locator(SUBMIT_BUTTON).first()
  if ((await formButton.count().catch(() => 0)) > 0) {
    await formButton.click()
    return
  }
  const pageButton = target.locator(SUBMIT_BUTTON).first()
  if ((await pageButton.count().catch(() => 0)) > 0) await pageButton.click()
  else await field.press('Enter')
}

/** Before the assistant works: if the page is a login page and the tester gave a login, log in. */
export async function logInIfNeeded(): Promise<void> {
  const account = getAccount()
  if (!page || !account?.username || !getAccountPassword()) return
  if (await hasLoginForm(page)) await logIn()
}

export async function setViewport(width: number, height: number): Promise<void> {
  const next = { width: Math.max(320, Math.round(width)), height: Math.max(240, Math.round(height)) }
  if (next.width === viewport.width && next.height === viewport.height) return
  viewport = next
  if (!page) return
  await page.setViewportSize(viewport).catch(() => {})
  // New size for the frames too.
  await cdp?.send('Page.stopScreencast').catch(() => {})
  await startScreencast()
}

export async function input(event: BrowserInput): Promise<void> {
  if (!cdp) return
  try {
    switch (event.kind) {
      case 'mouse':
        await cdp.send('Input.dispatchMouseEvent', {
          type: event.type,
          x: event.x,
          y: event.y,
          button: event.button,
          buttons: event.type === 'mouseReleased' || event.button === 'none' ? 0 : BUTTONS[event.button],
          clickCount: event.clickCount,
          modifiers: event.modifiers
        })
        break
      case 'wheel':
        await cdp.send('Input.dispatchMouseEvent', {
          type: 'mouseWheel',
          x: event.x,
          y: event.y,
          deltaX: event.deltaX,
          deltaY: event.deltaY,
          modifiers: event.modifiers
        })
        break
      case 'key':
        await cdp.send('Input.dispatchKeyEvent', {
          type: event.type === 'keyDown' && event.text ? 'keyDown' : event.type === 'keyDown' ? 'rawKeyDown' : 'keyUp',
          key: event.key,
          code: event.code,
          windowsVirtualKeyCode: event.keyCode,
          nativeVirtualKeyCode: event.keyCode,
          text: event.text ?? undefined,
          unmodifiedText: event.text ?? undefined,
          modifiers: event.modifiers
        })
        break
      case 'text':
        await cdp.send('Input.insertText', { text: event.text })
        break
    }
  } catch {
    // The page changed while the input was on its way; drop it.
  }
}

const BUTTONS = { none: 0, left: 1, right: 2, middle: 4 } as const

export async function navigate(action: BrowserNavigation | { url: string }): Promise<void> {
  if (!page) await startBrowser()
  if (!page) return
  if (typeof action === 'object') return goto(action.url)
  if (action === 'home') {
    const appUrl = getAccount()?.appUrl
    if (appUrl) await goto(appUrl)
  } else if (action === 'back') await page.goBack().catch(() => {})
  else if (action === 'forward') await page.goForward().catch(() => {})
  else await page.reload().catch(() => {})
}

async function goto(url: string): Promise<void> {
  if (!page) return
  updateState({ loading: true })
  // Slow or unreachable pages show their own error page; the live view shows it.
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => {})
  updateState({ loading: false })
  await refreshState()
}

export async function closeBrowser(): Promise<void> {
  await context?.close().catch(() => {})
  context = null
}

// --- The one-time browser download ---------------------------------------------------------
// The live view runs headless, which uses Chromium's headless shell: only that is downloaded
// (about half the size of the full browser), with the app's own Playwright on its Electron.

let install: BrowserInstall = { state: 'checking', percent: null }
let installing: Promise<boolean> | null = null

export function getBrowserInstall(): BrowserInstall {
  return install
}

function setInstall(next: BrowserInstall): void {
  install = next
  send(IPC.browserInstall, install)
}

/** Called when the app opens, so the download runs while the tester goes through the first screens. */
export function prefetchBrowser(): void {
  void installBrowser()
}

/** Makes sure the browser is on this computer. Everyone who asks meanwhile shares one download. */
function installBrowser(force = false): Promise<boolean> {
  if (installing) return installing
  if (install.state === 'ready' && !force) return Promise.resolve(true)
  installing = (async () => {
    if (!force) {
      setInstall({ state: 'checking', percent: null })
      if (await browserIsInstalled()) {
        setInstall({ state: 'ready', percent: null })
        return true
      }
    }
    setInstall({ state: 'downloading', percent: 0 })
    const result = await runCommand(nodeCommandLine(playwrightCoreCli(), 'install --only-shell chromium'), {
      cwd: app.getPath('userData'),
      env: NODE_MODE,
      timeoutMs: 15 * 60_000,
      onOutput: (chunk) => {
        const percent = lastPercent(chunk)
        if (percent !== null && percent !== install.percent) setInstall({ state: 'downloading', percent })
      }
    })
    const installed = result.code === 0 && (await browserIsInstalled())
    setInstall({ state: installed ? 'ready' : 'failed', percent: null })
    return installed
  })().finally(() => (installing = null))
  return installing
}

async function browserIsInstalled(): Promise<boolean> {
  // --dry-run lists where each download belongs, without downloading anything.
  const result = await runCommand(nodeCommandLine(playwrightCoreCli(), 'install --dry-run --only-shell chromium'), {
    cwd: app.getPath('userData'),
    env: NODE_MODE,
    timeoutMs: 60_000
  })
  const locations = [...result.output.matchAll(/Install location:\s+(.+)/g)].map((m) => m[1].trim())
  return result.code === 0 && locations.length > 0 && locations.every((path) => existsSync(path))
}

/** The last "NN%" in the installer's progress output. */
export function lastPercent(output: string): number | null {
  const all = [...output.matchAll(/(\d{1,3})%/g)].map((m) => Number(m[1])).filter((n) => n <= 100)
  return all.length ? all[all.length - 1] : null
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close(() => (typeof address === 'object' && address ? resolve(address.port) : reject(new Error('No free port'))))
    })
    server.on('error', reject)
  })
}
