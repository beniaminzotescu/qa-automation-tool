import { app } from 'electron'
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { SshKeyResult, SshKeyStatus } from '../shared/api'
import { quote, runCommand } from './process'

// The tester's SSH key for git (clone, and later push). Kept in the app's data folder with
// access limited to the Windows user, like ~/.ssh. Git uses it only for this app's commands
// (GIT_SSH_COMMAND), so the tester's own git setup is not changed.

const sshDir = (): string => join(app.getPath('userData'), 'ssh')
const keyFile = (): string => join(sshDir(), 'id_rsa')
const knownHostsFile = (): string => join(sshDir(), 'known_hosts')

export function getSshKey(): SshKeyStatus {
  if (!existsSync(keyFile()) || !existsSync(`${keyFile()}.pub`)) return { hasKey: false, publicKey: null }
  return { hasKey: true, publicKey: readFileSync(`${keyFile()}.pub`, 'utf8').trim() }
}

/** Environment that makes git use the app's key for SSH addresses. Empty when there is no key. */
export function sshEnv(): Record<string, string> {
  if (!existsSync(keyFile())) return {}
  const slash = (path: string): string => path.replace(/\\/g, '/')
  return {
    GIT_SSH_COMMAND: [
      'ssh',
      `-i "${slash(keyFile())}"`,
      '-o IdentitiesOnly=yes',
      // Never wait for a question the user can't see (passphrase, unknown host).
      '-o BatchMode=yes',
      '-o StrictHostKeyChecking=accept-new',
      `-o UserKnownHostsFile="${slash(knownHostsFile())}"`
    ].join(' ')
  }
}

/** Makes a new key pair. RSA, because Azure DevOps and GitHub both accept it. */
export async function createSshKey(): Promise<SshKeyResult> {
  const keygen = await findSshKeygen()
  if (!keygen) return { ok: false, message: 'The SSH tools were not found. Git must be installed on this computer.' }
  removeSshKey()
  mkdirSync(sshDir(), { recursive: true })
  const result = await runCommand(
    `${quote(keygen)} -t rsa -b 4096 -N "" -C "qa-asd-ste100@${process.env.COMPUTERNAME ?? 'pc'}" -f ${quote(keyFile())}`,
    { cwd: sshDir(), timeoutMs: 60_000 }
  )
  if (result.code !== 0 || !existsSync(keyFile())) {
    return { ok: false, message: `The key could not be created: ${result.output.trim().split('\n').pop()}` }
  }
  await restrictAccess(keyFile())
  return { ok: true, status: getSshKey() }
}

/** Uses the tester's existing private key (a file). Keys with a passphrase are not supported. */
export async function importSshKey(path: string): Promise<SshKeyResult> {
  const keygen = await findSshKeygen()
  if (!keygen) return { ok: false, message: 'The SSH tools were not found. Git must be installed on this computer.' }
  const text = readFileSync(path, 'utf8')
  if (!/PRIVATE KEY-----/.test(text)) {
    return { ok: false, message: 'This file is not a private key. Choose the file without ".pub" (for example id_rsa).' }
  }

  mkdirSync(sshDir(), { recursive: true })
  const staging = join(sshDir(), 'import-check')
  copyFileSync(path, staging)
  await restrictAccess(staging)
  // Reading the public key needs no passphrase only when the key has none ( -P "" ).
  const publicKey = await runCommand(`${quote(keygen)} -y -P "" -f ${quote(staging)}`, { cwd: sshDir(), timeoutMs: 30_000 })
  if (publicKey.code !== 0) {
    rmSync(staging, { force: true })
    return /passphrase|incorrect/i.test(publicKey.output)
      ? { ok: false, message: 'This key has a passphrase. Use a key without a passphrase, or create a new key in the app.' }
      : { ok: false, message: `The key could not be read: ${publicKey.output.trim().split('\n').pop()}` }
  }

  removeSshKey()
  copyFileSync(staging, keyFile())
  rmSync(staging, { force: true })
  await restrictAccess(keyFile())
  writePublicKey(publicKey.output.trim())
  return { ok: true, status: getSshKey() }
}

export function removeSshKey(): void {
  rmSync(keyFile(), { force: true })
  rmSync(`${keyFile()}.pub`, { force: true })
}

function writePublicKey(text: string): void {
  mkdirSync(dirname(keyFile()), { recursive: true })
  require('node:fs').writeFileSync(`${keyFile()}.pub`, `${text}\n`)
}

/** Only the current Windows user may read the key (SSH refuses keys others can read). */
async function restrictAccess(path: string): Promise<void> {
  if (process.platform !== 'win32') return
  const user = process.env.USERNAME
  if (!user) return
  await runCommand(`icacls ${quote(path)} /inheritance:r /grant:r "${user}:F"`, { cwd: sshDir(), timeoutMs: 15_000 })
}

/** Git's own ssh-keygen (matches the ssh git uses), or one on PATH. */
async function findSshKeygen(): Promise<string | null> {
  const execPath = await runCommand('git --exec-path', { cwd: app.getPath('userData'), timeoutMs: 15_000 })
  if (execPath.code === 0) {
    // ...\Git\mingw64\libexec\git-core → ...\Git\usr\bin\ssh-keygen.exe
    const gitRoot = join(execPath.output.trim(), '..', '..', '..')
    const bundled = join(gitRoot, 'usr', 'bin', 'ssh-keygen.exe')
    if (existsSync(bundled)) return bundled
  }
  const onPath = await runCommand('where ssh-keygen', { cwd: app.getPath('userData'), timeoutMs: 15_000 })
  return onPath.code === 0 ? onPath.output.trim().split(/\r?\n/)[0] : null
}
