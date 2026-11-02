import { useState, type JSX, type KeyboardEvent } from 'react'
import type { VideoBrief } from '@shared/domain'
import { useDialog } from '../../components/useDialog'
import { Button, IconButton } from '../../ui'
import { teleprompterLine } from '../utils/model'

/**
 * FR-18.5 "Record it yourself": the script one line at a time, in large type,
 * as a full-screen view over everything (not a drawer: nothing else is needed
 * while recording). Escape or Close leaves it.
 */
export function Teleprompter({
  brief,
  onClose
}: {
  brief: VideoBrief
  onClose: () => void
}): JSX.Element {
  const [line, setLine] = useState(0)
  const dialog = useDialog<HTMLDivElement>({ onClose })
  const lines = brief.script
  const current = lines[line]

  function onKey(event: KeyboardEvent<HTMLDivElement>): void {
    const target = event.target as HTMLElement
    if (target.tagName === 'BUTTON' && (event.key === ' ' || event.key === 'Enter')) return
    const next = teleprompterLine(line, lines.length, event.key)
    if (next === null) return
    event.preventDefault()
    setLine(next)
  }

  return (
    <div
      className="yt-prompter-scrim"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        ref={dialog}
        className="yt-prompter"
        role="dialog"
        aria-modal="true"
        aria-labelledby="yt-prompter-h"
        onKeyDown={onKey}
      >
        <div className="yt-prompter-head">
          <div className="yt-prompter-titles">
            <p className="yt-prompter-eyebrow">Record it yourself · {current?.at ?? ''}</p>
            <h2 id="yt-prompter-h">
              Teleprompter · line {line + 1} of {lines.length}
            </h2>
          </div>
          <IconButton icon="x" label="Close the teleprompter" onClick={onClose} />
        </div>
        <ol className="yt-prompter-lines" aria-live="polite">
          {lines.map((item, index) => (
            <li
              key={`${item.at}-${index}`}
              className={index === line ? 'now' : index < line ? 'done' : undefined}
              aria-current={index === line ? 'step' : undefined}
            >
              {item.text}
            </li>
          ))}
        </ol>
        <div className="yt-prompter-foot">
          <p className="yt-muted yt-small">Arrow keys move between lines. Escape closes.</p>
          <div className="yt-row">
            <Button onClick={onClose}>Close</Button>
            <Button
              disabled={line === 0}
              onClick={() => setLine((value) => Math.max(0, value - 1))}
            >
              Previous line
            </Button>
            <Button
              variant="primary"
              data-autofocus
              disabled={line >= lines.length - 1}
              onClick={() => setLine((value) => Math.min(lines.length - 1, value + 1))}
            >
              Next line
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
