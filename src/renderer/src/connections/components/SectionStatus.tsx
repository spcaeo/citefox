import type { JSX } from 'react'
import type { SectionMessage } from '../hooks/useKeyActions'

/** One status panel per section: the latest test, save, or error, read out politely. */
export function SectionStatus({ message }: { message: SectionMessage | null }): JSX.Element | null {
  if (message === null) return null
  return (
    <div
      className={message.tone === 'warn' ? 'panel-warn' : 'panel-ok'}
      role={message.alert ? 'alert' : 'status'}
      aria-live="polite"
    >
      <p>{message.text}</p>
      {message.note ? <p>{message.note}</p> : null}
    </div>
  )
}
