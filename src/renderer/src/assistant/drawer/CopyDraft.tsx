import { useEffect, useState, type JSX } from 'react'
import { copyText } from '../../components/clipboard'
import { COPIED_MS, IconButton } from '../../ui'

/** A drafted text to review, with Copy (a tick for 1.5 s once copied). */
export function CopyDraft({ text, label }: { text: string; label: string }): JSX.Element {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  useEffect(() => {
    if (state === 'idle') return
    const timer = window.setTimeout(() => setState('idle'), COPIED_MS)
    return () => window.clearTimeout(timer)
  }, [state])
  return (
    <figure className="asst-draft">
      <figcaption className="asst-draft-head">
        <span>{label}</span>
        <IconButton
          size="sm"
          tip
          icon={state === 'copied' ? 'check' : 'copy'}
          label={
            state === 'copied'
              ? 'Copied'
              : state === 'failed'
                ? 'Copy failed'
                : `Copy ${label.toLowerCase()}`
          }
          data-state={state}
          onClick={() => void copyText(text).then((ok) => setState(ok ? 'copied' : 'failed'))}
        />
      </figcaption>
      <pre className="asst-draft-text">{text}</pre>
    </figure>
  )
}
