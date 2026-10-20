import Anthropic from '@anthropic-ai/sdk'
import type { ApiKeyStatus, SaveApiKeyResult } from '../shared/api'
import { deleteSecret, getSecret, setSecret } from './secrets'

const SECRET_NAME = 'anthropic-api-key'

export function getApiKey(): string | null {
  return getSecret(SECRET_NAME)
}

export function getApiKeyStatus(): ApiKeyStatus {
  const key = getApiKey()
  return { hasKey: key !== null, hint: key ? key.slice(-4) : null }
}

export function removeApiKey(): ApiKeyStatus {
  deleteSecret(SECRET_NAME)
  return getApiKeyStatus()
}

export async function saveApiKey(rawKey: string): Promise<SaveApiKeyResult> {
  const key = rawKey.trim()
  if (!key) return { ok: false, message: 'Paste your Claude API key first.' }

  const problem = await checkApiKey(key)
  if (problem) return { ok: false, message: problem }

  setSecret(SECRET_NAME, key)
  return { ok: true, status: getApiKeyStatus() }
}

/** Returns null when the key works, otherwise a message a non-technical user can act on. */
async function checkApiKey(key: string): Promise<string | null> {
  // Listing models is free and proves the key is accepted.
  const client = new Anthropic({ apiKey: key, maxRetries: 1, timeout: 15_000 })
  try {
    await client.models.list({ limit: 1 })
    return null
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) {
      return 'This key was not accepted. Check that you copied the whole key, or create a new one in the Claude Console.'
    }
    if (error instanceof Anthropic.PermissionDeniedError) {
      return 'This key does not have permission to use Claude. Ask your admin to check the key.'
    }
    if (error instanceof Anthropic.RateLimitError) {
      return 'Too many requests right now. Wait a minute and try again.'
    }
    if (error instanceof Anthropic.APIConnectionError) {
      return 'Could not reach Claude. Check your internet connection and try again.'
    }
    if (error instanceof Anthropic.APIError && error.type === 'billing_error') {
      return 'This key\'s account has no credit left. Ask your admin to add credit in the Claude Console.'
    }
    if (error instanceof Anthropic.APIError) {
      return `Claude returned an error (${error.status ?? 'unknown'}). Try again in a few minutes.`
    }
    throw error
  }
}
