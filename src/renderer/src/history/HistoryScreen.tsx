import { useCallback, useEffect, useMemo, useState, type JSX } from 'react'
import type { HistoryEvent, Market, PageHistory } from '@shared/domain'
import { useAiContext } from '../assistant/context/useAiContext'
import { Icon } from '../components/Icon'
import { DrillHost } from '../drill'
import { DrawerLevel } from '../shell/DrawerLevel'
import { closeDrawer, openDrawer, useDrawerEntry, useDrawerStack } from '../shell/drawers'
import { useEngineRevision } from '../shell/engineRevision'
import { marketLabel } from '../shell/model'
import { pageHash } from '../shell/routes'
import { createHistorySource, type HistorySource } from './client'
import { CompareDialog, type CompareTarget } from './CompareDialog'
import type { HistoryDrillContext } from './historyDrills'
import { EventDrawer } from './EventDrawer'
import { HistoryGrid } from './HistoryGrid'
import { HistoryKpis } from './HistoryKpis'
import { HistoryTimeline, type NoteActions } from './HistoryTimeline'
import {
  eventNoteMode,
  KIND_FILTERS,
  filterByKind,
  kindCounts,
  kindLabel,
  newestFirst,
  statusLine,
  todayLocal,
  type EventNoteMode,
  type KindFilter
} from './model'
import { NoteDrawer } from './NoteDrawer'
import { VersionsPanel } from '../pageChanges/VersionsPanel'
import {
  bridgeResultsSource,
  checkRunIds,
  useRunResults,
  type RunResultsSource
} from './runResults'
import { Button, EmptyState, IconButton, SegmentedControl, TabPanel, Tabs } from '../ui'
import { useHashQuery } from '../utils/hashQuery'
import { errorText } from '../components/errorText'
import './history.css'

type HistoryTab = 'events' | 'timeline' | 'versions'

const PANELS = 'hist-tabs'
/**
 * The view and the kind filter are on the route (`?view=timeline&show=note`,
 * `?view=versions` for Page versions); Events and All have no value.
 */
const HISTORY_QUERY = ['view', 'show'] as const

function kindFrom(value: string | null): KindFilter {
  return KIND_FILTERS.find((item) => item.id === value)?.id ?? 'all'
}

/**
 * What an AI assist gets from History. FR-15.4 ("What changed and did it help?")
 * is built by the generic assist machinery (another engineer); it plugs in through
 * `renderAssist` and can save its summary with `addNote`.
 */
export interface HistoryAssistContext {
  events: readonly HistoryEvent[]
  addNote: (text: string) => Promise<void>
}

/**
 * History and notes tab (FR-15.1–15.3, Mockups/History.dc.html). Every number
 * drills (REPORT-SPEC "Interaction model"): a check's score and "View results"
 * open Results for that check, its counts open the prompts behind them.
 */
export function HistoryScreen(props: HistoryScreenProps): JSX.Element {
  return (
    <DrillHost>
      <HistoryBody {...props} />
    </DrillHost>
  )
}

interface HistoryScreenProps {
  source?: HistorySource
  /**
   * `results:get`, so a check's numbers open its prompts. Defaults to the
   * preload bridge; null (or no bridge) leaves those numbers as plain text.
   */
  resultsSource?: RunResultsSource | null
  projectId: string
  pageId: string
  /** Null is the page's default market. Checks are this market's; other events are page-wide. */
  marketId: string | null
  markets?: readonly Market[]
  /** Hook point for FR-15.4. Default renders nothing. */
  renderAssist?: (context: HistoryAssistContext) => JSX.Element | null
}

