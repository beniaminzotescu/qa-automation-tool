import { app, safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

// Secrets are encrypted with the OS (DPAPI on Windows) and kept in the app-data folder,
// one file per secret. They are never written to the framework repo.

const secretsDir = (): string => join(app.getPath('userData'), 'secrets')
const secretPath = (name: string): string => join(secretsDir(), `${name}.bin`)

export function setSecret(name: string, value: string): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Secure storage is not available on this computer.')
  }
  mkdirSync(secretsDir(), { recursive: true })
  writeFileSync(secretPath(name), safeStorage.encryptString(value))
}

export function getSecret(name: string): string | null {
  const file = secretPath(name)
  if (!existsSync(file)) return null
  try {
    return safeStorage.decryptString(readFileSync(file))
  } catch {
    // Encrypted by another Windows user or machine: treat as missing.
    return null
  }
}

export function deleteSecret(name: string): void {
  rmSync(secretPath(name), { force: true })
}
