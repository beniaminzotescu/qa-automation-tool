import { app, BrowserWindow } from 'electron'
import { randomUUID } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { IPC, type KnowledgeBase, type KnowledgeFile, type KnowledgeLink } from '../shared/api'
import type { PromptKnowledge } from './chatPrompt'
import { toText } from './documents'

// The knowledge base: documentation of the application under test (files and links), added by
// the team so the assistant has full context. One per framework connection, in the app's data folder.

export const knowledgeDir = (projectId: string): string => join(app.getPath('userData'), 'knowledge', projectId)
const filesDir = (projectId: string): string => join(knowledgeDir(projectId), 'files')
const indexFile = (projectId: string): string => join(knowledgeDir(projectId), 'index.json')

/** Files the assistant reads well. Others are kept, with a hint to convert them. */
const READABLE = new Set(['.pdf', '.md', '.markdown', '.txt', '.csv', '.json', '.yaml', '.yml', '.html', '.htm', '.xml', '.png', '.jpg', '.jpeg', '.gif', '.webp'])

export function getKnowledge(projectId: string): KnowledgeBase {
  try {
    const saved = JSON.parse(readFileSync(indexFile(projectId), 'utf8')) as KnowledgeBase
    return { files: saved.files.filter((f) => existsSync(f.path)), links: saved.links }
  } catch {
    return { files: [], links: [] }
  }
}

function save(projectId: string, knowledge: KnowledgeBase): KnowledgeBase {
  mkdirSync(knowledgeDir(projectId), { recursive: true })
  writeFileSync(indexFile(projectId), JSON.stringify(knowledge, null, 1))
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(IPC.knowledgeUpdate, { projectId, knowledge })
  }
  return knowledge
}

export async function addFiles(projectId: string, paths: string[]): Promise<KnowledgeBase> {
  const knowledge = getKnowledge(projectId)
  mkdirSync(filesDir(projectId), { recursive: true })
  for (const source of paths) {
    const id = randomUUID()
    // Keep the original name readable; the id avoids clashes between files with the same name.
    const target = join(filesDir(projectId), `${id.slice(0, 8)}-${basename(source)}`)
    copyFileSync(source, target)
    // Word and Excel get a text copy next to them: that is what the assistant reads.
    const textPath = await textCopy(target)
    const file: KnowledgeFile = {
      id,
      name: basename(source),
      note: '',
      path: target,
      textPath,
      size: statSync(target).size,
      readable: textPath !== null || READABLE.has(extname(source).toLowerCase()),
      addedAt: new Date().toISOString()
    }
    knowledge.files.push(file)
  }
  return save(projectId, knowledge)
}

export function addLink(projectId: string, url: string, note: string): { ok: true; knowledge: KnowledgeBase } | { ok: false; message: string } {
  const clean = url.trim()
  try {
    const parsed = new URL(clean)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error()
  } catch {
    return { ok: false, message: 'The link must be a web address starting with https://' }
  }
  const knowledge = getKnowledge(projectId)
  const link: KnowledgeLink = { id: randomUUID(), url: clean, note: note.trim(), addedAt: new Date().toISOString() }
  knowledge.links.push(link)
  return { ok: true, knowledge: save(projectId, knowledge) }
}

export function updateNote(projectId: string, id: string, note: string): KnowledgeBase {
  const knowledge = getKnowledge(projectId)
  for (const item of [...knowledge.files, ...knowledge.links]) if (item.id === id) item.note = note.trim()
  return save(projectId, knowledge)
}

export function removeItem(projectId: string, id: string): KnowledgeBase {
  const knowledge = getKnowledge(projectId)
  const file = knowledge.files.find((f) => f.id === id)
  if (file) rmSync(file.path, { force: true })
  if (file?.textPath) rmSync(file.textPath, { force: true })
  return save(projectId, {
    files: knowledge.files.filter((f) => f.id !== id),
    links: knowledge.links.filter((l) => l.id !== id)
  })
}

/** Word and Excel files (not text already) as `<file>.txt` next to them, or null. */
async function textCopy(path: string): Promise<string | null> {
  const ext = extname(path).toLowerCase()
  if (ext !== '.docx' && ext !== '.xlsx') return null
  try {
    const text = await toText(path)
    if (!text) return null
    writeFileSync(`${path}.txt`, text)
    return `${path}.txt`
  } catch {
    // A damaged or protected file: kept as it is, marked as not readable.
    return null
  }
}

/** What the assistant is told about the knowledge base. */
export function knowledgeForPrompt(projectId: string): PromptKnowledge {
  const knowledge = getKnowledge(projectId)
  return {
    filesDir: knowledge.files.length ? filesDir(projectId) : null,
    files: knowledge.files.map((f) => ({ name: basename(f.textPath ?? f.path), note: f.note })),
    links: knowledge.links.map((l) => ({ url: l.url, note: l.note }))
  }
}
