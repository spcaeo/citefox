import type { JSX } from 'react'
import type { QuestionRow, QuestionSource } from '@shared/ipc'

/** Tracked questions with a tick each, and the page or topic each sits on now. */
export function TrackedPicker({
  label,
  rows,
  sources,
  picked,
  disabled,
  onToggle
}: {
  label: string
  rows: readonly QuestionRow[]
  sources: readonly QuestionSource[]
  picked: ReadonlySet<string>
  disabled: boolean
  onToggle: (promptId: string) => void
}): JSX.Element {
  const names = new Map(sources.map((source) => [source.id, source.path ?? source.name]))
  return (
    <ul className="nt-picks" aria-label={label}>
      {rows.map((row) => (
        <li key={row.promptId} className="nt-pick">
          <label className="nt-pick-label">
            <input
              type="checkbox"
              className="ui-check"
              checked={picked.has(row.promptId)}
              disabled={disabled}
              onChange={() => onToggle(row.promptId)}
            />
            <span className="nt-pick-text">{row.text}</span>
            <span className="nt-tag">{names.get(row.sourceId) ?? 'Tracked'}</span>
          </label>
        </li>
      ))}
    </ul>
  )
}
