import { useRef, type JSX } from 'react'
import type { PageReadProgress, PageReadResult } from '@shared/ipc'
import { Icon } from '../components/Icon'
import { Button, Panel } from '../ui'
import { readMethodLabel } from './labels'
import { formatDuration, formatReadStamp } from './model'

export function FailedRead({
  result,
  busy,
  phases,
  onAgain,
  onJina,
  onFile
}: {
  result: PageReadResult
  busy: boolean
  phases: readonly PageReadProgress[]
  onAgain: () => void
  onJina: () => void
  onFile: (file: File | undefined) => void
}): JSX.Element {
  const fileInput = useRef<HTMLInputElement>(null)
  return (
    <Panel label="Read status">
      <div className="ps-card" role="status">
        <p className="ps-warn">
          <Icon name="warning" />
          <span>{result.message}</span>
        </p>
        {result.nextStep ? <p>{result.nextStep}</p> : null}
        <p className="rd-faint">
          Read {formatReadStamp(result.fetchedAt)} · {readMethodLabel(result.method)} ·{' '}
          {formatDuration(result.durationMs)}
        </p>
        {busy ? <ProgressList phases={phases} /> : null}
        <div className="ps-row">
          <Button variant="ghost" disabled={busy} onClick={onJina}>
            Read with the backup reader instead
          </Button>
          <Button disabled={busy} onClick={onAgain}>
            Read again
          </Button>
          <Button disabled={busy} onClick={() => fileInput.current?.click()}>
            Supply a file
          </Button>
          <input
            ref={fileInput}
            className="sr-only"
            type="file"
            accept=".html,.htm,.txt,.md,text/html,text/plain"
            tabIndex={-1}
            aria-hidden="true"
            disabled={busy}
            onChange={(event) => onFile(event.target.files?.[0])}
          />
        </div>
      </div>
    </Panel>
  )
}

export function ProgressList({ phases }: { phases: readonly PageReadProgress[] }): JSX.Element {
  return (
    <ol aria-label="Read progress">
      {phases.map((phase, index) => (
        <li key={`${phase.phase}-${phase.state}-${index}`}>
          {phase.detail}
          {phase.nextStep ? ` ${phase.nextStep}` : ''}
        </li>
      ))}
    </ol>
  )
}
