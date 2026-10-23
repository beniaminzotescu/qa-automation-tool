import { app, BrowserWindow, dialog, ipcMain, screen, shell, type WebContents } from 'electron'
import { mkdirSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { IPC, type AccountInput, type AiMode, type AiSettings, type CheckId, type ApiRequest, type BrowserInput, type BrowserNavigation, type RecorderMode, type TestCase, type UserType } from '../shared/api'
import { getAccount, saveAccount } from './account'
import { getApiKeyStatus, removeApiKey, saveApiKey } from './apiKey'
import { fixCheck, runChecks } from './checks'
import { checkClaudeCode, openClaudeLogin } from './claudeCode'
import { inspectFolder, scanFramework } from './framework'
import { addRunResult, deleteChat, discardChat, doCaseStep, getChat, isTurnRunning, listChats, makeTestFromCase, openCaseInStudio, openChat, openTrace, readAttachment, reportTurnError, sendMessage, stopChat, translateDraft } from './chat'
import { exportForQa, sendForReview } from './translate'
import { getProject } from './projects'
import { currentProject, ensureFrameworkReady, getPrepareStatus, installTool, startPrepare } from './prepare'
import { getRepoConfig, saveRepoConfig, useLocalFolder } from './repo'
import { createSshKey, getSshKey, importSshKey, removeSshKey } from './sshKey'
import * as liveBrowser from './liveBrowser'
import { checkForUpdates, getUpdateStatus, restartToUpdate } from './updater'
import * as steps from './steps'
import * as apiWorkbench from './apiWorkbench'
import * as drafts from './drafts'
import * as knowledge from './knowledge'
import * as testCases from './testCases'
import * as azure from './azureTestPlans'
import { loadSettings, updateSettings } from './settings'

// For automated tests: run with a separate data folder, so a test never touches real settings.
if (process.env.TFB_USER_DATA) {
  // The long folder name, not the short one (BENIAM~1): the assistant's file tools use long names.
  mkdirSync(process.env.TFB_USER_DATA, { recursive: true })
  app.setPath('userData', realpathSync.native(process.env.TFB_USER_DATA))
} else {
  // The data folder keeps the app's earlier name (QA-ASD-STE100), so testers keep their settings,
  // tests and test cases after the rename. build/installer.nsh cleans this same folder.
  app.setPath('userData', join(app.getPath('appData'), 'QA-ASD-STE100'))
}

function createWindow(): void {
  // 1920x1080, or the whole screen when it is smaller (minus the taskbar).
  const workArea = screen.getPrimaryDisplay().workAreaSize
  const window = new BrowserWindow({
    width: Math.min(1920, workArea.width),
    height: Math.min(1080, workArea.height),
    minWidth: 1280,
    minHeight: 720,
    show: false,
    title: 'QA-STE100-Studio',
    // The installed app gets its icon from the program file; this is for running from source.
    ...(app.isPackaged ? {} : { icon: join(__dirname, '../../build/icon.png') }),
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
    inBackground(id, sendMessage(getProject(id), text))
  })
  ipcMain.handle(IPC.stopChat, (_event, id: string) => stopChat(id))
  ipcMain.handle(IPC.discardChat, (_event, id: string) => discardChat(getProject(id)))
  ipcMain.handle(IPC.listChats, (_event, id: string) => listChats(id))
  ipcMain.handle(IPC.openChat, (_event, id: string, chatId: string) => {
    openChat(id, chatId)
  })
  ipcMain.handle(IPC.deleteChat, (_event, id: string, chatId: string) => deleteChat(id, chatId))
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
  ipcMain.handle(IPC.getOnboardingDone, () => {
    const settings = loadSettings()
    if (settings.onboardingDone !== undefined) return settings.onboardingDone
    // Set up before the onboarding existed: don't show it again.
    return Boolean(settings.userType && settings.account && settings.projects.some((p) => p.setupDone))
  })
  ipcMain.handle(IPC.setOnboardingDone, (_event, done: boolean) => {
    updateSettings({ onboardingDone: done === true })
  })
  ipcMain.handle(IPC.getUserType, () => loadSettings().userType)
  ipcMain.handle(IPC.setUserType, (_event, type: UserType) => {
    updateSettings({ userType: type === 'technical' ? 'technical' : 'manual' })
  })

  ipcMain.handle(IPC.startBrowser, () => liveBrowser.startBrowser())
  ipcMain.handle(IPC.getBrowserInstall, () => liveBrowser.getBrowserInstall())
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

  ipcMain.handle(IPC.getTestCases, (_event, id: string) => testCases.getTestCases(getProject(id).id))
  // Reading and suggesting take a minute or two: not awaited; progress goes out as test case updates.
  ipcMain.handle(IPC.importTestCasesFile, async (event, id: string) => {
    getProject(id)
    const window = BrowserWindow.fromWebContents(event.sender)
    const options = {
      title: 'Choose a file with test cases',
      properties: ['openFile' as const],
      filters: [
        { name: 'Test cases', extensions: ['xlsx', 'csv', 'docx', 'pdf', 'txt', 'md'] },
        { name: 'All files', extensions: ['*'] }
      ]
    }
    const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options)
    if (!result.canceled) void testCases.importFile(id, result.filePaths[0])
  })
  ipcMain.handle(IPC.importTestCasesText, (_event, id: string, text: string) => {
    getProject(id)
    void testCases.importText(id, String(text ?? ''))
  })
  ipcMain.handle(IPC.suggestTestCases, (_event, id: string, basedOnCaseId: string | null) => {
    getProject(id)
    void testCases.suggest(id, typeof basedOnCaseId === 'string' ? basedOnCaseId : null)
  })
  ipcMain.handle(IPC.acceptProposals, (_event, id: string, ids: string[]) =>
    testCases.acceptProposals(getProject(id).id, Array.isArray(ids) ? ids.map(String) : [])
  )
  ipcMain.handle(IPC.discardProposals, (_event, id: string) => testCases.discardProposals(getProject(id).id))
  ipcMain.handle(IPC.saveTestCase, (_event, id: string, testCase: TestCase) => testCases.saveTestCase(getProject(id).id, testCase))
  ipcMain.handle(IPC.deleteTestCase, (_event, id: string, caseId: string) => testCases.deleteTestCase(getProject(id).id, caseId))
  ipcMain.handle(IPC.getAzureConfig, (_event, id: string) => azure.getAzureConfig(id ? getProject(id) : null))
  ipcMain.handle(IPC.saveAzureConfig, (_event, orgUrl: string, project: string, token: string) =>
    azure.saveAzureConfig(String(orgUrl ?? ''), String(project ?? ''), String(token ?? ''))
  )
  ipcMain.handle(IPC.listAzurePlans, () => azure.listAzurePlans())
  ipcMain.handle(IPC.listAzureSuites, (_event, planId: number) => azure.listAzureSuites(Number(planId)))
  ipcMain.handle(IPC.importAzureSuite, (_event, id: string, planId: number, suiteId: number) => {
    getProject(id)
    void azure.importAzureSuite(id, Number(planId), Number(suiteId))
  })

  ipcMain.handle(IPC.openCaseInStudio, (_event, id: string, caseId: string | null) =>
    openCaseInStudio(getProject(id).id, typeof caseId === 'string' ? caseId : null)
  )
  ipcMain.handle(IPC.setCurrentCaseStep, (_event, id: string, caseStepId: string | null) =>
    steps.setCurrentCaseStep(getProject(id).id, typeof caseStepId === 'string' ? caseStepId : null)
  )
  ipcMain.handle(IPC.clearCaseStep, (_event, id: string, caseStepId: string) => steps.clearCaseStep(getProject(id).id, String(caseStepId)))
  // Not awaited: chat turns. Progress goes out as chat updates.
  ipcMain.handle(IPC.doCaseStep, (_event, id: string, caseStepId: string) => {
    inBackground(id, doCaseStep(getProject(id).id, String(caseStepId)))
  })
  ipcMain.handle(IPC.makeTestFromCase, (_event, id: string) => {
    inBackground(id, makeTestFromCase(getProject(id).id))
  })

  ipcMain.handle(IPC.getAppVersion, () => app.getVersion())
  ipcMain.handle(IPC.getUpdateStatus, () => getUpdateStatus())
  ipcMain.handle(IPC.restartToUpdate, () => restartToUpdate())
  ipcMain.handle(IPC.getApiState, (_event, id: string) => apiWorkbench.getApiState(id))
  ipcMain.handle(IPC.sendApiRequest, (_event, id: string, request: ApiRequest) => apiWorkbench.sendRequest(id, request))
  ipcMain.handle(IPC.setApiCapturing, (_event, id: string, on: boolean) => apiWorkbench.setCapturing(id, on === true))
  ipcMain.handle(IPC.clearApiCalls, (_event, id: string) => apiWorkbench.clearCalls(id))
  ipcMain.handle(IPC.getDrafts, (_event, id: string) => drafts.getDraftsUpdate(id))
  // Not awaited: a run can take minutes. Progress goes out as drafts and chat updates.
  ipcMain.handle(IPC.runDraft, (_event, id: string, draftId: string) => {
    canRunTests(id)
    const name = drafts.listDrafts(id).find((d) => d.id === draftId)?.name ?? 'the test'
    void drafts
      .runDraft(id, draftId)
      .then((report) => addRunResult(id, name, report))
      .catch(() => addRunResult(id, name, null))
  })
  // From Your tests: results go to the tests' history, not into the chat.
  ipcMain.handle(IPC.runDrafts, (_event, id: string, draftIds: string[]) => {
    canRunTests(id)
    void drafts.runDrafts(id, Array.isArray(draftIds) ? draftIds.map(String) : []).catch(() => {})
  })
  ipcMain.handle(IPC.stopDrafts, (_event, id: string) => drafts.stopDrafts(getProject(id).id))
  ipcMain.handle(IPC.setDraftPersonal, (_event, id: string, draftId: string, personal: boolean) =>
    drafts.setDraftPersonal(getProject(id).id, String(draftId), personal === true)
  )
  ipcMain.handle(IPC.renameDraft, (_event, id: string, draftId: string, name: string) =>
    drafts.renameDraft(getProject(id).id, String(draftId), String(name ?? ''))
  )
  ipcMain.handle(IPC.deleteDraft, (_event, id: string, draftId: string) => drafts.deleteDraft(id, draftId))
  // Not awaited: the translation is a chat turn; progress goes out as chat updates.
  ipcMain.handle(IPC.translateDraft, (_event, id: string, draftId: string) => {
    inBackground(id, translateDraft(id, draftId))
  })
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
    inBackground(
      id,
      sendMessage(getProject(id), 'Make a test from the steps I recorded. Ask me only what is still missing, then show me the plan.')
    )
  })
  ipcMain.handle(IPC.browserLogin, () => liveBrowser.logIn())
  ipcMain.handle(IPC.browserNavigate, (_event, action: BrowserNavigation | { url: string }) => liveBrowser.navigate(action))
}

/** Tests run in the live browser, one run at a time, and not while the assistant works in it. */
function canRunTests(projectId: string): void {
  getProject(projectId)
  if (isTurnRunning(projectId)) throw new Error('Wait until the assistant has finished: it is using the browser.')
  if (drafts.isDraftRunning()) throw new Error('Tests are already running. Wait until they are done, or press Stop.')
}

/** A chat turn the window doesn't wait for: if it fails before reaching the chat, the chat says so. */
function inBackground(projectId: string, turn: Promise<void>): void {
  turn.catch((error) => reportTurnError(projectId, error))
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
  liveBrowser.prefetchBrowser()
  // What the framework needs for translations installs in the background, not while the tester waits.
  const project = currentProject()
  if (project) void ensureFrameworkReady(project)
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
