import type { Account, AccountInput, LoginResult } from '../shared/api'
import { deleteSecret, getSecret, setSecret } from './secrets'
import { loadSettings, updateSettings } from './settings'

// The tester's own environment: the UI and API links of their tenant, and their account.
// Nothing platform-specific: the tester logs in by hand in the live browser, which keeps the
// session. The username and password are optional (not every application has a login); when
// given, they are kept so Claude can log in when the session expires.

const PASSWORD_SECRET = 'account-password'

export function getAccount(): Account | null {
  const saved = loadSettings().account as
    | { appUrl?: string; apiUrl?: string; frontUrl?: string; backUrl?: string; username?: string }
    | null
  // Settings from an earlier version kept the links as "frontUrl" and "backUrl".
  const appUrl = saved?.appUrl ?? saved?.frontUrl
  if (!saved || !appUrl) return null
  return {
    appUrl,
    apiUrl: saved.apiUrl ?? saved.backUrl ?? '',
    username: saved.username ?? '',
    hasPassword: getSecret(PASSWORD_SECRET) !== null
  }
}

export function getAccountPassword(): string | null {
  return getSecret(PASSWORD_SECRET)
}

export function saveAccount(input: AccountInput): LoginResult {
  const appUrl = cleanUrl(input.appUrl)
  if (!appUrl) return { ok: false, message: 'The UI link must be a web address starting with https://' }
  const apiUrl = input.apiUrl.trim() ? cleanUrl(input.apiUrl) : ''
  if (apiUrl === null) return { ok: false, message: 'The API link must be a web address starting with https://' }
  // Not every application has a login: username and password are optional.
  const username = input.username.trim()
  updateSettings({ account: { appUrl, apiUrl, username } })
  if (input.password) setSecret(PASSWORD_SECRET, input.password)
  else if (!username) deleteSecret(PASSWORD_SECRET)
  return { ok: true, message: 'Saved.' }
}

function cleanUrl(value: string): string | null {
  const trimmed = value.trim()
  try {
    const url = new URL(trimmed)
    return url.protocol === 'https:' || url.protocol === 'http:' ? trimmed : null
  } catch {
    return null
  }
}
