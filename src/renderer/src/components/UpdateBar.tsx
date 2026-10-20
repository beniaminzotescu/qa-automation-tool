import { useEffect, useState } from 'react'
import type { UpdateStatus } from '../../../shared/api'

/** In the top bar: the new version's download progress, then "Restart to update". */
export default function UpdateBar() {
  const [status, setStatus] = useState<UpdateStatus | null>(null)

  useEffect(() => {
    window.api.getUpdateStatus().then(setStatus)
    return window.api.onUpdateStatus(setStatus)
  }, [])

  if (!status || status.state === 'idle') return null

  if (status.state === 'downloading') {
    return (
      <div className="update-bar" title={`Version ${status.version ?? ''}`}>
        <span>Downloading update… {status.percent}%</span>
        <span className="update-progress">
          <span style={{ width: `${status.percent}%` }} />
        </span>
      </div>
    )
  }

  return (
    <div className="update-bar ready">
      <span>Version {status.version} is ready</span>
      <button className="button primary small" onClick={() => window.api.restartToUpdate()}>
        Restart to update
      </button>
    </div>
  )
}
