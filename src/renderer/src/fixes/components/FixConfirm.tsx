import { useEffect, useRef, type JSX } from 'react'
import type { ProjectFix } from '@shared/ipc'
import { pluralize } from '@shared/pluralize'
import { Button } from '../../ui'
import { costLine, fixName } from '../model'

export type FixAction = { kind: 'run' | 'delete'; item: ProjectFix }

/**
 * The confirm line for a row action, the same inline pattern as the fix card's delete:
 * "Run follow-up now" says what it checks and the searches it uses before anything
 * runs; "Delete" says the planned follow-up goes too. Focus moves to it when it opens.
 */
export function FixConfirm({
  action,
  busy,
  onConfirm,
  onCancel
}: {
  action: FixAction
  busy: boolean
  onConfirm: () => void
  onCancel: () => void
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('button')?.focus()
  }, [action])
  const { fix } = action.item
  const run = action.kind === 'run'
  const label = run ? `Run the follow-up for Fix ${fix.number}?` : `Delete Fix ${fix.number}?`
  return (
    <div ref={ref} className="fxp-confirm" role="group" aria-label={label}>
      <p>
        <strong>{label}</strong>{' '}
        {run
          ? `${fixName(fix)}. Checks ${pluralize(fix.promptIds.length, 'targeted question')} in ${pluralize(fix.marketIds.length, 'market')} now, as a partial check. ${costLine(action.item)}.`
          : `${fixName(fix)}. Its planned follow-up is dropped too.`}
      </p>
      <div className="fxp-confirm-actions">
        <Button variant={run ? 'primary' : 'danger'} size="sm" disabled={busy} onClick={onConfirm}>
          {run ? 'Run follow-up' : 'Delete fix'}
        </Button>
        <Button size="sm" onClick={onCancel}>
          {run ? 'Cancel' : 'Keep it'}
        </Button>
      </div>
    </div>
  )
}
