import { useMemo, useState, type JSX } from 'react'
import { foldWord } from '@shared/import-fields'
import type { QuestionsList } from '@shared/ipc'
import { Button, SearchBox } from '../../ui'

/** Tracked questions listed at once; a search narrows the rest. */
const SHOWN = 150

/**
 * From tracked questions: copy questions another page or topic already tracks
 * into this one. They stay where they are too, so each one is kept as "keep
 * both" and checked again here.
 */
export function TrackedTab({
  tracked,
  targetId,
  disabled,
  onAdd
}: {
  tracked: QuestionsList | null
  targetId: string | null
  disabled: boolean
  onAdd: (texts: readonly { text: string; stage: string | null }[]) => void
}): JSX.Element {
  const [query, setQuery] = useState('')
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set())

  const names = useMemo(
    () => new Map((tracked?.sources ?? []).map((source) => [source.id, source.name])),
    [tracked]
  )
  const others = useMemo(
    () => (tracked?.rows ?? []).filter((row) => row.sourceId !== targetId),
    [tracked, targetId]
  )
  const matches = useMemo(() => {
    const words = foldWord(query).split(' ').filter(Boolean)
    if (words.length === 0) return others
    return others.filter((row) => {
      const text = foldWord(`${row.text} ${names.get(row.sourceId) ?? ''}`)
      return words.every((word) => text.includes(word))
    })
  }, [others, query, names])
  const shown = matches.slice(0, SHOWN)

  function toggle(id: string): void {
    setTicked((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function add(): void {
    const picked = others.filter((row) => ticked.has(row.promptId))
    onAdd(picked.map((row) => ({ text: row.text, stage: row.stage })))
    setTicked(new Set())
  }

  if (tracked === null) {
    return (
      <div className="aq-card aq-tracked">
        <p className="aq-hint">Loading the tracked questions…</p>
      </div>
    )
  }
  if (others.length === 0) {
    return (
      <div className="aq-card aq-tracked">
        <p className="aq-hint">No other page or topic tracks questions yet.</p>
      </div>
    )
  }
  return (
    <div className="aq-card aq-tracked" data-testid="aq-tracked">
      <div className="aq-tracked-head">
        <SearchBox
          className="aq-grow"
          label={`Search ${others.length.toLocaleString('en-US')} tracked questions`}
          value={query}
          onChange={setQuery}
        />
        <Button size="sm" disabled={disabled || ticked.size === 0} onClick={add}>
          {ticked.size > 0 ? `Add ${ticked.size} to the rows` : 'Tick questions to add'}
        </Button>
      </div>
      <ul className="aq-tracked-list">
        {shown.map((row) => (
          <li key={row.promptId}>
            <label className="aq-check">
              <input
                type="checkbox"
                className="ui-check"
                checked={ticked.has(row.promptId)}
                disabled={disabled}
                onChange={() => toggle(row.promptId)}
              />
              <span className="aq-idea-text">{row.text}</span>
            </label>
            <span className="aq-hint aq-tracked-src">{names.get(row.sourceId) ?? ''}</span>
          </li>
        ))}
      </ul>
      {matches.length > shown.length ? (
        <p className="aq-hint">
          {(matches.length - shown.length).toLocaleString('en-US')} more · search to narrow them
        </p>
      ) : null}
      {matches.length === 0 ? <p className="aq-hint">No tracked question matches.</p> : null}
    </div>
  )
}
