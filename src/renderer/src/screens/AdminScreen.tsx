import type { Project } from '../../../shared/api'
import SetupTab from '../components/SetupTab'

/** For technical people: the setup checks and what the app found in the framework. */
export default function AdminScreen({ project }: { project: Project | null }) {
  return (
    <section>
      <h1>Admin</h1>
      <p className="lead">The technical setup of the framework copy. Users don't need this screen.</p>
      {project ? (
        <SetupTab project={project} />
      ) : (
        <div className="card">
          <p>No framework is connected yet. Choose one under Repository.</p>
        </div>
      )}
    </section>
  )
}
