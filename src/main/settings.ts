import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { AiMode, Project, UserType } from '../shared/api'

// Non-secret app settings, stored as JSON in the app-data folder. Secrets live in secrets.ts.

interface Settings {
  aiMode: AiMode
  projects: Project[]
  /** The QA team's framework repository (set by an admin). The token is in secrets. */
  repo: { url: string | null; localFolder: string | null }
  userType: UserType | null
  /** The tester's environment. The password is in secrets. */
  account: { appUrl: string; apiUrl?: string; username: string } | null
}

const DEFAULTS: Settings = {
  aiMode: 'claude-code',
  projects: [],
  repo: { url: null, localFolder: null },
  userType: null,
  account: null
}

const settingsPath = (): string => join(app.getPath('userData'), 'settings.json')

export function loadSettings(): Settings {
  const file = settingsPath()
  if (!existsSync(file)) return { ...DEFAULTS }
  try {
    return { ...DEFAULTS, ...JSON.parse(readFileSync(file, 'utf8')) }
  } catch {
    return { ...DEFAULTS }
  }
}

export function updateSettings(changes: Partial<Settings>): Settings {
  const settings = { ...loadSettings(), ...changes }
  mkdirSync(dirname(settingsPath()), { recursive: true })
  writeFileSync(settingsPath(), JSON.stringify(settings, null, 2))
  return settings
}
