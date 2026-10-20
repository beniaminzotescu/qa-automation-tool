import { useEffect, useRef } from 'react'

/** Scrolling box with a command's output, kept scrolled to the newest line. */
export default function TaskLog({ text }: { text: string }) {
  const ref = useRef<HTMLPreElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight
  }, [text])
  if (!text) return null
  return (
    <pre className="task-log" ref={ref}>
      {text}
    </pre>
  )
}
