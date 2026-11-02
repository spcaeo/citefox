import { useEffect, useId, useRef, useState, type JSX } from 'react'
import type { QuestionsList } from '@shared/ipc'
import { Button } from '../../../ui'
import type { FitState } from '../hooks/useTrackedQuestions'
import { countText } from '../utils/plan'
import { TrackedPicker } from './TrackedPicker'

/**
 * "Also move in N questions you already track that fit this topic · review": one tick
 * for all of them, and the list to untick some. Nothing moves until Create topic.
 */
export function FitLine({
  fit,
  list,
  picked,
  disabled,
  onToggle,
  onSetPicked
}: {
  fit: FitState
  list: QuestionsList | null
  picked: ReadonlySet<string>
  disabled: boolean
  onToggle: (promptId: string) => void
  onSetPicked: (promptIds: readonly string[], on: boolean) => void
}): JSX.Element | null {
  const [open, setOpen] = useState(false)
  const listId = useId()
  const box = useRef<HTMLInputElement | null>(null)
  const chosen = fit.ids.filter((id) => picked.has(id)).length
  const all = fit.ids.length > 0 && chosen === fit.ids.length

  useEffect(() => {
    if (box.current) box.current.indeterminate = chosen > 0 && !all
  }, [chosen, all])

  if (fit.status === 'busy')
    return (
      <p className="nt-hint" role="status">
        Looking for questions you already track that fit this topic…
      </p>
    )
  if (fit.status === 'error') return <p className="nt-hint">{fit.error}</p>
  if (fit.status !== 'done' || fit.ids.length === 0) return null

  const ids = new Set(fit.ids)
  const rows = (list?.rows ?? []).filter((row) => ids.has(row.promptId))
  return (
    <div className="nt-fit">
      <div className="nt-fit-line">
        <label className="nt-fit-label">
          <input
            ref={box}
            type="checkbox"
            className="ui-check"
            checked={all}
            disabled={disabled}
            onChange={() => onSetPicked(fit.ids, !all)}
          />
          <span>
            Also move in {countText(fit.ids.length)} you already track that fit this topic
          </span>
        </label>
        <span aria-hidden="true">·</span>
        <Button
          variant="text"
          size="sm"
          aria-expanded={open}
          aria-controls={listId}
          onClick={() => setOpen((value) => !value)}
        >
          review
        </Button>
      </div>
      <div id={listId} hidden={!open}>
        {open ? (
          <TrackedPicker
            label="Tracked questions that fit this topic"
            rows={rows}
            sources={list?.sources ?? []}
            picked={picked}
            disabled={disabled}
            onToggle={onToggle}
          />
        ) : null}
      </div>
    </div>
  )
}
