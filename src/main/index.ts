import { app, BrowserWindow, dialog, ipcMain, screen, shell, type WebContents } from 'electron'
import { join } from 'node:path'
import { IPC, type AccountInput, type AiMode, type AiSettings, type CheckId, type BrowserInput, type BrowserNavigation, type RecorderMode, type UserType } from '../shared/api'
import { getAccount, saveAccount } from './account'
import { getApiKeyStatus, removeApiKey, saveApiKey } from './apiKey'
import { fixCheck, runChecks } from './checks'
import { checkClaudeCode, openClaudeLogin } from './claudeCode'
import { inspectFolder, scanFramework } from './framework'
import { addRunResult, discardChat, getChat, openTrace, readAttachment, sendMessage, stopChat, translateDraft } from './chat'
import { exportForQa, sendForReview } from './translate'
import { getProject } from './projects'
import { getPrepareStatus, installTool, startPrepare } from './prepare'
import { getRepoConfig, saveRepoConfig, useLocalFolder } from './repo'
import { createSshKey, getSshKey, importSshKey, removeSshKey } from './sshKey'
import * as liveBrowser from './liveBrowser'
import { checkForUpdates } from './updater'
import * as steps from './steps'
import * as drafts from './drafts'
import * as knowledge from './knowledge'
import { loadSettings, updateSettings } from './settings'

// For automated tests: run with a separate data folder, so a test never touches real settings.
if (process.env.TFB_USER_DATA) app.setPath('userData', process.env.TFB_USER_DATA)

function createWindow(): void {
  // 1920x1080, or the whole screen when it is smaller (minus the taskbar).
  const workArea = screen.getPrimaryDisplay().workAreaSize
  const window = new BrowserWindow({
    width: Math.min(1920, workArea.width),
    height: Math.min(1080, workArea.height),
    minWidth: 1280,
    minHeight: 720,
    show: false,
    title: 'QA-ASD-STE100',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true
    }
  })

  window.on('ready-to-show', () => window.show())

  // Links open in the user's browser, never inside the app.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url)
    return { action: 'deny' }
  })

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    window.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    window.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function aiSettings(): AiSettings {
  return { mode: loadSettings().aiMode, apiKey: getApiKeyStatus() }
}

