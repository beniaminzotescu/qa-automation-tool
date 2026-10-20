import { useEffect, useState } from 'react'
import type { Account, AiSettings, ClaudeCodeStatus, Project, RepoConfig, SshKeyStatus, UserType } from '../../../shared/api'
import WelcomeScreen from './WelcomeScreen'
import SettingsScreen from './SettingsScreen'
import PreparingScreen from './PreparingScreen'
import AccountScreen from './AccountScreen'
import KnowledgeScreen from './KnowledgeScreen'
import { CloneCard, LocalFolderCard, SshKeyCard } from './RepositoryScreen'

// First-time setup, one step at a time. Afterwards everything stays reachable from the top bar.

const STEPS = ['you', 'claude', 'framework', 'preparing', 'environment', 'docs'] as const
type Step = (typeof STEPS)[number]

const STEP_LABELS: Record<Step, string> = {
  you: 'You',
  claude: 'Claude',
  framework: 'Framework',
  preparing: 'Getting ready',
  environment: 'Your environment',
  docs: 'Documentation'
}

interface Props {
  userType: UserType | null
  ai: AiSettings
  claudeCode: ClaudeCodeStatus | null
  claudeReady: boolean
  project: Project | null
  account: Account | null
  onUserType(type: UserType): void
  onAiChange(ai: AiSettings): void
  onRecheckClaudeCode(): void
  onProjectChanged(): Promise<void>
  onAccountSaved(): Promise<void>
  onFinished(): void
}

export default function OnboardingScreen(props: Props) {
  const { userType, claudeReady, project, account } = props
  // Start where the setup stopped, for example after closing the app halfway.
  const [step, setStep] = useState<Step>(() =>
    !userType ? 'you' : !claudeReady ? 'claude' : !project ? 'framework' : !account ? 'environment' : 'docs'
  )
  const next = (from: Step): void => setStep(STEPS[STEPS.indexOf(from) + 1])

  async function finish(): Promise<void> {
    await window.api.setOnboardingDone(true)
    props.onFinished()
  }

  return (
    <div className="onboarding">
      <ol className="onboarding-steps">
        {STEPS.map((s, index) => (
          <li key={s} className={index < STEPS.indexOf(step) ? 'done' : s === step ? 'current' : ''}>
            <span className="onboarding-number">{index < STEPS.indexOf(step) ? '✓' : index + 1}</span>
            {STEP_LABELS[s]}
          </li>
        ))}
      </ol>

      {step === 'you' && (
        <WelcomeScreen
          onChosen={(type) => {
            props.onUserType(type)
            // Claude may already be connected (Claude Code signed in): then go straight on.
            setStep(claudeReady ? 'framework' : 'claude')
          }}
        />
      )}

      {step === 'claude' && (
        <div className="narrow">
          <SettingsScreen
            ai={props.ai}
            claudeCode={props.claudeCode}
            ready={claudeReady}
            onAiChange={props.onAiChange}
            onRecheckClaudeCode={props.onRecheckClaudeCode}
            onDone={() => next('claude')}
            onOpenAdmin={null}
            title="Connect to Claude"
          />
        </div>
      )}

      {step === 'framework' && <FrameworkStep onDone={() => next('framework')} />}

      {step === 'preparing' && (
        <PreparingScreen
          onReady={async () => {
            await props.onProjectChanged()
            setStep('environment')
          }}
          onOpenRepository={() => setStep('framework')}
        />
      )}

      {step === 'environment' && (
        <AccountScreen
          onSaved={async () => {
            await props.onAccountSaved()
            next('environment')
          }}
        />
      )}

      {step === 'docs' && project && (
        <>
          <KnowledgeScreen projectId={project.id} />
          <div className="narrow onboarding-finish">
            <p className="small muted">You can add documentation any time under Knowledge base.</p>
            <div className="actions">
              <button className="button primary" onClick={finish}>
                Finish and open the Studio
              </button>
              <button className="button secondary" onClick={finish}>
                Skip for now
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

/** Clone a repository (with the SSH key) or use a folder on this computer. */
function FrameworkStep({ onDone }: { onDone(): void }) {
  const [choice, setChoice] = useState<'clone' | 'folder' | null>(null)
  const [config, setConfig] = useState<RepoConfig | null>(null)
  const [key, setKey] = useState<SshKeyStatus | null>(null)

  useEffect(() => {
    window.api.getRepoConfig().then(setConfig)
    window.api.getSshKey().then(setKey)
  }, [])

  if (!config || !key) return null

  return (
    <section className="narrow">
      <h1>Your team's framework</h1>
      <p className="lead">
        The automation framework your tests are translated into. The app learns the team's standards from it and never
        changes your files.
      </p>

      <div className="choices">
        <button className={choice === 'clone' ? 'choice selected' : 'choice'} onClick={() => setChoice('clone')}>
          <span className="choice-title">Clone a repository</span>
          <span className="choice-text">Get it from Azure DevOps or GitHub. The app sets up your SSH key.</span>
        </button>
        <button className={choice === 'folder' ? 'choice selected' : 'choice'} onClick={() => setChoice('folder')}>
          <span className="choice-title">Use a folder on this computer</span>
          <span className="choice-text">You already cloned it, for example with your own git tools.</span>
        </button>
      </div>

      {choice === 'clone' && (
        <>
          <SshKeyCard status={key} onChange={setKey} />
          <CloneCard config={config} hasKey={key.hasKey} onCloned={onDone} />
        </>
      )}
      {choice === 'folder' && <LocalFolderCard config={config} onChanged={onDone} />}
    </section>
  )
}
