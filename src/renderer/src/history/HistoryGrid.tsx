import { useMemo, type JSX } from 'react'
import type { HistoryEvent } from '@shared/domain'
import { askColumn } from '../assistant/sparkle/askColumn'
import { Markdown } from '../components/Markdown'
import { openTarget } from '../drill'
import { Chip, EmptyState, ListGrid, type ListColumn, type MenuItem } from '../ui'
import type { CompareTarget } from './CompareDialog'
import { ChangedCount, ChangeValue, ScoreLink } from './EventParts'
import { checkTarget, fixTarget, promptsTarget, type HistoryDrillContext } from './historyDrills'
import {
  KIND_FILTERS,
  eventDay,
  eventMonth,
  eventSearchText,
  fullDay,
  kindLabel,
  monthsNewestFirst,
  typeLabel,
  type KindFilter
} from './model'

/** What a row can ask the screen to do. */
export interface HistoryRowActions {
  /** Opens the event's detail panel. */
  onOpen: (event: HistoryEvent) => void
  onCompare: (target: CompareTarget) => void
  onEditNote: (event: HistoryEvent) => void
  onDeleteNote: (event: HistoryEvent) => void
}

/**
 * History as the v2 list grid (FR-15.1): one row per event, grouped by month,
 * newest first. Date, Type and Score sort (Shift adds a sort); the kind filter
 * and search sit in the toolbar. A check's score opens Results for that check
 * and "N changed" opens the prompts behind it; every other action is in the
 * row menu or the detail panel a row opens.
 */
export function HistoryGrid({
  events,
  counts,
  kind,
  onKind,
  context,
  actions
}: {
  /** Events of the picked kind. */
  events: readonly HistoryEvent[]
  counts: Readonly<Record<KindFilter, number>>
  kind: KindFilter
  onKind: (kind: KindFilter) => void
  context: HistoryDrillContext
  actions: HistoryRowActions
}): JSX.Element {
  const columns = useMemo(
    (): ListColumn<HistoryEvent>[] => [
      {
        id: 'date',
        label: 'Date',
        width: 112,
        sort: (event) => event.at,
        render: (event) => <span title={fullDay(event)}>{eventDay(event)}</span>
      },
      {
        id: 'type',
        label: 'Type',
        width: 150,
        sort: (event) => typeLabel(event).toLowerCase(),
        // Plain text, as on Check history: a pill on every row adds nothing (R7).
        render: (event) => typeLabel(event)
      },
      {
        id: 'event',
        label: 'Event',
        width: 'fill',
        minWidth: 240,
        render: (event) => <EventCell event={event} />
      },
      {
        id: 'score',
        label: 'Score',
        width: 88,
        numeric: true,
        sort: (event) => event.check?.score ?? null,
        render: (event) =>
          event.check ? (
            <ScoreLink check={event.check} event={event} context={context} bare />
          ) : (
            <span className="faint">—</span>
          )
      },
      {
        id: 'change',
        label: 'Change',
        width: 88,
        numeric: true,
        sort: (event) => event.check?.scoreChange ?? null,
        render: (event) =>
          event.check ? <ChangeValue check={event.check} /> : <span className="faint">—</span>
      },
      {
        id: 'changed',
        label: 'Questions changed',
        width: 140,
        numeric: true,
        render: (event) =>
          event.check ? (
            <ChangedCount check={event.check} context={context} />
          ) : (
            <span className="faint">—</span>
          )
      },
      askColumn((event) =>
        event.check
          ? { kind: 'check', id: event.check.runId, label: `${event.title} · ${fullDay(event)}` }
          : event.fix
            ? { kind: 'fix', id: event.fix.id, label: event.title }
            : null
      )
    ],
    [context]
  )

  function rowMenu(event: HistoryEvent): MenuItem[] {
    const items: MenuItem[] = [
      { id: 'open', label: 'Open details', icon: 'eye', onSelect: () => actions.onOpen(event) }
    ]
    const check = event.check
    if (check) {
      items.push({
        id: 'results',
        label: 'View results',
        icon: 'arrow-right',
        onSelect: () => openTarget(checkTarget(context, check))
      })
    }
    const content = event.content
    const from = content?.fromSnapshotId ?? null
    if (content && from !== null) {
      items.push({
        id: 'compare',
        label: 'Compare content',
        icon: 'layers',
        onSelect: () =>
          actions.onCompare({ fromSnapshotId: from, toSnapshotId: content.toSnapshotId })
      })
    }
    const fix = event.fix
    if (fix) {
      items.push({
        id: 'fix',
        label: `Open fix ${fix.number}`,
        icon: 'wand',
        onSelect: () => openTarget(fixTarget(context, fix))
      })
    }
    if (event.promptSet) {
      items.push({
        id: 'prompts',
        label: 'Open questions',
        icon: 'arrow-right',
        onSelect: () => openTarget(promptsTarget(context))
      })
    }
    if (event.note) {
      items.push(
        {
          id: 'edit',
          label: 'Edit note',
          icon: 'pencil',
          onSelect: () => actions.onEditNote(event)
        },
        {
          id: 'delete',
          label: 'Delete note',
          icon: 'trash',
          tone: 'danger',
          onSelect: () => actions.onDeleteNote(event)
        }
      )
    }
    if (kind !== event.primary) {
      items.push({
        id: 'only',
        label: `Show only ${kindLabel(event.primary)}`,
        icon: 'sliders',
        onSelect: () => onKind(event.primary)
      })
    }
    return items
  }

  return (
    <ListGrid<HistoryEvent>
      urlKey="hist"
      label="Page history"
      noun={['event', 'events']}
      rows={events}
      rowKey={(event) => event.id}
      rowLabel={(event) => `${typeLabel(event)} ${fullDay(event)}`}
      columns={columns}
      search={{ text: eventSearchText, placeholder: 'Search events' }}
      filter={{
        label: 'Show events',
        options: KIND_FILTERS.map((item) => ({
          value: item.id,
          label: item.label,
          count: counts[item.id]
        })),
        value: kind,
        onChange: (value) => onKind(value as KindFilter),
        resetValue: 'all'
      }}
      group={{ key: eventMonth, order: monthsNewestFirst(events) }}
      rowMenu={rowMenu}
      onActivate={actions.onOpen}
      initialSort={[{ key: 'date', dir: 'desc' }]}
      empty={<EmptyState icon="inbox" title="Nothing of this kind yet for this page." />}
    />
  )
}

/** The Event cell: one line of title (or note text) and small tags. */
function EventCell({ event }: { event: HistoryEvent }): JSX.Element {
  const check = event.check
  const fix = event.fix
  return (
    <span className="hist-cell-line">
      <span className="hist-cell-title">
        <Markdown inline baseLevel={4}>
          {event.note ? event.note.text : event.title}
        </Markdown>
      </span>
      {event.content ? (
        <Chip size="sm" tone="warn">
          {event.content.fromSnapshotId === null ? 'First read' : 'Content changed'}
        </Chip>
      ) : null}
      {check?.partial ? (
        <Chip size="sm" tone="warn">
          Partial
        </Chip>
      ) : null}
      {fix ? (
        <Chip size="sm" tone="ok">
          {fix.planned ? 'Planned fix' : 'Fix'} {fix.number}
        </Chip>
      ) : null}
    </span>
  )
}
