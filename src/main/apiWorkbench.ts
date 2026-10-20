import { app, BrowserWindow } from 'electron'
import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BrowserContext, Request } from 'playwright-core'
import { IPC, type ApiCall, type ApiRequest, type ApiResponse, type ApiState, type KeyValue } from '../shared/api'
import { getAccount } from './account'

// The API workbench: sends requests to the tester's API with their browser session, keeps a
// history of calls, and captures the calls the website makes while the tester uses it
// (so they never need to know the endpoints in advance).

const MAX_CALLS = 200
const MAX_BODY = 200_000
/** Headers that carry the login: never stored or shown, the session adds them when sending. */
const SECRET_HEADERS = new Set(['authorization', 'cookie', 'set-cookie', 'x-xsrf-token', 'x-csrf-token'])

let projectId: string | null = null
let calls: ApiCall[] = []
let capturing = false
let context: BrowserContext | null = null
/** The last Authorization header the website sent to each host, and to each site: the tester's session. */
const sessionAuth = new Map<string, string>()
const sessionAuthBySite = new Map<string, string>()

const callsFile = (id: string): string => join(app.getPath('userData'), 'api', id, 'calls.json')

export function getApiState(id: string): ApiState {
  if (projectId !== id) {
    projectId = id
    try {
      calls = JSON.parse(readFileSync(callsFile(id), 'utf8'))
    } catch {
      calls = []
    }
  }
  return { capturing, calls, sessionAvailable: sessionAvailable(), baseUrl: baseUrl() }
}

function save(): void {
  if (!projectId) return
  calls = calls.slice(0, MAX_CALLS)
  mkdirSync(join(app.getPath('userData'), 'api', projectId), { recursive: true })
  writeFileSync(callsFile(projectId), JSON.stringify(calls))
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(IPC.apiState, { projectId, state: getApiState(projectId) })
  }
}

export function setCapturing(id: string, on: boolean): void {
  getApiState(id)
  capturing = on
  save()
}

export function clearCalls(id: string): void {
  getApiState(id)
  calls = []
  save()
}

/** The API link, or the UI link when the application has no separate API. */
function baseUrl(): string {
  const account = getAccount()
  return (account?.apiUrl || account?.appUrl || '').replace(/\/+$/, '')
}

function sessionAvailable(): boolean {
  const base = baseUrl()
  if (!base) return false
  try {
    return sessionAuth.has(new URL(base).host) || context !== null
  } catch {
    return false
  }
}

// --- Capture from the live browser -------------------------------------------------------

/** Called by the live browser when it starts. */
export function attachCapture(browserContext: BrowserContext): void {
  context = browserContext
  browserContext.on('request', (request) => {
    // Remember the session even when not capturing: "use my login" needs it.
    const auth = request.headers()['authorization']
    if (auth) {
      sessionAuth.set(hostOf(request.url()), auth)
      sessionAuthBySite.set(siteOf(request.url()), auth)
    }
  })
  browserContext.on('requestfinished', (request) => void capture(request))
}

async function capture(request: Request): Promise<void> {
  if (!capturing || !projectId) return
  if (!['xhr', 'fetch'].includes(request.resourceType())) return
  // Only calls to the application itself: any address of the same site as the UI or API link
  // (an application's API often lives on another sub-address), not analytics or other sites.
  const account = getAccount()
  const sites = new Set([account?.apiUrl, account?.appUrl].filter(Boolean).map((url) => siteOf(url!)))
  if (!sites.has(siteOf(request.url()))) return

  const response = await request.response().catch(() => null)
  if (!response) return
  const timing = request.timing()
  const body = await readBody(response.headers()['content-type'] ?? '', () => response.body())
  const url = new URL(request.url())
  const call: ApiCall = {
    id: randomUUID(),
    at: new Date().toISOString(),
    source: 'captured',
    request: {
      method: request.method(),
      url: url.origin + url.pathname,
      query: [...url.searchParams].map(([key, value]) => ({ key, value, enabled: true })),
      headers: cleanHeaders(await request.allHeaders().catch(() => request.headers())),
      body: request.postData() ?? '',
      useSession: true
    },
    response: {
      status: response.status(),
      statusText: response.statusText(),
      timeMs: Math.max(0, Math.round(timing.responseEnd > 0 ? timing.responseEnd : 0)),
      size: body.size,
      headers: cleanHeaderMap(response.headers()),
      body: body.text,
      contentType: response.headers()['content-type'] ?? '',
      error: null
    }
  }
  calls.unshift(call)
  save()
}

// --- Sending ---------------------------------------------------------------------------

