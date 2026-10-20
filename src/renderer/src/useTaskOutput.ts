import { useCallback, useEffect, useRef, useState } from 'react'

/** Collects the streamed output of one long-running task at a time. */
export function useTaskOutput() {
  const [output, setOutput] = useState('')
  const taskId = useRef<string | null>(null)

  useEffect(
    () =>
      window.api.onTaskOutput((event) => {
        if (event.taskId === taskId.current) setOutput((previous) => previous + event.chunk)
      }),
    []
  )

  /** Starts collecting for a new task and returns its id, to pass to the API call. */
  const start = useCallback(() => {
    taskId.current = crypto.randomUUID()
    setOutput('')
    return taskId.current
  }, [])

  return { output, start }
}
