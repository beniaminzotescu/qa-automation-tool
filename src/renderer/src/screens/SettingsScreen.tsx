import type { AiMode, AiSettings, ClaudeCodeStatus } from '../../../shared/api'
import ApiKeyPanel from '../components/ApiKeyPanel'
import ClaudeCodePanel from '../components/ClaudeCodePanel'

interface Props {
  ai: AiSettings
  claudeCode: ClaudeCodeStatus | null
  ready: boolean
  onAiChange(ai: AiSettings): void
  onRecheckClaudeCode(): void
  onDone(): void
  /** null hides the Admin link (during the first-time setup). */
  onOpenAdmin: (() => void) | null
  title?: string
}

const MODES: { mode: AiMode; title: string; text: string }[] = [
  {
    mode: 'claude-code',
    title: 'Claude Code on this computer',
    text: 'You already have Claude Code (Pro, Max, Team or Enterprise). Usage counts against your own plan.'
  },
  {
    mode: 'api-key',
    title: 'Claude API key',
    text: 'You have a key from the Claude Console, from your admin or your own. Pay per use.'
  }
]

export default function SettingsScreen({ ai, claudeCode, ready, onAiChange, onRecheckClaudeCode, onDone, onOpenAdmin, title = 'Settings' }: Props) {
  async function chooseMode(mode: AiMode): Promise<void> {
    if (mode !== ai.mode) onAiChange(await window.api.setAiMode(mode))
  }

  return (
    <section className="settings">
      <h1>{title}</h1>

      <div className="card">
        <h2>Connect to Claude</h2>
        <p>The app uses Claude to write and fix your tests. Choose how to connect.</p>

        <div className="mode-options" role="radiogroup" aria-label="How to connect to Claude">
          {MODES.map(({ mode, title, text }) => (
            <label key={mode} className={ai.mode === mode ? 'mode-option selected' : 'mode-option'}>
              <input
                type="radio"
                name="ai-mode"
                checked={ai.mode === mode}
                onChange={() => chooseMode(mode)}
              />
              <span>
                <span className="mode-title">{title}</span>
                <span className="mode-text">{text}</span>
              </span>
            </label>
          ))}
        </div>

        {ai.mode === 'claude-code' ? (
          <ClaudeCodePanel status={claudeCode} onRecheck={onRecheckClaudeCode} />
        ) : (
          <ApiKeyPanel
            status={ai.apiKey}
            onStatusChange={(apiKey) => onAiChange({ ...ai, apiKey })}
          />
        )}
      </div>

      {ready && (
        <button className="button primary" onClick={onDone}>
          Continue
        </button>
      )}

      {onOpenAdmin && (
        <div className="admin-link">
          <button className="button link small muted" onClick={onOpenAdmin}>
            Admin (QA team)
          </button>
        </div>
      )}
    </section>
  )
}
