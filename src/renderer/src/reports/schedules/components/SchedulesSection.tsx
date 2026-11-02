import { useEffect, useMemo, useRef, useState, type JSX } from 'react'
import { AiSelection } from '../../../assistant/context/AiSelection'
import { askColumn } from '../../../assistant/sparkle/askColumn'
import { useDrill, type ItemDrill } from '../../../drill'
import type { GridCsvExport } from '../../../grid'
import { alertsHash } from '../../../shell/routes'
import {
  Button,
  EmptyState,
  ListGrid,
  type ListColumn,
  type MenuItem,
  type SegmentOption
} from '../../../ui'
import { Switch } from '../../bits'
import { scheduleShowingLine, type ScheduleRow } from '../../scheduleModel'
import { schedulesCsv } from '../utils/csv'
import { scheduleText, scheduleValue } from '../utils/gridRows'
import { CsvButton } from './CsvButton'

/** The drawers a schedule row's cells open. */
export interface ScheduleDrills {
  sections: ItemDrill
  recipients: ItemDrill
  /** Null when nothing is coming (off, or its project is paused). */
  next: ItemDrill | null
}

export interface ScheduleOpeners {
  schedule: (row: ScheduleRow) => void
  delivery: (deliveryId: string) => void
  /** Null: project names are text (no way to switch project here). */
  project: ((projectId: string) => void) | null
}

type StatusFilter = 'all' | 'on' | 'off' | 'failed'

function passes(row: ScheduleRow, filter: StatusFilter): boolean {
  switch (filter) {
    case 'all':
      return true
    case 'on':
      return row.status === 'active'
    case 'off':
      return row.status !== 'active'
    case 'failed':
      return row.lastFailed
  }
}

/** The DOM row of a schedule, found by its name drill (ListGrid rows carry no key). */
function rowNode(root: HTMLElement | null, row: ScheduleRow): HTMLElement | null {
  const label = `${row.name}: open details`
  const button = [...(root?.querySelectorAll<HTMLElement>('[data-row] button') ?? [])].find(
    (node) => node.getAttribute('aria-label') === label
  )
  return button?.closest<HTMLElement>('[data-row]') ?? null
}

/**
 * Scheduled reports (FR-23.7, FR-23.11) on the v2 list grid: search, a status
 * segment, sortable headers, bulk on/off, and every row action behind `⋯`.
 * The On switch stays in its row: it is the schedule's state, not an action.
 */
