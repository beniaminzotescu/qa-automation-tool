import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { STAGES, type Chat, type ChatItem, type Project, type Stage } from '../../../../shared/api'
import { AssistantMessage, TestResultCard, WorkGroup } from './ChatCards'

const STAGE_LABELS: Record<Stage, string> = {
  understand: 'Understand',
  plan: 'Plan',
  explore: 'Explore the app',
  write: 'Write',
  check: 'Check',
  ready: 'Ready for review'
}

const EXAMPLES = [
  'Open the settings page and check that my user name is shown.',
  'Create a new item called "Test 1", save it, and check that it appears in the list.',
  'Search for something that does not exist and check that a "no results" message is shown.'
]

/** Items shown together: Claude's activities and screenshots between two messages form one "work" group. */
type Block = { type: 'item'; item: ChatItem; index: number } | { type: 'work'; items: ChatItem[]; key: string }

export default function ChatTab({ project }: { project: Project }) {
  const [chat, setChat] = useState<Chat | null | undefined>(undefined)
  const [draft, setDraft] = useState('')
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    window.api.getChat(project.id).then(setChat)
    return window.api.onChatUpdate((update) => {
      if (update.projectId === project.id) setChat(update.chat)
    })
  }, [project.id])

  // Follow new messages.
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' })
  }, [chat?.items.length, chat?.status])

  if (chat === undefined) return <div className="card">Loading…</div>

  const busy = chat?.status === 'preparing' || chat?.status === 'working'
  const items = chat?.items ?? []
  // Question and scenario buttons only work on Claude's latest message, before the user answered.
  const lastUser = findLastIndex(items, (i) => i.kind === 'user')
  const lastAssistant = findLastIndex(items, (i) => i.kind === 'assistant')
  const answerable = !busy && lastAssistant > lastUser

  async function send(text: string): Promise<void> {
    const message = text.trim()
    if (!message || busy) return
    setDraft('')
    await window.api.sendMessage(project.id, message)
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void send(draft)
    }
  }

  async function startOver(): Promise<void> {
    const confirmed = window.confirm(
      'Start a new conversation?\n\nThe current conversation is cleared. Your kept tests stay.'
    )
    if (confirmed) await window.api.discardChat(project.id)
  }

  return (
    <div className="chat">
      <div className="chat-top">
        <StageBar stage={chat?.stage ?? 'understand'} />
        {chat && (
          <button className="button link" onClick={startOver} disabled={busy}>
            New conversation
          </button>
        )}
      </div>

      <div className="chat-list" ref={listRef}>
        {items.length === 0 && (
          <div className="chat-empty">
            <h2>Describe the test you need</h2>
            <p>
              Write what should happen in the application, in your own words. The assistant works in the browser next to
              this chat, so you can watch it. It asks if something is unclear and shows you the plan first.
            </p>
            <div className="examples">
              {EXAMPLES.map((example) => (
                <button key={example} className="example" onClick={() => setDraft(example)}>
                  {example}
                </button>
              ))}
            </div>
          </div>
        )}

        {groupItems(items).map((block, blockIndex, blocks) => {
          if (block.type === 'work') {
            const isLast = blockIndex === blocks.length - 1
            return <WorkGroup key={block.key} projectId={project.id} items={block.items} active={isLast && busy} />
          }
          const { item, index } = block
          switch (item.kind) {
            case 'user':
              return (
                <div key={item.id} className="bubble user">
                  {item.text}
                </div>
              )
            case 'assistant':
              return (
                <AssistantMessage
                  key={item.id}
                  text={item.text}
                  answerable={answerable && index === lastAssistant}
                  onAnswer={send}
                  onChange={() => inputRef.current?.focus()}
                />
              )
            case 'test-result':
              return <TestResultCard key={item.id} projectId={project.id} report={item.report} />
            case 'notice':
              return (
                <div key={item.id} className={`chat-notice ${item.tone}`}>
                  {item.text}
                </div>
              )
            default:
              return null
          }
        })}

        {busy && !endsWithWork(items) && (
          <div className="thinking">
            <span className="spinner" /> {chat?.status === 'preparing' ? 'Getting ready…' : 'Working…'}
          </div>
        )}
      </div>

      <div className="chat-input">
        <textarea
          ref={inputRef}
          value={draft}
          placeholder={items.length === 0 ? 'Describe the test you need…' : 'Write your answer…'}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          rows={3}
          disabled={busy}
        />
        {busy ? (
          <button className="button secondary" onClick={() => window.api.stopChat(project.id)}>
            Stop
          </button>
        ) : (
          <button className="button primary" onClick={() => send(draft)} disabled={!draft.trim()}>
            Send
          </button>
        )}
      </div>
    </div>
  )
}

function StageBar({ stage }: { stage: Stage }) {
  const current = STAGES.indexOf(stage)
  return (
    <ol className="stages">
      {STAGES.map((s, index) => (
        <li key={s} className={index < current ? 'done' : index === current ? 'current' : ''}>
          {STAGE_LABELS[s]}
        </li>
      ))}
    </ol>
  )
}

function groupItems(items: ChatItem[]): Block[] {
  const blocks: Block[] = []
  items.forEach((item, index) => {
    if (item.kind === 'activity' || item.kind === 'screenshot') {
      const last = blocks[blocks.length - 1]
      if (last?.type === 'work') last.items.push(item)
      else blocks.push({ type: 'work', items: [item], key: item.id })
    } else {
      blocks.push({ type: 'item', item, index })
    }
  })
  return blocks
}

function endsWithWork(items: ChatItem[]): boolean {
  const last = items[items.length - 1]
  return last?.kind === 'activity' || last?.kind === 'screenshot'
}

function findLastIndex<T>(list: T[], predicate: (value: T) => boolean): number {
  for (let i = list.length - 1; i >= 0; i--) if (predicate(list[i])) return i
  return -1
}
