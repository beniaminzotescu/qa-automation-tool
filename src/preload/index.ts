import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC, type AppApi, type ChatUpdate, type ApiState, type BrowserFrame, type BrowserState, type DraftsUpdate, type KnowledgeBase, type PrepareStatus, type StepLog, type TaskOutputEvent, type UpdateStatus } from '../shared/api'

const api: AppApi = {
  getAiSettings: () => ipcRenderer.invoke(IPC.getAiSettings),
  setAiMode: (mode) => ipcRenderer.invoke(IPC.setAiMode, mode),
  saveApiKey: (key) => ipcRenderer.invoke(IPC.saveApiKey, key),
  removeApiKey: () => ipcRenderer.invoke(IPC.removeApiKey),
  checkClaudeCode: () => ipcRenderer.invoke(IPC.checkClaudeCode),
  openClaudeLogin: () => ipcRenderer.invoke(IPC.openClaudeLogin),

  chooseFolder: () => ipcRenderer.invoke(IPC.chooseFolder),
  inspectFolder: (path) => ipcRenderer.invoke(IPC.inspectFolder, path),
  getProfile: (id) => ipcRenderer.invoke(IPC.getProfile, id),

  runChecks: (projectId) => ipcRenderer.invoke(IPC.runChecks, projectId),
  fixCheck: (projectId, checkId, taskId) => ipcRenderer.invoke(IPC.fixCheck, projectId, checkId, taskId),


  getChat: (projectId) => ipcRenderer.invoke(IPC.getChat, projectId),
  sendMessage: (projectId, text) => ipcRenderer.invoke(IPC.sendMessage, projectId, text),
  stopChat: (projectId) => ipcRenderer.invoke(IPC.stopChat, projectId),
  discardChat: (projectId) => ipcRenderer.invoke(IPC.discardChat, projectId),
  listChats: (projectId) => ipcRenderer.invoke(IPC.listChats, projectId),
  openChat: (projectId, chatId) => ipcRenderer.invoke(IPC.openChat, projectId, chatId),
  deleteChat: (projectId, chatId) => ipcRenderer.invoke(IPC.deleteChat, projectId, chatId),
  onChatUpdate: (listener) => {
    const handler = (_event: IpcRendererEvent, data: ChatUpdate): void => listener(data)
    ipcRenderer.on(IPC.chatUpdate, handler)
    return () => ipcRenderer.removeListener(IPC.chatUpdate, handler)
  },
  readAttachment: (projectId, path) => ipcRenderer.invoke(IPC.readAttachment, projectId, path),
  openTrace: (projectId, path) => ipcRenderer.invoke(IPC.openTrace, projectId, path),

  getRepoConfig: () => ipcRenderer.invoke(IPC.getRepoConfig),
  saveRepoConfig: (url, token) => ipcRenderer.invoke(IPC.saveRepoConfig, url, token),
  useLocalFolder: (path) => ipcRenderer.invoke(IPC.useLocalFolder, path),
  getSshKey: () => ipcRenderer.invoke(IPC.getSshKey),
  createSshKey: () => ipcRenderer.invoke(IPC.createSshKey),
  importSshKey: () => ipcRenderer.invoke(IPC.importSshKey),
  removeSshKey: () => ipcRenderer.invoke(IPC.removeSshKey),
  getPrepareStatus: () => ipcRenderer.invoke(IPC.getPrepareStatus),
  startPrepare: () => ipcRenderer.invoke(IPC.startPrepare),
  onPrepareUpdate: (listener) => {
    const handler = (_event: IpcRendererEvent, data: PrepareStatus): void => listener(data)
    ipcRenderer.on(IPC.prepareUpdate, handler)
    return () => ipcRenderer.removeListener(IPC.prepareUpdate, handler)
  },
  getOnboardingDone: () => ipcRenderer.invoke(IPC.getOnboardingDone),
  setOnboardingDone: (done) => ipcRenderer.invoke(IPC.setOnboardingDone, done),
  getUserType: () => ipcRenderer.invoke(IPC.getUserType),
  setUserType: (type) => ipcRenderer.invoke(IPC.setUserType, type),

  startBrowser: () => ipcRenderer.invoke(IPC.startBrowser),
  // send, not invoke: input and resizes are frequent and need no answer.
  setBrowserViewport: (width, height) => ipcRenderer.send(IPC.setBrowserViewport, width, height),
  browserInput: (input) => ipcRenderer.send(IPC.browserInput, input),
  browserNavigate: (action) => ipcRenderer.invoke(IPC.browserNavigate, action),
  browserLogin: () => ipcRenderer.invoke(IPC.browserLogin),
  onBrowserFrame: (listener) => {
    const handler = (_event: IpcRendererEvent, frame: BrowserFrame): void => listener(frame)
    ipcRenderer.on(IPC.browserFrame, handler)
    return () => ipcRenderer.removeListener(IPC.browserFrame, handler)
  },
  onBrowserState: (listener) => {
    const handler = (_event: IpcRendererEvent, state: BrowserState): void => listener(state)
    ipcRenderer.on(IPC.browserState, handler)
    return () => ipcRenderer.removeListener(IPC.browserState, handler)
  },

  getKnowledge: (projectId) => ipcRenderer.invoke(IPC.getKnowledge, projectId),
  addKnowledgeFiles: (projectId) => ipcRenderer.invoke(IPC.addKnowledgeFiles, projectId),
  addKnowledgeLink: (projectId, url, note) => ipcRenderer.invoke(IPC.addKnowledgeLink, projectId, url, note),
  updateKnowledgeNote: (projectId, id, note) => ipcRenderer.invoke(IPC.updateKnowledgeNote, projectId, id, note),
  removeKnowledgeItem: (projectId, id) => ipcRenderer.invoke(IPC.removeKnowledgeItem, projectId, id),

  getAppVersion: () => ipcRenderer.invoke(IPC.getAppVersion),
  getUpdateStatus: () => ipcRenderer.invoke(IPC.getUpdateStatus),
  restartToUpdate: () => ipcRenderer.invoke(IPC.restartToUpdate),
  onUpdateStatus: (listener) => {
    const handler = (_event: IpcRendererEvent, status: UpdateStatus): void => listener(status)
    ipcRenderer.on(IPC.updateStatus, handler)
    return () => ipcRenderer.removeListener(IPC.updateStatus, handler)
  },

  getApiState: (projectId) => ipcRenderer.invoke(IPC.getApiState, projectId),
  sendApiRequest: (projectId, request) => ipcRenderer.invoke(IPC.sendApiRequest, projectId, request),
  setApiCapturing: (projectId, on) => ipcRenderer.invoke(IPC.setApiCapturing, projectId, on),
  clearApiCalls: (projectId) => ipcRenderer.invoke(IPC.clearApiCalls, projectId),
  onApiState: (listener) => {
    const handler = (_event: IpcRendererEvent, update: { projectId: string; state: ApiState }): void => listener(update)
    ipcRenderer.on(IPC.apiState, handler)
    return () => ipcRenderer.removeListener(IPC.apiState, handler)
  },

  getDrafts: (projectId) => ipcRenderer.invoke(IPC.getDrafts, projectId),
  runDraft: (projectId, draftId) => ipcRenderer.invoke(IPC.runDraft, projectId, draftId),
  deleteDraft: (projectId, draftId) => ipcRenderer.invoke(IPC.deleteDraft, projectId, draftId),
  translateDraft: (projectId, draftId) => ipcRenderer.invoke(IPC.translateDraft, projectId, draftId),
  sendForReview: (projectId, draftId) => ipcRenderer.invoke(IPC.sendForReview, projectId, draftId),
  exportDraft: (projectId, draftId) => ipcRenderer.invoke(IPC.exportDraft, projectId, draftId),
  onDraftsUpdate: (listener) => {
    const handler = (_event: IpcRendererEvent, update: DraftsUpdate): void => listener(update)
    ipcRenderer.on(IPC.draftsUpdate, handler)
    return () => ipcRenderer.removeListener(IPC.draftsUpdate, handler)
  },

  getStepLog: (projectId) => ipcRenderer.invoke(IPC.getStepLog, projectId),
  setRecording: (projectId, recording) => ipcRenderer.invoke(IPC.setRecording, projectId, recording),
  setRecorderMode: (projectId, mode) => ipcRenderer.invoke(IPC.setRecorderMode, projectId, mode),
  undoStep: (projectId) => ipcRenderer.invoke(IPC.undoStep, projectId),
  clearSteps: (projectId) => ipcRenderer.invoke(IPC.clearSteps, projectId),
  askClaudeAboutSteps: (projectId) => ipcRenderer.invoke(IPC.askClaudeAboutSteps, projectId),
  onStepLogUpdate: (listener) => {
    const handler = (_event: IpcRendererEvent, update: { projectId: string; log: StepLog }): void => listener(update)
    ipcRenderer.on(IPC.stepLogUpdate, handler)
    return () => ipcRenderer.removeListener(IPC.stepLogUpdate, handler)
  },

  installTool: (tool) => ipcRenderer.invoke(IPC.installTool, tool),
  getAccount: () => ipcRenderer.invoke(IPC.getAccount),
  saveAccount: (input) => ipcRenderer.invoke(IPC.saveAccount, input),

  onTaskOutput: (listener) => {
    const handler = (_event: IpcRendererEvent, data: TaskOutputEvent): void => listener(data)
    ipcRenderer.on(IPC.taskOutput, handler)
    return () => ipcRenderer.removeListener(IPC.taskOutput, handler)
  }
}

contextBridge.exposeInMainWorld('api', api)