export function SchedulesSection({
  rows,
  activeCount,
  onSuffix,
  loaded,
  onToggle,
  onSetStatus,
  onEdit,
  onDuplicate = null,
  onSendNow = null,
  onDelete,
  focusScheduleId,
  onFocusHandled,
  drills,
  open,
  exportCsv = null,
  onNew = null
}: {
  rows: readonly ScheduleRow[]
  activeCount: number
  onSuffix: string
  loaded: boolean
  onToggle: (row: ScheduleRow) => void
  /** Bulk on or off. */
  onSetStatus: (rows: readonly ScheduleRow[], status: 'active' | 'paused') => void
  onEdit: (row: ScheduleRow) => void
  /** "Copy of <name>" in the edit drawer. Null: not offered. */
  onDuplicate?: ((row: ScheduleRow) => void) | null
  /** Asks first, then sends the report now. Null: not offered. */
  onSendNow?: ((row: ScheduleRow) => void) | null
  onDelete: (row: ScheduleRow, neighborId: string | null, opener: HTMLElement) => void
  focusScheduleId: string | null | undefined
  onFocusHandled: () => void
  drills: ReadonlyMap<string, ScheduleDrills>
  open: ScheduleOpeners
  exportCsv?: GridCsvExport | null
  /** The empty card's one action: New schedule (the header's button does the same). */
  onNew?: (() => void) | null
}): JSX.Element {
  const drill = useDrill()
  const sectionRef = useRef<HTMLDivElement>(null)
  const [filter, setFilter] = useState<StatusFilter>('all')
  const handlers = useRef({
    open,
    drill: drill.open,
    onToggle,
    onEdit,
    onDuplicate,
    onSendNow,
    onDelete,
    onFocusHandled
  })
  useEffect(() => {
    handlers.current = {
      open,
      drill: drill.open,
      onToggle,
      onEdit,
      onDuplicate,
      onSendNow,
      onDelete,
      onFocusHandled
    }
  })
  const shown = useMemo(() => rows.filter((row) => passes(row, filter)), [rows, filter])
  const failed = rows.filter((row) => row.lastFailed).length
  const canOpenProject = open.project !== null

  useEffect(() => {
    if (focusScheduleId === undefined) return
    const target = focusScheduleId === null ? null : rows.find((row) => row.id === focusScheduleId)
    const node = target ? rowNode(sectionRef.current, target) : null
    if (node) node.focus()
    else document.getElementById('rpt-new-schedule')?.focus()
    handlers.current.onFocusHandled()
  }, [focusScheduleId, rows])

  const options = useMemo(
    (): SegmentOption<StatusFilter>[] => [
      { value: 'all', label: 'All', count: rows.length },
      { value: 'on', label: 'On', count: activeCount },
      { value: 'off', label: 'Off', count: rows.length - activeCount },
      ...(failed > 0 ? [{ value: 'failed' as const, label: 'Failed', count: failed }] : [])
    ],
    [rows.length, activeCount, failed]
  )

  const columns = useMemo(
    (): ListColumn<ScheduleRow>[] => [
      {
        id: 'name',
        label: 'Name',
        width: 'fill',
        minWidth: 150,
        sort: (row) => scheduleValue(row, 'name'),
        render: (row) => <span className="rpt-cell-strong">{row.name}</span>,
        drill: (row) => ({
          label: `${row.name}: open details`,
          onOpen: () => handlers.current.open.schedule(row)
        })
      },
      {
        id: 'project',
        label: 'Project',
        width: 100,
        sort: (row) => scheduleValue(row, 'project'),
        render: (row) => {
          const projectId = row.projectId
          const text = (
            <span className="rpt-clip" title={row.projectTag ?? undefined}>
              {row.project}
              {row.projectTag ? <span className="rpt-muted"> · {row.projectTag}</span> : null}
            </span>
          )
          if (projectId === null || !canOpenProject) return text
          return (
            <button
              type="button"
              className="rpt-cell-link"
              onClick={() => handlers.current.open.project?.(projectId)}
            >
              {text}
              <span className="sr-only">: open project</span>
            </button>
          )
        }
      },
      {
        id: 'what',
        label: 'What',
        width: 130,
        sort: (row) => scheduleValue(row, 'what'),
        render: (row) => {
          const found = drills.get(row.id)
          const text = (
            <span className="rpt-clip" title={`${row.formatLabel} · ${row.sectionsLabel}`}>
              {row.formatLabel}
              <span className="rpt-muted"> · {row.sectionsLabel}</span>
            </span>
          )
          if (!found) return text
          // No aria-label: the name is the visible text plus what it opens (WCAG 2.5.3).
          return (
            <button
              type="button"
              className="rpt-cell-link"
              onClick={() => handlers.current.drill(found.sections)}
            >
              {text}
              <span className="sr-only">: show what {row.name} sends</span>
            </button>
          )
        }
      },
      {
        id: 'when',
        label: 'When',
        width: 120,
        sort: (row) => scheduleValue(row, 'when'),
        render: (row) => (
          <span className="rpt-clip" title={row.when}>
            {row.when}
          </span>
        )
      },
      {
        id: 'rcpts',
        label: 'Recipients',
        width: 140,
        sort: (row) => scheduleValue(row, 'rcpts'),
        render: (row) => {
          const found = drills.get(row.id)
          const [first, ...more] = row.recipients
          const text = (
            <span className="rpt-clip" title={row.recipients.join(', ')}>
              {first ?? '—'}
              {more.length > 0 ? <span className="rpt-muted"> +{more.length}</span> : null}
            </span>
          )
          if (!found || row.recipients.length === 0) return text
          return (
            <button
              type="button"
              className="rpt-cell-link"
              onClick={() => handlers.current.drill(found.recipients)}
            >
              {text}
              <span className="sr-only">
                : show the{' '}
                {row.recipients.length === 1 ? 'recipient' : `${row.recipients.length} recipients`}{' '}
                of {row.name}
              </span>
            </button>
          )
        }
      },
      {
        id: 'next',
        label: 'Next',
        width: 96,
        sort: (row) => scheduleValue(row, 'next'),
        render: (row) => (
          <span className={row.next === 'Off' ? 'rpt-muted num' : 'num'}>{row.next}</span>
        ),
        drill: (row) => {
          const next = drills.get(row.id)?.next ?? null
          if (!next) return null
          return {
            label: `${row.next}: show the next sends of ${row.name}`,
            onOpen: () => handlers.current.drill(next)
          }
        }
      },
      {
        id: 'last',
        label: 'Last result',
        width: 104,
        sort: (row) => scheduleValue(row, 'last'),
        render: (row) => {
          const text = (
            <span
              className={row.lastFailed ? 'rpt-bad num' : 'num'}
              title={row.lastReason ?? undefined}
            >
              {row.last}
            </span>
          )
          const deliveryId = row.lastDeliveryId
          if (!deliveryId) return text
          return (
            <button
              type="button"
              className="rpt-cell-link"
              aria-label={`${row.last}: open the last delivery of ${row.name}`}
              onClick={() => handlers.current.open.delivery(deliveryId)}
            >
              {text}
            </button>
          )
        }
      },
      {
        id: 'on',
        label: 'On',
        width: 40,
        sort: (row) => scheduleValue(row, 'on'),
        render: (row) => (
          <Switch
            on={row.status === 'active'}
            label={`Send ${row.name}`}
            onToggle={() => handlers.current.onToggle(row)}
          />
        )
      },
      askColumn((row) => ({ kind: 'report', id: row.id, label: row.name, detail: row.when }))
    ],
    [drills, canOpenProject]
  )
  // One project for every schedule: the column says nothing new (details still show it).
  const multiProject = new Set(rows.map((row) => row.project)).size > 1
  const visibleColumns = useMemo(
    () => (multiProject ? columns : columns.filter((column) => column.id !== 'project')),
    [columns, multiProject]
  )

  function rowMenu(row: ScheduleRow): MenuItem[] {
    const items: MenuItem[] = [
      {
        id: 'open',
        label: 'Open details',
        icon: 'eye',
        onSelect: () => handlers.current.open.schedule(row)
      },
      {
        id: 'edit',
        label: 'Edit',
        icon: 'pencil',
        onSelect: () => handlers.current.onEdit(row)
      },
      ...(onDuplicate
        ? [
            {
              id: 'duplicate',
              label: 'Duplicate',
              icon: 'copy' as const,
              onSelect: () => handlers.current.onDuplicate?.(row)
            }
          ]
        : []),
      ...(onSendNow
        ? [
            {
              id: 'send-now',
              label: 'Send now',
              icon: 'bolt' as const,
              onSelect: () => handlers.current.onSendNow?.(row)
            }
          ]
        : []),
      {
        id: 'toggle',
        label: row.status === 'active' ? 'Turn off' : 'Turn on',
        icon: 'refresh',
        onSelect: () => handlers.current.onToggle(row)
      }
    ]
    if (row.lastFailed) {
      items.push({
        id: 'fix',
        label: 'Fix in Email setup',
        icon: 'warning',
        onSelect: () => {
          window.location.hash = alertsHash('email')
        }
      })
    }
    items.push({
      id: 'delete',
      label: 'Delete',
      icon: 'trash',
      tone: 'danger',
      onSelect: () => {
        const index = shown.findIndex((item) => item.id === row.id)
        const neighbor = shown[index + 1]?.id ?? shown[index - 1]?.id ?? null
        const opener =
          rowNode(sectionRef.current, row)?.querySelector<HTMLElement>('.ui-row-menu') ??
          document.getElementById('rpt-new-schedule')
        if (opener) handlers.current.onDelete(row, neighbor, opener)
      }
    })
    return items
  }

  return (
    <div className="rpt-list" ref={sectionRef}>
      {rows.length > 0 ? (
        <p className="rpt-line">
          <button
            type="button"
            className="rpt-text-btn"
            aria-label={`${activeCount} of ${rows.length} on: show only the schedules that send`}
            disabled={activeCount === 0}
            onClick={() => setFilter('on')}
          >
            {activeCount} of {rows.length} on
          </button>{' '}
          · {onSuffix}
        </p>
      ) : null}
      {failed > 0 ? (
        <p className="rpt-banner" role="note">
          {failed === 1 ? '1 schedule' : `${failed} schedules`} could not send last time.{' '}
          <a href={alertsHash('email')}>Fix in Email setup</a>
        </p>
      ) : null}
      <ListGrid<ScheduleRow>
        label="Schedules"
        noun={['schedule', 'schedules']}
        rows={shown}
        rowKey={(row) => row.id}
        rowLabel={(row) => row.name}
        columns={visibleColumns}
        search={{ text: scheduleText, placeholder: 'Search name, project or recipient' }}
        filter={{
          label: 'Status',
          options,
          value: filter,
          onChange: (value) => setFilter(value as StatusFilter)
        }}
        actions={
          exportCsv ? (
            <CsvButton
              exportCsv={exportCsv}
              build={() => schedulesCsv(shown)}
              disabled={shown.length === 0}
            />
          ) : null
        }
        bulk={({ selected, clear }) => (
          <>
            <AiSelection
              items={selected.map((row) => ({ kind: 'report', id: row.id, label: row.name }))}
            />
            <Button
              size="sm"
              onClick={() => {
                onSetStatus(selected, 'active')
                clear()
              }}
            >
              Turn on
            </Button>
            <Button
              size="sm"
              onClick={() => {
                onSetStatus(selected, 'paused')
                clear()
              }}
            >
              Turn off
            </Button>
          </>
        )}
        rowMenu={rowMenu}
        onActivate={(row) => handlers.current.open.schedule(row)}
        initialSort={[]}
        summary={(info) =>
          scheduleShowingLine(
            info.matching,
            rows.length,
            filter !== 'all' || info.matching < info.total
          )
        }
        empty={
          !loaded ? null : filter !== 'all' && rows.length > 0 ? (
            <EmptyState
              icon="search"
              title="No schedules match this filter"
              action={
                <Button size="sm" onClick={() => setFilter('all')}>
                  Show all
                </Button>
              }
            />
          ) : (
            <EmptyState
              title="No schedules yet."
              body="New schedule emails a report after each check, weekly, monthly or on a change."
              {...(onNew
                ? {
                    action: (
                      <Button size="sm" icon="plus" onClick={onNew}>
                        New schedule
                      </Button>
                    )
                  }
                : {})}
            />
          )
        }
      />
    </div>
  )
}
