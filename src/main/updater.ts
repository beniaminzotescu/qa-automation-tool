import { app, dialog } from 'electron'
import { autoUpdater } from 'electron-updater'

// Checks GitHub Releases for a newer version when the app starts, downloads it in the background,
// and offers to restart. Only in the installed app; never while developing.

export function checkForUpdates(): void {
  if (!app.isPackaged) return
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.on('update-downloaded', async (info) => {
    const { response } = await dialog.showMessageBox({
      type: 'info',
      buttons: ['Restart now', 'Later'],
      defaultId: 0,
      title: 'Update ready',
      message: `QA-ASD-STE100 ${info.version} is ready.`,
      detail: 'Restart now to use it, or it installs the next time you close the app.'
    })
    if (response === 0) autoUpdater.quitAndInstall()
  })
  // No internet or no release yet: the app works as it is.
  autoUpdater.checkForUpdates().catch(() => {})
}
