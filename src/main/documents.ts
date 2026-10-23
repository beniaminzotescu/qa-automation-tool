import { readFileSync } from 'node:fs'
import { extname } from 'node:path'
import mammoth from 'mammoth'
import readXlsxFile from 'read-excel-file/node'

// Word and Excel files as plain text the assistant can read (its file tools read text, PDFs and
// images, not .docx or .xlsx). Tables keep their rows and columns: test cases often live in tables.

/** Files turned into text. PDFs and images need no conversion: the assistant reads them as they are. */
const CONVERTIBLE = new Set(['.docx', '.xlsx', '.csv', '.txt', '.md', '.markdown'])

export function canConvert(path: string): boolean {
  return CONVERTIBLE.has(extname(path).toLowerCase())
}

/** The file's content as text, or null when the format can't be read (e.g. old .doc / .xls). */
export async function toText(path: string): Promise<string | null> {
  const ext = extname(path).toLowerCase()
  if (ext === '.docx') return htmlToText((await mammoth.convertToHtml({ path })).value)
  if (ext === '.xlsx') return sheetsToText(await readXlsxFile(path))
  if (CONVERTIBLE.has(ext)) return readFileSync(path, 'utf8')
  return null
}

/** A spreadsheet cell: text, number, boolean, date or empty. */
type Cell = unknown

/** Each sheet as a heading and its rows as `| a | b |`; line breaks inside a cell become <br>. */
export function sheetsToText(sheets: { sheet: string; data: readonly (readonly Cell[])[] }[]): string {
  return sheets
    .map(({ sheet, data }) => {
      const rows = data
        .map((row) => row.map(cellText))
        .filter((cells) => cells.some((cell) => cell !== ''))
        .map((cells) => `| ${cells.join(' | ')} |`)
      return [`## Sheet: ${sheet}`, ...rows].join('\n')
    })
    .join('\n\n')
}

function cellText(cell: Cell): string {
  if (cell === null || cell === undefined) return ''
  const text = cell instanceof Date ? cell.toISOString().slice(0, 10) : String(cell)
  return text.trim().replace(/\r?\n/g, '<br>').replace(/\|/g, '/')
}

/** Word's HTML as text: headings, paragraphs and list items on their own lines, tables as rows. */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<br\s*\/?>/gi, '<br>')
      // Inside a table cell, paragraphs and list items stay in the cell, separated by <br>.
      .replace(/<(td|th)([^>]*)>([\s\S]*?)<\/\1>/gi, (_m, tag: string, attributes: string, inner: string) => {
        const flat = inner
          .replace(/<\/p>\s*<p[^>]*>/gi, '<br>')
          .replace(/<li[^>]*>/gi, '<br>- ')
          .replace(/<\/?(p|ul|ol|li)[^>]*>/gi, '')
          .replace(/^(<br>)+/, '')
        return `<${tag}${attributes}>${flat}</${tag}>`
      })
      .replace(/<h([1-6])[^>]*>/gi, (_m, level: string) => `\n${'#'.repeat(Number(level))} `)
      .replace(/<li[^>]*>/gi, '\n- ')
      .replace(/<tr[^>]*>/gi, '\n|')
      .replace(/<\/t[dh]>/gi, ' |')
      .replace(/<t[dh][^>]*>/gi, ' ')
      .replace(/<\/(p|h[1-6]|table|ul|ol)>/gi, '\n')
      .replace(/<(?!br>)[^>]+>/gi, '')
  )
    .replace(/<br>(\s*\|)/g, '$1')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
}
