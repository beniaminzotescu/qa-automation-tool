import { useState } from 'react'

/** A response body as a folding tree: objects and arrays open and close, values are colored. */
export default function JsonTree({ value }: { value: unknown }) {
  return (
    <div className="json-tree">
      <Node name={null} value={value} depth={0} />
    </div>
  )
}

function Node({ name, value, depth }: { name: string | null; value: unknown; depth: number }) {
  // The first levels start open; deeper ones closed, so big responses stay readable.
  const [open, setOpen] = useState(depth < 2)
  const label = name !== null ? <span className="json-key">{name}</span> : null

  if (value !== null && typeof value === 'object') {
    const entries = Array.isArray(value) ? value.map((v, i) => [String(i), v] as const) : Object.entries(value)
    const summary = Array.isArray(value) ? `[${entries.length}]` : `{${entries.length}}`
    return (
      <div className="json-node">
        <button className="json-toggle" onClick={() => setOpen(!open)}>
          <span className="json-arrow">{open ? '▾' : '▸'}</span>
          {label}
          {label && ': '}
          <span className="json-summary">{Array.isArray(value) ? `list of ${entries.length}` : summary}</span>
        </button>
        {open && (
          <div className="json-children">
            {entries.map(([key, child]) => (
              <Node key={key} name={key} value={child} depth={depth + 1} />
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="json-leaf">
      {label}
      {label && ': '}
      <span className={`json-value ${value === null ? 'null' : typeof value}`}>
        {typeof value === 'string' ? `"${value}"` : String(value)}
      </span>
    </div>
  )
}
