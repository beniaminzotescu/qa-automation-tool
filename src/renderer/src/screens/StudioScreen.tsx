import { useEffect, useState } from 'react'
import type { ApiCall, ApiRequest, ApiState, Chat, DraftsUpdate, Project } from '../../../shared/api'
import ChatTab from '../components/chat/ChatTab'
import ActionsPanel from '../components/studio/ActionsPanel'
import LiveBrowser from '../components/studio/LiveBrowser'
import ApiWorkbench, { emptyRequest } from '../components/api/ApiWorkbench'
import ApiCallsPanel from '../components/api/ApiCallsPanel'

type Mode = 'ui' | 'api'
const MODE_KEY = 'studio-mode'

/**
 * The Studio: chat, the work area and actions side by side. UI tests use the live browser
 * (the user, the assistant and test runs all work in it); API tests use the API workbench.
 */
export default function StudioScreen({ project }: { project: Project }) {
  const [chat, setChat] = useState<Chat | null>(null)
  const [drafts, setDrafts] = useState<DraftsUpdate | null>(null)
  const [api, setApi] = useState<ApiState | null>(null)
  const [mode, setMode] = useState<Mode>(() => {
    try {
      return localStorage.getItem(MODE_KEY) === 'api' ? 'api' : 'ui'
    } catch {
      return 'ui'
    }
  })
  // The call being written in the workbench, and the last answer shown.
  const [request, setRequest] = useState<ApiRequest>(emptyRequest)
  const [result, setResult] = useState<ApiCall | null>(null)

  useEffect(() => {
    window.api.getChat(project.id).then(setChat)
    window.api.getDrafts(project.id).then(setDrafts)
    window.api.getApiState(project.id).then(setApi)
    const offChat = window.api.onChatUpdate((update) => {
      if (update.projectId === project.id) setChat(update.chat)
    })
    const offDrafts = window.api.onDraftsUpdate((update) => {
      if (update.projectId === project.id) setDrafts(update)
    })
    const offApi = window.api.onApiState((update) => {
      if (update.projectId === project.id) setApi(update.state)
    })
    return () => {
      offChat()
      offDrafts()
      offApi()
    }
  }, [project.id])

  function switchMode(next: Mode): void {
    setMode(next)
    try {
      localStorage.setItem(MODE_KEY, next)
    } catch {
      // Not remembered; it still switches.
    }
  }

  /** A call from the list opens in the workbench, with its answer. */
  function openCall(call: ApiCall): void {
    setRequest(call.request)
    setResult(call)
    switchMode('api')
  }

  const claudeWorking = chat?.status === 'working' || chat?.status === 'preparing'
  const testRunning = drafts?.runningDraftId != null
  const busyLabel = claudeWorking
    ? 'Automating… (your input is paused)'
    : testRunning
      ? 'Running your test… (your input is paused)'
      : null
  const captured = api?.calls.filter((call) => call.source === 'captured').length ?? 0

  return (
    <div className="studio">
      <section className="studio-chat">
        <ChatTab project={project} />
      </section>

      <section className="studio-browser">
        <div className="studio-mode-bar">
          <div className="mode-switch" role="tablist" aria-label="Kind of test">
            <button role="tab" aria-selected={mode === 'ui'} className={mode === 'ui' ? 'active' : ''} onClick={() => switchMode('ui')}>
              UI tests
            </button>
            <button role="tab" aria-selected={mode === 'api'} className={mode === 'api' ? 'active' : ''} onClick={() => switchMode('api')}>
              API tests
            </button>
          </div>
          {api?.capturing && (
            <div className="capture-indicator">
              <span className="capture-dot" /> Capturing API calls ({captured})
              <button className="button link small" onClick={() => window.api.setApiCapturing(project.id, false)}>
                Stop
              </button>
            </div>
          )}
        </div>
        <div className="studio-work">
          {mode === 'ui' ? (
            <LiveBrowser busyLabel={busyLabel} onStop={claudeWorking ? () => window.api.stopChat(project.id) : null} />
          ) : (
            api && (
              <ApiWorkbench
                projectId={project.id}
                state={api}
                request={request}
                onRequestChange={setRequest}
                result={result}
                onResult={setResult}
              />
            )
          )}
        </div>
      </section>

      <aside className="studio-actions">
        {mode === 'ui' ? (
          <ActionsPanel projectId={project.id} claudeWorking={claudeWorking || testRunning} drafts={drafts} />
        ) : (
          api && (
            <ApiCallsPanel
              projectId={project.id}
              state={api}
              selectedId={result?.id ?? null}
              onOpen={openCall}
              onSwitchToUi={() => switchMode('ui')}
            />
          )
        )}
      </aside>
    </div>
  )
}
