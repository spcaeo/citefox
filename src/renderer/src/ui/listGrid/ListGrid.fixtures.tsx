import type { RenderResult } from '@testing-library/react'
import type { JSX } from 'react'
import { ListGrid } from './index'
import type { ListColumn, ListGridProps, ListGroup } from './types'

/* Shared fixtures for the ListGrid tests: the Theme.dc.html to-do questions. */

export const RULES = {
  rules: {
    'document-title': { enabled: false },
    'html-has-lang': { enabled: false },
    'landmark-one-main': { enabled: false },
    region: { enabled: false }
  }
}

export interface Question {
  id: string
  n: number
  text: string
  stage: string
  odds: number
  group: 'exists' | 'none' | 'right'
}

const GROUP_LABELS = {
  exists: 'Page exists, not cited',
  none: 'No page yet',
  right: 'Cited by the right page'
} as const

export function question(
  n: number,
  text: string,
  stage: string,
  odds: number,
  group: Question['group']
): Question {
  return { id: `q${n}`, n, text, stage, odds, group }
}

export const QUESTIONS: Question[] = [
  question(6, 'Three clinic locations; staff never open the staff app', 'Problem', 81, 'exists'),
  question(10, "Carrier's email-to-text address stopped delivering", 'Options', 76, 'exists'),
  question(4, 'Server-down email went unnoticed over a long weekend', 'Problem', 72, 'exists'),
  question(21, '12-person HVAC company: is email-to-text enough?', 'Fit', 60, 'none'),
  question(17, 'On-call maintenance crew changes every week', 'Fit', 52, 'none'),
  question(2, 'Text alerts for teams without a developer', 'Decide', 40, 'right')
]

export const COLUMNS: ListColumn<Question>[] = [
  { id: 'n', label: 'Q', width: 48, sort: (row) => row.n, render: (row) => `Q${row.n}` },
  {
    id: 'text',
    label: 'Question',
    width: 'fill',
    sort: (row) => row.text,
    render: (row) => row.text
  },
  { id: 'stage', label: 'Stage', width: 96, render: (row) => row.stage },
  {
    id: 'odds',
    label: 'Win odds',
    width: 96,
    numeric: true,
    sort: (row) => row.odds,
    render: (row) => row.odds
  }
]

export const GROUP: ListGroup<Question> = {
  key: (row) => ({ key: row.group, label: GROUP_LABELS[row.group] }),
  order: ['exists', 'none', 'right'],
  meta: (_rows, key) => (key === 'none' ? 'Write a page' : 'Improve the target page')
}

export type Props = Partial<ListGridProps<Question>>

export function grid(props: Props = {}): JSX.Element {
  return (
    <ListGrid<Question>
      label="Questions"
      noun={['question', 'questions']}
      rows={QUESTIONS}
      rowKey={(row) => row.id}
      rowLabel={(row) => `Q${row.n}`}
      columns={COLUMNS}
      search={{ text: (row) => row.text }}
      empty={<p>No questions yet</p>}
      {...props}
    />
  )
}

/** Data rows (not group headers) in display order, by their Q label. */
export function shownQs(view: RenderResult): string[] {
  return [...view.container.querySelectorAll('.ui-lg-row')].map(
    (row) => row.querySelector('.ui-lg-td')?.textContent ?? ''
  )
}

export function many(count: number): Question[] {
  return Array.from({ length: count }, (_, at) =>
    question(at + 1, `Question number ${at + 1}`, 'Problem', at % 100, 'exists')
  )
}
