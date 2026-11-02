import { useRef, type JSX, type ReactNode } from 'react'
import type { OverviewQuestion } from '@shared/ipc'
import { navigateHash } from '../../shell/routes'
import { EmptyState, GRID_CARD_BORDERS, IconButton, ListGrid, useElementWidth } from '../../ui'
import { changeText, filterQuestions, questionFilterOptions, type QuestionFilter } from '../compare'
import { OVERVIEW_LINKS, QUESTION_NOUN, changeHref, sourceText, type CountNoun } from '../model'
import { useGridQueryState } from '../../utils/queryState'
import { fittedChangeColumns } from './changeColumns'

function questionKey(row: OverviewQuestion): string {
  return `${row.key}|${row.marketId}`
}

/**
 * Every tracked question against the compared check: Changed (gained or lost) by
 * default, or Gained, Kept, Lost, Still not cited or All, from the filter chips (`?change=`).
 * A row opens its prompt detail.
 */
export function ChangesSection({
  questions,
  filter,
  comparing,
  previous,
  addHref,
  onFilter,
  noun = QUESTION_NOUN,
  tools
}: {
  questions: readonly OverviewQuestion[]
  filter: QuestionFilter
  /** False when no question has an earlier result: no chips, every question shown. */
  comparing: boolean
  /** True when each question compares with its own previous check. */
  previous: boolean
  addHref: string
  onFilter: (filter: QuestionFilter) => void
  /** "search" when keywords are tracked too. */
  noun?: CountNoun
  /** The widget's own controls (its engine filter), at the end of the head. */
  tools?: ReactNode
}): JSX.Element {
  // Search and sort ride in the URL (`ch.q`, `ch.sort`): a link keeps them.
  const grid = useGridQueryState('ch')
  const box = useRef<HTMLDivElement>(null)
  const width = Math.max(0, useElementWidth(box) - GRID_CARD_BORDERS)
  const rows = filterQuestions(questions, filter)
  // The shown rows come from one topic or page: its name under every row would repeat itself.
  const oneSource = new Set(rows.map((item) => sourceText(item.source))).size <= 1
  const columns = fittedChangeColumns(comparing, width, {
    primary: noun.one === 'search' ? 'Search' : 'Question',
    oneSource
  })
  const options = questionFilterOptions(questions)
  const title = comparing ? `${noun.Many} that changed` : `Your ${noun.many}`
  // The Questions screen's `change` filter reads each question against its previous
  // check, the same as here only when Compare with is "Previous check".
  const sameOnQuestions = comparing && previous && (filter === 'gained' || filter === 'lost')
  return (
    <div className="ov-changes" ref={box}>
      <div className="ov-section-head">
        <h2>{title}</h2>
        {sameOnQuestions ? (
          <a className="ov-link" href={`${OVERVIEW_LINKS.questions}?change=${filter}`}>
            {changeText(filter)} in Questions →
          </a>
        ) : (
          // No count: Questions also lists the questions left out of checks, so a
          // number here would not match the list it opens (Questions tracked does).
          <a className="ov-link" href={OVERVIEW_LINKS.questions}>
            All {noun.many} →
          </a>
        )}
        <IconButton
          icon="plus"
          size="sm"
          tip
          label="Add questions"
          onClick={() => navigateHash(addHref)}
        />
        {tools}
      </div>
      <ListGrid
        {...grid.listProps}
        label={title}
        noun={[noun.one, noun.many]}
        rows={rows}
        rowKey={questionKey}
        rowLabel={(row) => row.text}
        columns={columns}
        onActivate={(row) => navigateHash(changeHref(row))}
        pageSize={10}
        {...(comparing
          ? {
              filter: {
                label: 'Change',
                options: options.map((option) => ({
                  value: option.value,
                  label: option.label,
                  count: option.count
                })),
                value: filter,
                onChange: (value: string) => onFilter(value as QuestionFilter),
                resetValue: 'changed'
              }
            }
          : {})}
        empty={
          <EmptyState
            compact
            icon="inbox"
            title={
              comparing
                ? filter === 'changed'
                  ? `No ${noun.one} gained or lost a citation`
                  : `No ${noun.one} in this view`
                : 'Nothing to compare yet'
            }
            body={
              comparing
                ? `Pick another chip to see the ${noun.many} that held or never were cited.`
                : 'Gained and lost citations show here after the next check.'
            }
          />
        }
      />
    </div>
  )
}
