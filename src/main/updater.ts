import { app, BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'
import { IPC, type UpdateStatus } from '../shared/api'

// Checks GitHub Releases for a newer version when the app starts and downloads it in the
// background. The app shows the progress in a bar and offers "Restart to update"; otherwise
// the update installs when the app is closed. Only in the installed app, never while developing.

let status: UpdateStatus = { state: 'idle', version: null, percent: 0 }

function update(next: Partial<UpdateStatus>): void {
  status = { ...status, ...next }
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(IPC.updateStatus, status)
  }
}

export function getUpdateStatus(): UpdateStatus {
  return status
}

export function checkForUpdates(): void {
  if (!app.isPackaged) return
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.on('update-available', (info) => update({ state: 'downloading', version: info.version, percent: 0 }))
  autoUpdater.on('download-progress', (progress) => update({ state: 'downloading', percent: Math.round(progress.percent) }))
  autoUpdater.on('update-downloaded', (info) => update({ state: 'ready', version: info.version, percent: 100 }))
  // No internet or no release yet: the app works as it is, and says nothing.
  autoUpdater.on('error', () => update({ state: 'idle' }))
  autoUpdater.checkForUpdates().catch(() => update({ state: 'idle' }))
}

/**
 * Closes the app and runs the installer visibly: it shows only its "Installing…" progress page
 * (see build/installer.nsh), then starts the app again by itself.
 */
export function restartToUpdate(): void {
  if (status.state === 'ready') autoUpdater.quitAndInstall(false, true)
}