function HistoryBody({
  source,
  resultsSource,
  projectId,
  pageId,
  marketId,
  markets = [],
  renderAssist
}: HistoryScreenProps): JSX.Element {
  const client = useMemo(() => source ?? createHistorySource(), [source])
  const results = useMemo(
    () => (resultsSource === undefined ? bridgeResultsSource() : resultsSource),
    [resultsSource]
  )
  const revision = useEngineRevision()
  const [history, setHistory] = useState<PageHistory | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loadedKey, setLoadedKey] = useState<string | null>(null)
  const [reloads, setReloads] = useState(0)
  const [query, setQuery] = useHashQuery(HISTORY_QUERY)
  const tab: HistoryTab =
    query.view === 'timeline' ? 'timeline' : query.view === 'versions' ? 'versions' : 'events'
  const setTab = (next: HistoryTab): void => setQuery({ view: next === 'events' ? null : next })
  const kind = kindFrom(query.show)
  const setKind = (next: KindFilter): void => setQuery({ show: next === 'all' ? null : next })
  // The event and Add a note are drawers on the URL (`drawer=hist-event&he.id=…`, `drawer=hist-note`).
  const eventDrawer = useDrawerEntry('hist-event')
  const noteDrawer = useDrawerEntry('hist-note')
  const openId = eventDrawer?.entry.params['he.id'] ?? null
  // Compare content is a drawer on the URL (`drawer=compare&read-from=…&read-to=…`).
  const drawers = useDrawerStack()
  const compareDepth = drawers.stack.findIndex((entry) => entry.id === 'compare')
  const compareEntry = compareDepth >= 0 ? drawers.stack[compareDepth] : undefined
  const compareFrom = compareEntry?.params['read-from'] ?? null
  const compareTo = compareEntry?.params['read-to'] ?? null
  const compare = useMemo<CompareTarget | null>(
    () =>
      compareFrom && compareTo ? { fromSnapshotId: compareFrom, toSnapshotId: compareTo } : null,
    [compareFrom, compareTo]
  )
  const [editingId, setEditingId] = useState<string | null>(null)
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [announce, setAnnounce] = useState('')
  const requestKey = `${projectId}\0${pageId}\0${marketId ?? ''}`

  useEffect(() => {
    let cancelled = false
    void Promise.resolve()
      .then(() => client['history:list']({ projectId, pageId, marketId }))
      .then(
        (next) => {
          if (cancelled) return
          setHistory(next)
          setError(null)
          setLoadedKey(requestKey)
        },
        (cause: unknown) => {
          if (cancelled) return
          setHistory(null)
          setError(errorText(cause, 'Could not load the history.'))
          setLoadedKey(requestKey)
        }
      )
    return () => {
      cancelled = true
    }
  }, [client, projectId, pageId, marketId, requestKey, revision, reloads])

  const reload = useCallback(() => setReloads((value) => value + 1), [])
  const runIds = useMemo(() => checkRunIds(history?.events ?? []), [history])
  const runs = useRunResults(
    results,
    projectId,
    pageId,
    history?.marketId ?? null,
    runIds,
    revision
  )

  const addNote = useCallback(
    async (date: string, text: string): Promise<void> => {
      await client['history:addNote']({ projectId, pageId, date, text })
      setAnnounce('Note added to the timeline.')
      reload()
    },
    [client, projectId, pageId, reload]
  )

  const assistContext = useMemo<HistoryAssistContext>(
    () => ({
      events: history?.events ?? [],
      addNote: (text) => addNote(todayLocal(), text)
    }),
    [history, addNote]
  )

  const shownMarket = markets.find((item) => item.id === history?.marketId)
  const eventCounts = kindCounts(history?.events ?? [])
  const openEvent = history?.events.find((event) => event.id === openId) ?? null
  useAiContext({
    entities: [
      ...(shownMarket
        ? [{ kind: 'market' as const, id: shownMarket.id, label: marketLabel(shownMarket) }]
        : []),
      ...(openEvent?.check
        ? [{ kind: 'check' as const, id: openEvent.check.runId, label: openEvent.title }]
        : [])
    ],
    filters: kind === 'all' ? {} : { show: kindLabel(kind) },
    numbers: history
      ? KIND_FILTERS.map((item) => ({ label: item.label, value: String(eventCounts[item.id]) }))
      : []
  })

  if (loadedKey !== requestKey || (!history && !error)) {
    return <p role="status">Loading history…</p>
  }
  if (!history) {
    return (
      <p className="bridge-alert" role="alert">
        {error}
      </p>
    )
  }

  const all = history.events
  const counts = kindCounts(all)
  const shown = filterByKind(all, kind)
  const timeline = newestFirst(shown)
  const market = markets.find((item) => item.id === history.marketId)
  const drills: HistoryDrillContext = { pageId, marketId: history.marketId, market, runs }
  const noteActions: NoteActions = {
    editingId,
    confirmingId,
    onEdit: (id) => {
      setConfirmingId(null)
      setEditingId(id)
    },
    onConfirmDelete: (id) => {
      setEditingId(null)
      setConfirmingId(id)
    },
    onSave: saveNote,
    onDelete: async (noteId) => {
      await deleteNote(noteId)
    }
  }

  async function saveNote(noteId: string, date: string, text: string): Promise<void> {
    await client['history:updateNote']({ projectId, noteId, date, text })
    setEditingId(null)
    setAnnounce('Note updated.')
    reload()
  }

  async function deleteNote(noteId: string): Promise<boolean> {
    try {
      await client['history:deleteNote']({ projectId, noteId })
      setConfirmingId(null)
      setAnnounce('Note deleted.')
      reload()
      return true
    } catch (cause) {
      setAnnounce(errorText(cause, 'Could not delete the note.'))
      return false
    }
  }

  function showEvent(event: HistoryEvent, mode: EventNoteMode = 'view'): void {
    openDrawer('hist-event', { 'he.id': event.id, 'he.note': mode === 'view' ? null : mode })
  }

  function openCompare(target: CompareTarget): void {
    // Over the event drawer when it is open (Back returns to the event).
    openDrawer('compare', { 'read-from': target.fromSnapshotId, 'read-to': target.toSnapshotId })
  }

  function showKind(next: KindFilter): void {
    setKind(next)
  }

  const kindOptions = KIND_FILTERS.map((item) => ({
    value: item.id,
    label: item.label,
    count: counts[item.id]
  }))

  return (
    <div className="hist-screen">
      <div className="hist-lead">
        <p className="muted">
          Checks, page changes, question sets and your notes for this page.
          {market ? ` Checks are from ${marketLabel(market)}.` : ''}
        </p>
        <div className="hist-lead-actions">
          <a className="hist-link" href={pageHash(pageId, 'progress')}>
            <Icon name="activity" /> See the progress chart and fix results
          </a>
          <IconButton icon="plus" tip label="Add note" onClick={() => openDrawer('hist-note')} />
        </div>
      </div>
      {renderAssist ? renderAssist(assistContext) : null}
      <HistoryKpis events={all} counts={counts} context={drills} onKind={showKind} />
      <div className="hist-main">
        <Tabs
          label="History views"
          panelId={PANELS}
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'events', label: 'Events', count: all.length },
            { id: 'timeline', label: 'Timeline' },
            { id: 'versions', label: 'Page versions' }
          ]}
        />
        {tab === 'versions' ? (
          <TabPanel panelId={PANELS} id="versions" className="hist-panel-body">
            <VersionsPanel projectId={projectId} pageId={pageId} />
          </TabPanel>
        ) : tab === 'events' ? (
          <TabPanel panelId={PANELS} id="events" className="hist-panel-body">
            <HistoryGrid
              events={shown}
              counts={counts}
              kind={kind}
              onKind={showKind}
              context={drills}
              actions={{
                onOpen: (event) => showEvent(event),
                onCompare: openCompare,
                onEditNote: (event) => showEvent(event, 'edit'),
                onDeleteNote: (event) => showEvent(event, 'delete')
              }}
            />
          </TabPanel>
        ) : (
          <TabPanel panelId={PANELS} id="timeline" className="hist-panel-body">
            <SegmentedControl
              label="Show events"
              size="sm"
              options={kindOptions}
              value={kind}
              onChange={showKind}
            />
            <p className="muted" role="status">
              {statusLine(kind, shown.length, all.length, 'timeline')}
            </p>
            {shown.length === 0 ? (
              <EmptyState
                title="Nothing of this kind yet for this page."
                action={
                  kind === 'all' ? undefined : (
                    <Button size="sm" onClick={() => setKind('all')}>
                      Show all events
                    </Button>
                  )
                }
              />
            ) : (
              <HistoryTimeline
                events={timeline}
                context={drills}
                notes={noteActions}
                onCompare={openCompare}
              />
            )}
          </TabPanel>
        )}
      </div>
      <p className="sr-only" role="status" aria-live="polite">
        {announce}
      </p>
      {noteDrawer ? (
        <DrawerLevel depth={noteDrawer.depth}>
          <NoteDrawer
            events={all}
            context={drills}
            onAdd={addNote}
            onClose={() => noteDrawer.close()}
          />
        </DrawerLevel>
      ) : null}
      {eventDrawer ? (
        <DrawerLevel depth={eventDrawer.depth}>
          <EventDrawer
            event={all.find((event) => event.id === openId) ?? null}
            events={all}
            context={drills}
            mode={eventNoteMode(eventDrawer.entry.params['he.note'])}
            onMode={(mode) => eventDrawer.setParams({ 'he.note': mode === 'view' ? null : mode })}
            onCompare={openCompare}
            onSaveNote={async (noteId, date, text) => {
              await client['history:updateNote']({ projectId, noteId, date, text })
              setAnnounce('Note updated.')
              reload()
            }}
            onDeleteNote={async (noteId) => {
              if (await deleteNote(noteId)) eventDrawer.close()
            }}
            onClose={() => eventDrawer.close()}
          />
        </DrawerLevel>
      ) : null}
      {compare ? (
        <DrawerLevel depth={compareDepth}>
          <CompareDialog
            source={client}
            projectId={projectId}
            pageId={pageId}
            target={compare}
            onClose={() => closeDrawer(compareDepth)}
          />
        </DrawerLevel>
      ) : null}
    </div>
  )
}