export async function sendRequest(id: string, request: ApiRequest): Promise<ApiCall> {
  getApiState(id)
  const started = Date.now()
  let response: ApiResponse
  try {
    const url = buildUrl(request)
    const headers: Record<string, string> = {}
    for (const header of request.headers) if (header.enabled && header.key.trim()) headers[header.key.trim()] = header.value
    if (request.useSession) Object.assign(headers, await sessionHeaders(url, headers))
    const hasBody = !['GET', 'HEAD'].includes(request.method) && request.body.trim() !== ''
    if (hasBody && !Object.keys(headers).some((h) => h.toLowerCase() === 'content-type')) {
      headers['Content-Type'] = looksLikeJson(request.body) ? 'application/json' : 'text/plain'
    }

    const result = await fetch(url, {
      method: request.method,
      headers,
      body: hasBody ? request.body : undefined,
      signal: AbortSignal.timeout(60_000)
    })
    const responseHeaders: Record<string, string> = {}
    result.headers.forEach((value, key) => (responseHeaders[key] = value))
    const body = await readBody(responseHeaders['content-type'] ?? '', async () => Buffer.from(await result.arrayBuffer()))
    response = {
      status: result.status,
      statusText: result.statusText,
      timeMs: Date.now() - started,
      size: body.size,
      headers: cleanHeaderMap(responseHeaders),
      body: body.text,
      contentType: responseHeaders['content-type'] ?? '',
      error: null
    }
  } catch (error) {
    response = {
      status: 0,
      statusText: '',
      timeMs: Date.now() - started,
      size: 0,
      headers: {},
      body: '',
      contentType: '',
      error: explainError(error as Error)
    }
  }

  const call: ApiCall = {
    id: randomUUID(),
    at: new Date().toISOString(),
    source: 'workbench',
    request: { ...request, headers: request.headers.filter((h) => !SECRET_HEADERS.has(h.key.toLowerCase())) },
    response
  }
  calls.unshift(call)
  save()
  return call
}

/** A path like /api/items is relative to the API link; a full address is used as it is. */
function buildUrl(request: ApiRequest): string {
  const raw = request.url.trim()
  if (!raw) throw new Error('Type the address of the call.')
  const url = /^https?:\/\//i.test(raw) ? new URL(raw) : new URL(baseUrl() + (raw.startsWith('/') ? raw : `/${raw}`))
  for (const param of request.query) if (param.enabled && param.key.trim()) url.searchParams.append(param.key.trim(), param.value)
  return url.toString()
}

/** The tester's login, as the website sends it: its Authorization header and its cookies. */
async function sessionHeaders(url: string, own: Record<string, string>): Promise<Record<string, string>> {
  const result: Record<string, string> = {}
  const ownKeys = new Set(Object.keys(own).map((k) => k.toLowerCase()))
  const auth = sessionAuth.get(hostOf(url)) ?? sessionAuthBySite.get(siteOf(url))
  if (auth && !ownKeys.has('authorization')) result.Authorization = auth
  const cookies = (await context?.cookies(url).catch(() => [])) ?? []
  if (cookies.length && !ownKeys.has('cookie')) result.Cookie = cookies.map((c) => `${c.name}=${c.value}`).join('; ')
  return result
}

async function readBody(contentType: string, read: () => Promise<Buffer>): Promise<{ text: string; size: number }> {
  try {
    const buffer = await read()
    const textual = /json|text|xml|javascript|html|x-www-form-urlencoded/i.test(contentType) || contentType === ''
    if (!textual) return { text: `(${contentType || 'binary'} content, ${buffer.length} bytes)`, size: buffer.length }
    const text = buffer.toString('utf8')
    return { text: text.length > MAX_BODY ? `${text.slice(0, MAX_BODY)}\n… (cut: ${text.length} characters in total)` : text, size: buffer.length }
  } catch {
    return { text: '', size: 0 }
  }
}

function cleanHeaders(headers: Record<string, string>): KeyValue[] {
  return Object.entries(cleanHeaderMap(headers))
    .filter(([key]) => !key.startsWith(':') && !['host', 'content-length', 'connection', 'accept-encoding'].includes(key))
    .map(([key, value]) => ({ key, value, enabled: true }))
}

function cleanHeaderMap(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).filter(([key]) => !SECRET_HEADERS.has(key.toLowerCase())))
}

function explainError(error: Error): string {
  const cause = (error as Error & { cause?: { code?: string } }).cause?.code ?? ''
  if (/ENOTFOUND|EAI_AGAIN/.test(cause)) return 'The address could not be found. Check the API link in Your environment.'
  if (/ECONNREFUSED|ECONNRESET/.test(cause)) return 'The server refused the connection.'
  if (/CERT|SELF_SIGNED|UNABLE_TO_VERIFY/.test(cause)) return "The server's security certificate is not trusted by this computer."
  if (error.name === 'TimeoutError') return 'No answer within 60 seconds.'
  return error.message
}

function looksLikeJson(text: string): boolean {
  try {
    JSON.parse(text)
    return true
  } catch {
    return false
  }
}

/** "a.b.example.com" → "example.com": addresses of the same site. */
function siteOf(url: string): string {
  return hostOf(url).replace(/:\d+$/, '').split('.').slice(-2).join('.')
}

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return ''
  }
}
