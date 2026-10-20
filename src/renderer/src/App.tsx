import { useCallback, useEffect, useState } from 'react'
import type { Account, AiSettings, ClaudeCodeStatus, Project, UserType } from '../../shared/api'
import SettingsScreen from './screens/SettingsScreen'
import PreparingScreen from './screens/PreparingScreen'
import AccountScreen from './screens/AccountScreen'
import AdminScreen from './screens/AdminScreen'
import RepositoryScreen from './screens/RepositoryScreen'
import KnowledgeScreen from './screens/KnowledgeScreen'
import StudioScreen from './screens/StudioScreen'
import OnboardingScreen from './screens/OnboardingScreen'
import UpdateBar from './components/UpdateBar'

// The user's path: who are you → connect to Claude → preparing (automatic) → your environment
// → the Studio. The framework itself is never shown; the QA team uses the Admin screen.

type Screen = 'tests' | 'account' | 'knowledge' | 'repository' | 'settings' | 'admin'

export default function App() {
  const [screen, setScreen] = useState<Screen>('tests')
  const [ai, setAi] = useState<AiSettings | null>(null)
  // null while a check is running.
  const [claudeCode, setClaudeCode] = useState<ClaudeCodeStatus | null>(null)
  const [project, setProject] = useState<Project | null | undefined>(undefined)
  const [account, setAccount] = useState<Account | null | undefined>(undefined)
  const [userType, setUserType] = useState<UserType | null | undefined>(undefined)
  const [onboardingDone, setOnboardingDone] = useState<boolean | undefined>(undefined)

  const recheckClaudeCode = useCallback(async () => {
    setClaudeCode(null)
    const status = await window.api.checkClaudeCode()
    setClaudeCode(status)
    return status
  }, [])

  const reloadProject = useCallback(async () => setProject((await window.api.getPrepareStatus()).project), [])
  const reloadAccount = useCallback(async () => setAccount(await window.api.getAccount()), [])

  useEffect(() => {
    reloadProject()
    reloadAccount()
    window.api.getUserType().then(setUserType)
    window.api.getOnboardingDone().then(setOnboardingDone)
    Promise.all([window.api.getAiSettings(), recheckClaudeCode()]).then(([settings, status]) => {
      setAi(settings)
      if (!isReady(settings, status)) setScreen('settings')
    })
  }, [recheckClaudeCode, reloadProject, reloadAccount])

  if (!ai || project === undefined || account === undefined || userType === undefined || onboardingDone === undefined) {
    return <div className="loading">Loading…</div>
  }

  const claudeReady = isReady(ai, claudeCode)

  function renderTests() {
    if (!claudeReady) {
      return (
        <div className="card narrow">
          <h2>Connect the app to Claude first</h2>
          <button className="button primary" onClick={() => setScreen('settings')}>
            Open settings
          </button>
        </div>
      )
    }
    if (!project) return <PreparingScreen onReady={reloadProject} onOpenRepository={() => setScreen('repository')} />
    if (!account) return <AccountScreen onSaved={reloadAccount} />
    return <StudioScreen project={project} />
  }

  if (!onboardingDone) {
    return (
      <div className="app">
        <header className="topbar">
          <span className="brand">QA-ASD-STE100</span>
        </header>
        <main className="content onboarding-page">
          <OnboardingScreen
            userType={userType}
            ai={ai}
            claudeCode={claudeCode}
            claudeReady={claudeReady}
            project={project}
            account={account}
            onUserType={setUserType}
            onAiChange={setAi}
            onRecheckClaudeCode={recheckClaudeCode}
            onProjectChanged={reloadProject}
            onAccountSaved={reloadAccount}
            onFinished={() => {
              setOnboardingDone(true)
              setScreen('tests')
            }}
          />
        </main>
      </div>
    )
  }

  return (
    <div className="app">
      <header className="topbar">
        <button className="brand" onClick={() => setScreen('tests')}>
          QA-ASD-STE100
        </button>
        <UpdateBar />
        <nav>
          <NavLink current={screen} screen="tests" onSelect={setScreen}>
            Studio
          </NavLink>
          {account && (
            <NavLink current={screen} screen="account" onSelect={setScreen}>
              Your environment
            </NavLink>
          )}
          {project && (
            <NavLink current={screen} screen="knowledge" onSelect={setScreen}>
              Knowledge base
            </NavLink>
          )}
          <NavLink current={screen} screen="repository" onSelect={setScreen}>
            Repository
          </NavLink>
          <NavLink current={screen} screen="settings" onSelect={setScreen}>
            Settings
          </NavLink>
        </nav>
      </header>
      <main className={screen === 'tests' && project && account && claudeReady ? 'content studio-page' : 'content'}>
        {screen === 'tests' && renderTests()}
        {screen === 'account' && (
          <AccountScreen
            onSaved={async () => {
              await reloadAccount()
              setScreen('tests')
            }}
          />
        )}
        {screen === 'settings' && (
          <SettingsScreen
            ai={ai}
            claudeCode={claudeCode}
            ready={claudeReady}
            onAiChange={setAi}
            onRecheckClaudeCode={recheckClaudeCode}
            onDone={() => setScreen('tests')}
            onOpenAdmin={() => setScreen('admin')}
          />
        )}
        {screen === 'repository' && <RepositoryScreen onRepoChanged={reloadProject} />}
        {screen === 'knowledge' && project && <KnowledgeScreen projectId={project.id} />}
        {screen === 'admin' && <AdminScreen project={project} />}
      </main>
    </div>
  )
}

function NavLink({
  current,
  screen,
  onSelect,
  children
}: {
  current: Screen
  screen: Screen
  onSelect(screen: Screen): void
  children: string
}) {
  return (
    <button className={current === screen ? 'nav-link active' : 'nav-link'} onClick={() => onSelect(screen)}>
      {children}
    </button>
  )
}

function isReady(ai: AiSettings, claudeCode: ClaudeCodeStatus | null): boolean {
  return ai.mode === 'claude-code' ? claudeCode?.state === 'ready' : ai.apiKey.hasKey
}
