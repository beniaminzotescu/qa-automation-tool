import type { FrameworkProfile } from '../../../shared/api'

export default function FrameworkSummary({ profile }: { profile: FrameworkProfile }) {
  const specFiles = profile.suites.reduce((sum, suite) => sum + suite.specFiles, 0)
  const rules = [
    profile.teamRules.claudeMd && 'CLAUDE.md',
    profile.teamRules.guidelines && 'QA guidelines',
    ...profile.teamRules.skills.map((skill) => `/${skill}`)
  ].filter(Boolean)

  return (
    <div className="summary">
      <div className="facts">
        <Fact value={specFiles} label="test files" />
        <Fact value={profile.suites.length} label="suites" />
        <Fact value={profile.pageObjects} label="page objects" />
        <Fact value={profile.apiClients} label="API clients" />
      </div>

      <dl className="details">
        <dt>Suites</dt>
        <dd>
          {profile.suites.length === 0
            ? 'None found'
            : profile.suites.map((suite) => (
                <span key={suite.folder} className="chip">
                  {suite.folder.replace(/^tests\//, '')} · {suite.specFiles}
                </span>
              ))}
        </dd>

        <dt>Framework</dt>
        <dd>
          {profile.tools.length ? profile.tools.join(' + ') : 'Unknown tools'} · {LANGUAGES[profile.language]}
          {profile.playwrightVersion && <> · Playwright {profile.playwrightVersion}</>}
        </dd>

        <dt>Team rules for the assistant</dt>
        <dd>{rules.length > 0 ? rules.join(', ') : 'None found'}</dd>

        <dt>Repository</dt>
        <dd className="mono">{profile.git.remote ?? 'No remote'}</dd>
      </dl>
    </div>
  )
}

function Fact({ value, label }: { value: number; label: string }) {
  return (
    <div className="fact">
      <span className="fact-value">{value}</span>
      <span className="fact-label">{label}</span>
    </div>
  )
}

const LANGUAGES: Record<FrameworkProfile['language'], string> = {
  typescript: 'TypeScript',
  javascript: 'JavaScript',
  python: 'Python',
  other: 'Other language'
}