function registerIpc(): void {
  ipcMain.handle(IPC.getAiSettings, () => aiSettings())
  ipcMain.handle(IPC.setAiMode, (_event, mode: AiMode) => {
    if (mode !== 'claude-code' && mode !== 'api-key') throw new Error(`Unknown mode: ${mode}`)
    updateSettings({ aiMode: mode })
    return aiSettings()
  })
  ipcMain.handle(IPC.saveApiKey, (_event, key: string) => saveApiKey(key))
  ipcMain.handle(IPC.removeApiKey, () => removeApiKey())
  ipcMain.handle(IPC.checkClaudeCode, () => checkClaudeCode())
  ipcMain.handle(IPC.openClaudeLogin, () => openClaudeLogin())

  ipcMain.handle(IPC.chooseFolder, async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    const options = { title: 'Choose the framework folder', properties: ['openDirectory' as const] }
    const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options)
    return result.canceled ? null : result.filePaths[0]
  })
  ipcMain.handle(IPC.inspectFolder, (_event, path: string) => inspectFolder(path))
  ipcMain.handle(IPC.getProfile, (_event, id: string) => scanFramework(getProject(id).workspacePath))
  ipcMain.handle(IPC.runChecks, (_event, id: string) => runChecks(getProject(id)))
  ipcMain.handle(IPC.fixCheck, (event, id: string, checkId: CheckId, taskId: string) =>
    fixCheck(getProject(id), checkId, taskOutput(event.sender, taskId))
  )


  ipcMain.handle(IPC.getChat, (_event, id: string) => getChat(id))
  // Not awaited: the turn can take many minutes. Progress goes out as chat updates.
  ipcMain.handle(IPC.sendMessage, (_event, id: string, text: string) => {
    void sendMessage(getProject(id), text)
  })
  ipcMain.handle(IPC.stopChat, (_event, id: string) => stopChat(id))
  ipcMain.handle(IPC.discardChat, (_event, id: string) => discardChat(getProject(id)))
  ipcMain.handle(IPC.readAttachment, (_event, id: string, path: string) => readAttachment(getProject(id), path))
  ipcMain.handle(IPC.openTrace, (_event, id: string, path: string) => openTrace(getProject(id), path))

  ipcMain.handle(IPC.getRepoConfig, () => getRepoConfig())
  ipcMain.handle(IPC.saveRepoConfig, (_event, url: string, token: string) => saveRepoConfig(url, token))
  ipcMain.handle(IPC.useLocalFolder, (_event, path: string | null) => useLocalFolder(path))
  ipcMain.handle(IPC.getSshKey, () => getSshKey())
  ipcMain.handle(IPC.createSshKey, () => createSshKey())
  ipcMain.handle(IPC.importSshKey, async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    const options = { title: 'Choose your private SSH key (the file without .pub)', properties: ['openFile' as const, 'showHiddenFiles' as const] }
    const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options)
    return result.canceled ? null : importSshKey(result.filePaths[0])
  })
  ipcMain.handle(IPC.removeSshKey, () => {
    removeSshKey()
    return getSshKey()
  })
  ipcMain.handle(IPC.getPrepareStatus, () => getPrepareStatus())
  // Not awaited: progress goes out as prepare updates.
  ipcMain.handle(IPC.startPrepare, () => {
    void startPrepare()
  })
  ipcMain.handle(IPC.installTool, (_event, tool: 'git' | 'node') => installTool(tool === 'git' ? 'git' : 'node'))
  ipcMain.handle(IPC.getAccount, () => getAccount())
  ipcMain.handle(IPC.saveAccount, (_event, input: AccountInput) => saveAccount(input))
  ipcMain.handle(IPC.getUserType, () => loadSettings().userType)
  ipcMain.handle(IPC.setUserType, (_event, type: UserType) => {
    updateSettings({ userType: type === 'technical' ? 'technical' : 'manual' })
  })

  ipcMain.handle(IPC.startBrowser, () => liveBrowser.startBrowser())
  ipcMain.on(IPC.setBrowserViewport, (_event, width: number, height: number) => void liveBrowser.setViewport(width, height))
  ipcMain.on(IPC.browserInput, (_event, input: BrowserInput) => void liveBrowser.input(input))
  ipcMain.handle(IPC.getKnowledge, (_event, id: string) => knowledge.getKnowledge(id))
  ipcMain.handle(IPC.addKnowledgeFiles, async (event, id: string) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    const options = {
      title: 'Add documentation of the application',
      properties: ['openFile' as const, 'multiSelections' as const]
    }
    const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options)
    return result.canceled ? knowledge.getKnowledge(id) : knowledge.addFiles(id, result.filePaths)
  })
  ipcMain.handle(IPC.addKnowledgeLink, (_event, id: string, url: string, note: string) => knowledge.addLink(id, url, note))
  ipcMain.handle(IPC.updateKnowledgeNote, (_event, id: string, itemId: string, note: string) =>
    knowledge.updateNote(id, itemId, note)
  )
  ipcMain.handle(IPC.removeKnowledgeItem, (_event, id: string, itemId: string) => knowledge.removeItem(id, itemId))

  ipcMain.handle(IPC.getDrafts, (_event, id: string) => drafts.getDraftsUpdate(id))
  // Not awaited: a run can take minutes. Progress goes out as drafts and chat updates.
  ipcMain.handle(IPC.runDraft, (_event, id: string, draftId: string) => {
    const name = drafts.listDrafts(id).find((d) => d.id === draftId)?.name ?? 'the test'
    void drafts
      .runDraft(id, draftId)
      .then((report) => addRunResult(id, name, report))
      .catch(() => addRunResult(id, name, null))
  })
  ipcMain.handle(IPC.deleteDraft, (_event, id: string, draftId: string) => drafts.deleteDraft(id, draftId))
  // Not awaited: the translation is a chat turn; progress goes out as chat updates.
  ipcMain.handle(IPC.translateDraft, (_event, id: string, draftId: string) => translateDraft(id, draftId))
  ipcMain.handle(IPC.sendForReview, (_event, id: string, draftId: string) => sendForReview(getProject(id), draftId))
  ipcMain.handle(IPC.exportDraft, (event, id: string, draftId: string) =>
    exportForQa(getProject(id), draftId, BrowserWindow.fromWebContents(event.sender))
  )

  ipcMain.handle(IPC.getStepLog, (_event, id: string) => steps.getStepLog(id))
  ipcMain.handle(IPC.setRecording, (_event, id: string, recording: boolean) => steps.setRecording(id, recording))
  ipcMain.handle(IPC.setRecorderMode, (_event, id: string, mode: RecorderMode) => steps.setMode(id, mode))
  ipcMain.handle(IPC.undoStep, (_event, id: string) => steps.undoStep(id))
  ipcMain.handle(IPC.clearSteps, (_event, id: string) => steps.clearSteps(id))
  // Not awaited: the chat turn can take minutes. Progress goes out as chat updates.
  ipcMain.handle(IPC.askClaudeAboutSteps, (_event, id: string) => {
    void sendMessage(
      getProject(id),
      'Make a test from the steps I recorded. Ask me only what is still missing, then show me the plan.'
    )
  })
  ipcMain.handle(IPC.browserLogin, () => liveBrowser.logIn())
  ipcMain.handle(IPC.browserNavigate, (_event, action: BrowserNavigation | { url: string }) => liveBrowser.navigate(action))
}

/** Streams a long task's output to the window that started it. */
function taskOutput(sender: WebContents, taskId: string): (chunk: string) => void {
  return (chunk) => {
    if (!sender.isDestroyed()) sender.send(IPC.taskOutput, { taskId, chunk })
  }
}

app.whenReady().then(() => {
  registerIpc()
  createWindow()
  checkForUpdates()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// The live browser is a separate program; close it with the app.
app.on('before-quit', () => {
  void liveBrowser.closeBrowser()
})
