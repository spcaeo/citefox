import { useEffect, useMemo, useRef, type JSX } from 'react'
import type { GridCsvExport } from '../../../grid'
import { alertsHash } from '../../../shell/routes'
import {
  Button,
  Chip,
  CopyText,
  EmptyState,
  ListGrid,
  SegmentedControl,
  type ListColumn,
  type ListGroup,
  type MenuItem,
  type SegmentOption
} from '../../../ui'
import { resendLabel, timelineDays, type DeliveryRow } from '../../scheduleModel'
import { useQueryChoice } from '../../../utils/queryState'
import { deliveriesCsv } from '../utils/csv'
import { deliveryText } from '../utils/gridRows'
import { CsvButton } from './CsvButton'

/** What a delivery row's cells open. */
export interface DeliveryOpeners {
  delivery: (row: DeliveryRow) => void
  schedule: (scheduleId: string) => void
  /** Null: project names are text. */
  project: ((projectId: string) => void) | null
}

type ResultFilter = 'all' | 'sent' | 'failed'
type View = 'table' | 'days'

/** `?hf=` is the result filter and `?hv=` the view; All and the table have none. */
const RESULT_FILTERS: readonly ResultFilter[] = ['all', 'sent', 'failed']
const VIEW_IDS: readonly View[] = ['table', 'days']

const VIEWS: readonly SegmentOption<View>[] = [
  { value: 'table', label: 'Table' },
  { value: 'days', label: 'By day' }
]

function passes(row: DeliveryRow, filter: ResultFilter): boolean {
  if (filter === 'sent') return row.outcome !== 'failed'
  if (filter === 'failed') return row.outcome === 'failed'
  return true
}

function resultTone(row: DeliveryRow): 'ok' | 'bad' | 'neutral' {
  if (row.outcome === 'failed') return 'bad'
  return row.result === 'Sent' ? 'ok' : 'neutral'
}

/**
 * Delivery history (FR-23.11) on the v2 list grid. "By day" groups the same
 * rows (with the same search and filter) under one header per day, newest
 * first: the timeline view. Resend, Retry and the opens live behind `⋯`.
 */
