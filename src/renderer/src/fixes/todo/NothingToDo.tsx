import { useId, useMemo, type JSX } from 'react'
import type { FixSearch, PageFixRollup } from '@shared/page-fixes'
import { pluralize } from '@shared/pluralize'
import { DrillButton } from '../../drill'
import { UiIcon } from '../../ui'
import { searchesDrill } from './model'

/**
 * "Nothing to do now", folded under What to fix (`?nothing=open`): the searches
 * that already cite the target page, those with no AI Overview, and those not
 * checked yet. Each count opens its searches.
 */
export function NothingToDo({
  rollup,
  projectId,
  domain,
  open,
  onToggle
}: {
  rollup: PageFixRollup
  projectId: string
  domain: string
  open: boolean
  onToggle: () => void
}): JSX.Element | null {
  const panelId = useId()
  const parts = useMemo(
    () =>
      [
        {
          id: 'target',
          searches: rollup.targetCited,
          line: (n: number) => `${n.toLocaleString('en-US')} already cite your target page`,
          title: 'Searches that already cite your target page',
          what: 'Done. Keep the page fresh.'
        },
        {
          id: 'no-aio',
          searches: rollup.noAio,
          line: (n: number) => `${n.toLocaleString('en-US')} have no AI Overview`,
          title: 'Searches with no AI Overview',
          what: 'Nothing to do. CiteFox checks them again on schedule.'
        },
        {
          id: 'not-checked',
          searches: rollup.notChecked,
          line: (n: number) => `${n.toLocaleString('en-US')} not checked yet`,
          title: 'Searches not checked yet',
          what: 'The next check answers them.'
        }
      ].filter((part) => part.searches.length > 0),
    [rollup]
  )
  const total = parts.reduce((sum, part) => sum + part.searches.length, 0)
  if (total === 0) return null
  const drill = (part: (typeof parts)[number]): ReturnType<typeof searchesDrill> =>
    searchesDrill({
      id: `nothing:${part.id}`,
      title: part.title,
      description: part.what,
      searches: part.searches as readonly FixSearch[],
      projectId,
      domain
    })
  return (
    <section className="fxt-nothing" aria-label="Nothing to do now">
      <button
        type="button"
        className="fxt-nothing-head"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={onToggle}
      >
        <UiIcon name={open ? 'chevron-down' : 'chevron-right'} size={14} />
        <span className="fxt-group-label">Nothing to do now</span>
        <span className="fxt-group-count num">{total.toLocaleString('en-US')}</span>
        <span className="fxt-group-todo">
          {parts.map((part) => part.line(part.searches.length)).join(' · ')}
        </span>
      </button>
      {open ? (
        <ul id={panelId} className="fxt-nothing-list">
          {parts.map((part) => (
            <li key={part.id}>
              <DrillButton
                className="dg-drill num"
                label={`${pluralize(part.searches.length, 'search', 'searches')}: ${part.title}`}
                drill={drill(part)}
              >
                {part.searches.length.toLocaleString('en-US')}
              </DrillButton>
              <span>{part.title}</span>
              <span className="muted">{part.what}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}
