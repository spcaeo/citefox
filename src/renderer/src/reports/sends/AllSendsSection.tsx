import { useMemo, type JSX } from 'react'
import {
  Button,
  Chip,
  CopyText,
  EmptyState,
  ListGrid,
  type ListColumn,
  type MenuItem,
  type SegmentOption
} from '../../ui'
import { useQueryChoice } from '../../utils/queryState'
import { sendsCountLine, type SendRow } from './sendsModel'

type OnFilter = 'all' | 'on' | 'off'

/** The On or Off filter is `?af=` in the route; All has none. */
const ON_FILTERS: readonly OnFilter[] = ['all', 'on', 'off']

function passes(row: SendRow, filter: OnFilter): boolean {
  if (filter === 'on') return row.on
  if (filter === 'off') return !row.on
  return true
}

function rowText(row: SendRow): string {
  return [row.name, row.kindLabel, row.project, row.to, row.when, row.where.label].join(' ')
}

function go(href: string): void {
  window.location.hash = href.startsWith('#') ? href.slice(1) : href
}

/**
 * Reports › All sends (`#/reports?view=sends`): everything CiteFox sends or
 * writes on its own, in one list. Scheduled reports, the email after each
 * check, the monthly client PDF, Slack and automatic export, each with where
 * it goes, when, whether it is on, and a link to where it is set.
 */
export function AllSendsSection({
  rows,
  loaded,
  problems
}: {
  rows: readonly SendRow[]
  loaded: boolean
  /** "Acme: Could not read the notifications." One per project that could not be read. */
  problems: readonly string[]
}): JSX.Element {
  const [filter, setFilter] = useQueryChoice('af', ON_FILTERS, 'all')
  const shown = useMemo(() => rows.filter((row) => passes(row, filter)), [rows, filter])
  const on = rows.filter((row) => row.on).length

  const options = useMemo(
    (): SegmentOption<OnFilter>[] => [
      { value: 'all', label: 'All', count: rows.length },
      { value: 'on', label: 'On', count: on },
      { value: 'off', label: 'Off', count: rows.length - on }
    ],
    [rows.length, on]
  )

  const columns = useMemo(
    (): ListColumn<SendRow>[] => [
      {
        id: 'name',
        label: 'What',
        width: 'fill',
        minWidth: 180,
        sort: (row) => row.name.toLowerCase(),
        render: (row) => (
          <span className="rpt-send-what">
            <span className="rpt-cell-strong rpt-clip">{row.name}</span>
            {row.kind === 'schedule' ? (
              <span className="rpt-send-kind">{row.kindLabel}</span>
            ) : null}
          </span>
        )
      },
      {
        id: 'project',
        label: 'Project',
        width: 120,
        sort: (row) => row.project.toLowerCase(),
        render: (row) => <span className="rpt-clip">{row.project}</span>
      },
      {
        id: 'to',
        label: 'Goes to',
        width: 200,
        sort: (row) => row.to.toLowerCase(),
        render: (row) => <CopyText text={row.to} />
      },
      {
        id: 'when',
        label: 'When',
        width: 170,
        sort: (row) => row.when,
        render: (row) => <span className="rpt-clip">{row.when}</span>
      },
      {
        id: 'on',
        label: 'On',
        width: 72,
        sort: (row) => (row.on ? 1 : 0),
        render: (row) => (
          <Chip size="sm" tone={row.on ? 'ok' : 'neutral'} dot>
            {row.on ? 'On' : 'Off'}
          </Chip>
        )
      },
      {
        id: 'where',
        label: 'Set in',
        width: 190,
        sort: (row) => row.where.label,
        render: (row) => (
          <a
            className="rpt-cell-link rpt-clip"
            href={row.where.href}
            aria-label={`${row.name}, ${row.project}: open ${row.where.label}`}
          >
            {row.where.label}
          </a>
        )
      }
    ],
    []
  )

  function rowMenu(row: SendRow): MenuItem[] {
    return [
      {
        id: 'open',
        label: `Open ${row.where.label}`,
        icon: 'external',
        onSelect: () => go(row.where.href)
      }
    ]
  }

  return (
    <div className="rpt-list" data-testid="rpt-sends">
      {rows.length > 0 ? <p className="rpt-line">{sendsCountLine(rows)}</p> : null}
      {problems.map((problem) => (
        <p key={problem} className="rpt-help" role="status">
          {problem}
        </p>
      ))}
      <ListGrid<SendRow>
        urlKey="sends"
        label="All sends"
        noun={['send', 'sends']}
        rows={shown}
        rowKey={(row) => row.id}
        rowLabel={(row) => `${row.name}, ${row.project}`}
        columns={columns}
        search={{ text: rowText, placeholder: 'Search name, project or recipient' }}
        filter={{
          label: 'On or off',
          options,
          value: filter,
          onChange: (value) => setFilter(value as OnFilter)
        }}
        rowMenu={rowMenu}
        onActivate={(row) => go(row.where.href)}
        initialSort={[{ key: 'project', dir: 'asc' }]}
        empty={
          !loaded ? null : filter !== 'all' && rows.length > 0 ? (
            <EmptyState
              icon="search"
              title={filter === 'on' ? 'Nothing is on' : 'Nothing is off'}
              action={
                <Button size="sm" onClick={() => setFilter('all')}>
                  Show all
                </Button>
              }
            />
          ) : (
            <EmptyState
              title="Nothing is sent on its own yet."
              body="Scheduled reports, alert emails, Slack messages and automatic exports show here once they are set."
            />
          )
        }
      />
    </div>
  )
}