export function HistorySection({
  rows,
  loaded,
  resent,
  onResend,
  open,
  exportCsv = null
}: {
  rows: readonly DeliveryRow[]
  loaded: boolean
  resent: Readonly<Record<string, true>>
  onResend: (row: DeliveryRow) => void
  open: DeliveryOpeners
  exportCsv?: GridCsvExport | null
}): JSX.Element {
  const [filter, setFilter] = useQueryChoice('hf', RESULT_FILTERS, 'all')
  const [view, setView] = useQueryChoice('hv', VIEW_IDS, 'table')
  const handlers = useRef({ open, onResend })
  useEffect(() => {
    handlers.current = { open, onResend }
  })
  const canOpenProject = open.project !== null
  const shown = useMemo(() => rows.filter((row) => passes(row, filter)), [rows, filter])
  const failed = rows.filter((row) => row.outcome === 'failed').length

  const group = useMemo((): ListGroup<DeliveryRow> | undefined => {
    if (view !== 'days') return undefined
    const days = timelineDays(shown, 'desc')
    const meta = new Map(days.map((day) => [day.key, day.meta]))
    return {
      key: (row) => ({ key: row.dayKey, label: row.dayLabel }),
      order: days.map((day) => day.key),
      meta: (_rows, key) => meta.get(key) ?? null
    }
  }, [view, shown])

  const options = useMemo(
    (): SegmentOption<ResultFilter>[] => [
      { value: 'all', label: 'All', count: rows.length },
      { value: 'sent', label: 'Sent', count: rows.length - failed },
      { value: 'failed', label: 'Failed', count: failed }
    ],
    [rows.length, failed]
  )

  const columns = useMemo(
    (): ListColumn<DeliveryRow>[] => [
      {
        id: 'date',
        label: 'Date',
        width: 130,
        sort: (row) => row.at,
        render: (row) => <span className="num">{row.dateLabel}</span>
      },
      {
        id: 'name',
        label: 'Schedule',
        width: 'fill',
        minWidth: 160,
        sort: (row) => row.name.toLowerCase(),
        render: (row) => {
          const scheduleId = row.scheduleId
          if (!scheduleId) return <span className="rpt-cell-strong rpt-clip">{row.name}</span>
          return (
            <button
              type="button"
              className="rpt-cell-link rpt-cell-strong"
              aria-label={`${row.name}: open schedule`}
              onClick={() => handlers.current.open.schedule(scheduleId)}
            >
              <span className="rpt-clip">{row.name}</span>
            </button>
          )
        }
      },
      {
        id: 'project',
        label: 'Project',
        width: 110,
        sort: (row) => row.project,
        render: (row) => {
          const projectId = row.projectId
          if (!projectId || !canOpenProject) return <span className="rpt-clip">{row.project}</span>
          return (
            <button
              type="button"
              className="rpt-cell-link"
              aria-label={`${row.project}: open project`}
              onClick={() => handlers.current.open.project?.(projectId)}
            >
              <span className="rpt-clip">{row.project}</span>
            </button>
          )
        }
      },
      {
        id: 'trigger',
        label: 'Kind',
        width: 120,
        sort: (row) => row.trigger,
        render: (row) => <span className="rpt-clip">{row.trigger}</span>
      },
      {
        id: 'to',
        label: 'Recipients',
        width: 160,
        sort: (row) => row.recipients,
        render: (row) => <CopyText text={row.recipients} />
      },
      {
        id: 'result',
        label: 'Result',
        width: 96,
        sort: (row) => row.result,
        render: (row) => (
          <span title={row.reason ?? undefined}>
            <Chip size="sm" tone={resultTone(row)} dot>
              {row.result}
            </Chip>
            {row.reason ? <span className="sr-only">: {row.reason}</span> : null}
          </span>
        )
      }
    ],
    [canOpenProject]
  )

  function rowMenu(row: DeliveryRow): MenuItem[] {
    const scheduleId = row.scheduleId
    const items: MenuItem[] = [
      {
        id: 'open',
        label: 'Open delivery',
        icon: 'eye',
        onSelect: () => handlers.current.open.delivery(row)
      }
    ]
    if (scheduleId) {
      items.push({
        id: 'schedule',
        label: 'Open schedule',
        icon: 'layers',
        onSelect: () => handlers.current.open.schedule(scheduleId)
      })
    }
    items.push({
      id: 'resend',
      label: resendLabel(row.outcome, Boolean(resent[row.id])),
      icon: 'refresh',
      onSelect: () => handlers.current.onResend(row)
    })
    if (row.outcome === 'failed') {
      items.push({
        id: 'fix',
        label: 'Fix in Email setup',
        icon: 'warning',
        onSelect: () => {
          window.location.hash = alertsHash('email')
        }
      })
    }
    return items
  }

  return (
    <div className="rpt-list">
      <ListGrid<DeliveryRow>
        urlKey="rdel"
        label="Delivery history"
        noun={['delivery', 'deliveries']}
        rows={shown}
        rowKey={(row) => row.id}
        rowLabel={(row) => `${row.name}, ${row.dateLabel}`}
        columns={columns}
        search={{ text: deliveryText, placeholder: 'Search schedule, recipient or error' }}
        filter={{
          label: 'Result',
          options,
          value: filter,
          onChange: (value) => setFilter(value as ResultFilter)
        }}
        toolbar={
          <SegmentedControl
            label="View"
            size="sm"
            options={VIEWS}
            value={view}
            onChange={setView}
          />
        }
        actions={
          exportCsv ? (
            <CsvButton
              exportCsv={exportCsv}
              build={() => deliveriesCsv(shown)}
              disabled={shown.length === 0}
            />
          ) : null
        }
        {...(group ? { group } : {})}
        rowMenu={rowMenu}
        onActivate={(row) => handlers.current.open.delivery(row)}
        initialSort={[{ key: 'date', dir: 'desc' }]}
        empty={
          !loaded ? null : filter !== 'all' && rows.length > 0 ? (
            <EmptyState
              icon="search"
              title="No deliveries match this filter"
              action={
                <Button size="sm" onClick={() => setFilter('all')}>
                  Show all
                </Button>
              }
            />
          ) : (
            <EmptyState
              title="No deliveries yet."
              body="Every send and test send shows here, with its result."
            />
          )
        }
      />
    </div>
  )
}
