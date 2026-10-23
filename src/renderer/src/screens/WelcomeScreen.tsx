import type { UserType } from '../../../shared/api'

/** First start: who uses the app. Manual testers get plain language; the technical mode comes later. */
export default function WelcomeScreen({ onChosen }: { onChosen(type: UserType): void }) {
  async function choose(type: UserType): Promise<void> {
    await window.api.setUserType(type)
    onChosen(type)
  }

  return (
    <section className="narrow welcome">
      <h1>Welcome to QA-STE100-Studio</h1>
      <p className="lead">
        Build automated tests by using your application and talking to Claude. When a test is strong, the app turns it
        into your team's automation framework.
      </p>
      <h2>Who are you?</h2>
      <div className="choices">
        <button className="choice" onClick={() => choose('manual')}>
          <span className="choice-title">Manual tester</span>
          <span className="choice-text">You test the application by hand and don't write code. The app does the technical part.</span>
        </button>
        <button className="choice" onClick={() => choose('technical')}>
          <span className="badge">Coming later</span>
          <span className="choice-title">Technical user</span>
          <span className="choice-text">
            You write automation code. For now you get the same app; a technical mode with code and framework details comes later.
          </span>
        </button>
      </div>
    </section>
  )
}
