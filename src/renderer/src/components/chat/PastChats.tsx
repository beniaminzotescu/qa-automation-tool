import { useEffect, useState } from 'react'
import type { ChatSummary } from '../../../../shared/api'

/** The list of earlier conversations: open one to continue it, or delete it. */
export default function PastChats({
  projectId,
  currentId,
  onClose
}: {
  projectId: string
  currentId: string | null
  onClose(): void
}) {
  const [chats, setChats] = useState<ChatSummary[] | null>(null)

  useEffect(() => {
    window.api.listChats(projectId).then(setChats)
  }, [projectId])

  async function open(id: string): Promise<void> {
    await window.api.openChat(projectId, id)
    onClose()
  }

  async function remove(chat: ChatSummary): Promise<void> {
    if (!window.confirm(`Delete the conversation "${chat.title}"?\n\nTests you kept from it stay.`)) return
    setChats(await window.api.deleteChat(projectId, chat.id))
  }

  return (
    <div className="past-chats">
      <div className="past-chats-head">
        <strong>Past chats</strong>
        <button className="button link small" onClick={onClose}>
          Close
        </button>
      </div>
      {!chats ? null : chats.length === 0 ? (
        <p className="small muted">No conversations yet.</p>
      ) : (
        <ul>
          {chats.map((chat) => (
            <li key={chat.id} className={chat.id === currentId ? 'current' : undefined}>
              <button className="past-chat" onClick={() => open(chat.id)}>
                <span className="past-chat-title">{chat.title}</span>
                <span className="small muted">
                  {formatWhen(chat.updatedAt)} · {chat.messages} message{chat.messages === 1 ? '' : 's'}
                  {chat.id === currentId ? ' · open now' : ''}
                </span>
              </button>
              <button className="button link small danger" title="Delete this conversation" onClick={() => remove(chat)}>
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function formatWhen(iso: string): string {
  const date = new Date(iso)
  const today = new Date()
  const sameDay = date.toDateString() === today.toDateString()
  return sameDay
    ? `Today ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
    : date.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })
}
