import { useEffect, useState } from 'react'
import type { Chat, DraftsUpdate, Project } from '../../../shared/api'
import ChatTab from '../components/chat/ChatTab'
import ActionsPanel from '../components/studio/ActionsPanel'
import LiveBrowser from '../components/studio/LiveBrowser'

/**
 * The Studio: chat, live browser and actions side by side. The user, Claude and test runs all
 * work in the same live browser, so every action is visible.
 */
export default function StudioScreen({ project }: { project: Project }) {
  const [chat, setChat] = useState<Chat | null>(null)
  const [drafts, setDrafts] = useState<DraftsUpdate | null>(null)

  useEffect(() => {
    window.api.getChat(project.id).then(setChat)
    window.api.getDrafts(project.id).then(setDrafts)
    const offChat = window.api.onChatUpdate((update) => {
      if (update.projectId === project.id) setChat(update.chat)
    })
    const offDrafts = window.api.onDraftsUpdate((update) => {
      if (update.projectId === project.id) setDrafts(update)
    })
    return () => {
      offChat()
      offDrafts()
    }
  }, [project.id])

  const claudeWorking = chat?.status === 'working' || chat?.status === 'preparing'
  const testRunning = drafts?.runningDraftId != null
  const busyLabel = claudeWorking
    ? 'Automating… (your input is paused)'
    : testRunning
      ? 'Running your test… (your input is paused)'
      : null

  return (
    <div className="studio">
      <section className="studio-chat">
        <ChatTab project={project} />
      </section>

      <section className="studio-browser">
        <LiveBrowser busyLabel={busyLabel} onStop={claudeWorking ? () => window.api.stopChat(project.id) : null} />
      </section>

      <aside className="studio-actions">
        <ActionsPanel projectId={project.id} claudeWorking={claudeWorking || testRunning} drafts={drafts} />
      </aside>
    </div>
  )
}
