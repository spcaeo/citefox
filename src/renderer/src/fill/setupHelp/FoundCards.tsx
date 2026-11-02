import type { JSX } from 'react'
import type { FillFromWebsiteResult, HelpFillResult } from '@shared/ipc'
import { SummaryBanner, UiIcon } from '../../ui'
import { writeQuery } from '../../utils/queryState'
import type { FillTab } from '../tabs'
import type { SetupPlan } from './model'
import { keptQuestions } from './model'

/** Where a count card opens: a tab of the Fill card, or the questions plan. */
type Opens = FillTab | 'questions'

interface Found {
  id: string
  count: number
  label: string
  opens: Opens
}

/**
 * "✓ Read your answer. Here's what we found; open any card to review it." and
 * one card per kind (panel 4): products, buyer types, competitors, markets,
 * questions and the topics they make. A card opens its tab on the Fill card
 * (`?fill=`) or scrolls to the questions; nothing is added from here.
 */
export function FoundCards({
  result,
  fill,
  plan,
  onQuestions
}: {
  result: HelpFillResult
  fill: FillFromWebsiteResult | null
  plan: SetupPlan | null
  /** Shows the questions plan. */
  onQuestions: () => void
}): JSX.Element {
  if (result.counts.ready === 0) return <SummaryBanner result={result} testId="su-summary" />
  const buyers = result.rows.filter((row) => row.section === 'buyers').length
  const markets = plan?.markets ?? []
  const codes = [...new Set(markets.map((market) => market.country))]
  const found: Found[] = [
    { id: 'products', count: fill?.products?.length ?? 0, label: 'Products', opens: 'competitors' },
    { id: 'buyers', count: buyers, label: 'Buyer types', opens: 'buyers' },
    {
      id: 'competitors',
      count: fill?.competitors.length ?? 0,
      label: 'Competitors',
      opens: 'competitors'
    },
    {
      id: 'markets',
      count: markets.length,
      label: codes.length > 0 ? `Markets: ${codes.slice(0, 4).join(', ')}` : 'Markets',
      opens: 'brand'
    },
    { id: 'questions', count: keptQuestions(plan), label: 'Questions', opens: 'questions' },
    { id: 'topics', count: plan?.topics.length ?? 0, label: 'Topics suggested', opens: 'questions' }
  ]
  const merged = result.counts.tracked + result.counts.repeats
  const notes = [
    merged > 0 ? `${merged} ${merged === 1 ? 'repeat was' : 'repeats were'} merged.` : '',
    result.counts.setAside > 0
      ? `${result.counts.setAside} named ${result.brand ?? 'your brand'} and ${
          result.counts.setAside === 1 ? 'was' : 'were'
        } set aside.`
      : ''
  ].filter((note) => note.length > 0)

  function open(target: Opens): void {
    if (target === 'questions') {
      onQuestions()
      return
    }
    writeQuery({ fill: target === 'competitors' ? null : target })
    document.querySelector('.fill-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className="su-found" data-testid="su-found">
      <div className="hf-banner" role="status" data-testid="su-summary">
        <UiIcon name="check" size={16} />
        <p>
          <strong>Read your answer.</strong> Here’s what we found; open any card to review it.
          {notes.length > 0 ? ` ${notes.join(' ')}` : ''}
        </p>
      </div>
      <ul className="su-cards" aria-label="What the answer holds">
        {found.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              className="su-card"
              disabled={item.count === 0}
              onClick={() => open(item.opens)}
              data-testid={`su-found-${item.id}`}
            >
              <span className="su-card-count num">{item.count}</span>
              <span className="su-card-label">{item.label}</span>
            </button>
          </li>
        ))}
      </ul>
      {markets.length > 1 ? (
        <p className="hf-hint">
          The first market is offered as the default. Add the others in Markets once the project
          exists.
        </p>
      ) : null}
    </div>
  )
}
