import { useId, useState, type FormEvent, type JSX, type ReactNode } from 'react'
import { BRAND_FACT_MAX_LENGTH, type BrandFact } from '@shared/domain'
import { Button, SectionHead } from '../../ui'
import { formatMoment } from '../../utils/dates'
import type { ActionResult } from '../types'
import { countNoun } from '../utils/model'
import { SourceUrl } from './drillBits'

/** FR-16.6: short true statements Claude checks every claim against. */
export function BrandFacts({
  facts,
  checkedAt,
  canReread,
  busyFacts,
  busyReread,
  assist,
  onAdd,
  onDelete,
  onReread
}: {
  facts: readonly BrandFact[]
  checkedAt: string | null
  canReread: boolean
  busyFacts: boolean
  busyReread: boolean
  /** FR-16.9 "Suggest facts from my site" slot. */
  assist?: ReactNode
  onAdd: (text: string, source: string | null) => Promise<ActionResult>
  onDelete: (factId: string) => Promise<ActionResult>
  onReread: () => Promise<ActionResult>
}): JSX.Element {
  const textId = useId()
  const sourceId = useId()
  const [text, setText] = useState('')
  const [source, setSource] = useState('')
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null)

  async function report(work: Promise<ActionResult>): Promise<boolean> {
    const result = await work
    setMessage(result.message === null ? null : { text: result.message, error: !result.ok })
    return result.ok
  }

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault()
    const value = text.trim()
    if (value.length === 0) {
      setMessage({ text: 'Write the fact first.', error: true })
      return
    }
    const ok = await report(onAdd(value, source.trim() || null))
    if (ok) {
      setText('')
      setSource('')
    }
  }

  return (
    <section className="st-card" aria-labelledby="st-facts-h">
      <SectionHead
        id="st-facts-h"
        title="Brand facts"
        description="CiteFox AI checks every claim against these facts. Keep each one short and true."
        ai={assist}
      />
      {facts.length === 0 ? (
        <p className="muted">
          No facts yet. Without them, CiteFox AI can only flag claims that contradict your own
          pages.
        </p>
      ) : (
        <ul className="st-facts" aria-label="Brand facts">
          {facts.map((fact) => (
            <li key={fact.id}>
              <span className="st-fact-text">{fact.text}</span>
              {fact.source ? <SourceUrl url={fact.source} className="faint mono st-small" /> : null}
              <Button
                size="sm"
                variant="ghost"
                icon="trash"
                disabled={busyFacts}
                aria-label={`Remove fact: ${fact.text}`}
                onClick={() => void report(onDelete(fact.id))}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
      <form className="st-fact-form" aria-label="Add a brand fact" onSubmit={(e) => void submit(e)}>
        <div className="st-field st-field-grow">
          <label htmlFor={textId}>New brand fact</label>
          <input
            id={textId}
            className="ui-input"
            value={text}
            maxLength={BRAND_FACT_MAX_LENGTH}
            placeholder="Plans are $29 and $49 a month"
            onChange={(event) => setText(event.target.value)}
          />
        </div>
        <div className="st-field">
          <label htmlFor={sourceId}>
            Source <span className="faint">(optional)</span>
          </label>
          <input
            id={sourceId}
            className="ui-input"
            value={source}
            placeholder="https://…"
            onChange={(event) => setSource(event.target.value)}
          />
        </div>
        <Button type="submit" icon="plus" disabled={busyFacts}>
          Add fact
        </Button>
      </form>
      <div className="st-reread">
        <p className="st-note">
          {countNoun(facts.length, 'fact', 'facts')} · Changes apply from the next check.
          {canReread
            ? ` CiteFox AI can also re-read the saved ${formatMoment(checkedAt)} overviews now, with no new searches.`
            : ''}
        </p>
        {canReread ? (
          <Button disabled={busyReread} onClick={() => void report(onReread())}>
            {busyReread ? 'Starting…' : 'Re-read saved overviews'}
            <span className="st-tag">No new searches</span>
          </Button>
        ) : null}
      </div>
      {message ? (
        <p
          className={message.error ? 'bridge-alert' : 'st-message'}
          role={message.error ? 'alert' : 'status'}
        >
          {message.text}
        </p>
      ) : null}
    </section>
  )
}
