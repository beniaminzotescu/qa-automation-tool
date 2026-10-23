import { useEffect, useState, type FormEvent } from 'react'
import type { KnowledgeBase } from '../../../shared/api'

/**
 * The knowledge base: documentation of the application under test, so the assistant has full
 * context. Files are copied into the app; links are read when needed.
 */
export default function KnowledgeScreen({ projectId }: { projectId: string }) {
  const [knowledge, setKnowledge] = useState<KnowledgeBase | null>(null)
  const [url, setUrl] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    window.api.getKnowledge(projectId).then(setKnowledge)
  }, [projectId])

  async function addLink(event: FormEvent): Promise<void> {
    event.preventDefault()
    setError(null)
    const result = await window.api.addKnowledgeLink(projectId, url, note)
    if (!result.ok) {
      setError(result.message)
      return
    }
    setKnowledge(result.knowledge)
    setUrl('')
    setNote('')
  }

  async function remove(id: string, name: string): Promise<void> {
    if (window.confirm(`Remove "${name}" from the knowledge base?`)) setKnowledge(await window.api.removeKnowledgeItem(projectId, id))
  }

  if (!knowledge) return null

  return (
    <section className="narrow">
      <h1>Knowledge base</h1>
      <p className="lead">
        Documentation of the application you test: user guides, specifications, user stories, help pages. The
        assistant reads it before planning a test, so it knows how the application should work.
      </p>

      <div className="card">
        <div className="card-header">
          <h2>Files</h2>
          <button className="button primary small" onClick={async () => setKnowledge(await window.api.addKnowledgeFiles(projectId))}>
            Add files…
          </button>
        </div>
        <p className="small muted">PDF, Word (.docx), Excel (.xlsx), Markdown, text and images can be read.</p>
        {knowledge.files.length === 0 ? (
          <p className="muted">No files yet.</p>
        ) : (
          <ul className="knowledge-list">
            {knowledge.files.map((file) => (
              <li key={file.id}>
                <div className="knowledge-main">
                  <span className="knowledge-name">{file.name}</span>
                  <span className="small muted"> · {formatSize(file.size)}</span>
                  {!file.readable && <span className="knowledge-warning"> Save as .docx, .xlsx or PDF so it can be read</span>}
                </div>
                <NoteField
                  value={file.note}
                  onSave={async (value) => setKnowledge(await window.api.updateKnowledgeNote(projectId, file.id, value))}
                />
                <button className="button link small danger" onClick={() => remove(file.id, file.name)}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card">
        <h2>Links</h2>
        <p className="small muted">
          Pages the assistant can open. Pages that need a login (an internal wiki, for example) can't be read: save
          them as PDF and add them as files.
        </p>
        {knowledge.links.length > 0 && (
          <ul className="knowledge-list">
            {knowledge.links.map((link) => (
              <li key={link.id}>
                <div className="knowledge-main">
                  <a href={link.url} target="_blank" rel="noreferrer" className="knowledge-name">
                    {link.url}
                  </a>
                </div>
                <NoteField
                  value={link.note}
                  onSave={async (value) => setKnowledge(await window.api.updateKnowledgeNote(projectId, link.id, value))}
                />
                <button className="button link small danger" onClick={() => remove(link.id, link.url)}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
        <form className="form knowledge-add" onSubmit={addLink}>
          <div className="row">
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" spellCheck={false} />
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="What is it? (optional)" />
            <button className="button primary" type="submit" disabled={!url.trim()}>
              Add link
            </button>
          </div>
          {error && <p className="message error">{error}</p>}
        </form>
      </div>
    </section>
  )
}

/** A short note on what a file or link is; saved when the field loses focus. */
function NoteField({ value, onSave }: { value: string; onSave(value: string): void }) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  return (
    <input
      className="knowledge-note"
      value={draft}
      placeholder="What is it? For example: user guide for the orders page"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft !== value && onSave(draft)}
    />
  )
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
