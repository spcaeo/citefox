import { useMemo, useState, type JSX, type MouseEvent } from 'react'
import { useAiContext } from '../assistant/context/useAiContext'
import { Markdown } from '../components/Markdown'
import { errorText } from '../components/errorText'
import { createGridCsvExport } from '../grid/adapters'
import type { GridCsvExport } from '../grid/types'
import { countNoun } from '../m3/model'
import { Drawer, DrawerGrid, DrawerMain, DrawerRail, DrawerSection, SearchBox } from '../ui'
import { drillAiPatch } from './aiContext'
import { drillCsv } from './csv'
import { drillStrip, SEARCH_FROM, shownRows } from './filters'
import { ItemList } from './ItemList'
import { PromptList } from './PromptList'
import { openTarget } from './targets'
import { drillCount, drillNoun, type DrillTarget, type ListDrill } from './types'

function capital(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

export interface DrillDrawerProps {
  drill: ListDrill
  onClose: () => void
  /**
   * True (default) closes the drawer when a row leaves the screen. A drawer on
   * the URL passes false: the route change already closes it, and closing
   * through history would undo the route change.
   */
  closeOnLeave?: boolean
  /** The picked tile, when the URL holds it (`drill.f`). Unset: kept here. */
  filter?: string
  onFilter?: (filter: string) => void
  /** The search text, when the URL holds it (`drill.q`). Unset: kept here. */
  query?: string
  onQuery?: (query: string) => void
  /** Tests only. Production writes through `grid:exportCsv`. */
  exportCsv?: GridCsvExport
}

/**
 * The one drill drawer (REPORT-SPEC "Interaction model", NFR-14) in the
 * shared Drawer frame (Docs/DRAWER.md). Lists exactly the rows behind the
 * number that opened it, so its total equals that number. Prompt rows open
 * Prompt detail in the drawer's market and check, and expand to the AI
 * Overview text and sources. Other kinds (links, claims, pages, domains,
 * checks) list `DrillItem`s.
 *
 * Main column: the list with its search. Rail: what the number counts, the
 * tiles that filter the list, and how to read it. Footer: the count rule,
 * Close, and the CSV icon (top right), whose file holds exactly the rows shown.
 */
export function DrillDrawer({
  drill,
  onClose,
  closeOnLeave = true,
  filter: givenFilter,
  onFilter,
  query: givenQuery,
  onQuery,
  exportCsv
}: DrillDrawerProps): JSX.Element {
  const [ownFilter, setOwnFilter] = useState<string>('all')
  const [ownQuery, setOwnQuery] = useState('')
  const filter = givenFilter ?? ownFilter
  const query = givenQuery ?? ownQuery
  const [csvNote, setCsvNote] = useState<string | null>(null)
  const writeCsv = useMemo(() => exportCsv ?? createGridCsvExport(), [exportCsv])
  const total = drillCount(drill)
  const noun = drillNoun(drill)
  const { scope } = drill

  const { prompts: shownPrompts, items: shownItems } = shownRows(drill, filter, query)
  const shownCount = drill.kind === 'prompts' ? shownPrompts.length : shownItems.length
  const strip = drillStrip(drill, noun)
  const filterLabel = strip.find((item) => item.id === filter)?.label ?? ''
  const narrowed = filter !== 'all' || query.trim() !== ''
  const totalNoun = countNoun(total, noun[0], noun[1])
  useAiContext(
    drillAiPatch({
      title: drill.title,
      scope,
      total,
      noun,
      filters: {
        ...(filter !== 'all' && filterLabel ? { show: filterLabel } : {}),
        ...(query.trim() ? { search: query.trim() } : {})
      }
    })
  )

  function setFilter(next: string): void {
    if (givenFilter === undefined) setOwnFilter(next)
    onFilter?.(next)
  }

  function setQuery(next: string): void {
    if (givenQuery === undefined) setOwnQuery(next)
    onQuery?.(next)
  }

  function open(target: DrillTarget): void {
    openTarget(target)
    if (closeOnLeave && target.kind !== 'url' && target.kind !== 'drawer') onClose()
  }

  function onBodyClick(event: MouseEvent<HTMLDivElement>): void {
    // An in-app link leaves this screen: close now rather than wait for the
    // route change, which a quick Back can undo before it is rendered.
    if (closeOnLeave && (event.target as HTMLElement).closest('a[href^="#"]')) onClose()
  }

  async function onExport(): Promise<void> {
    setCsvNote(null)
    try {
      const shown = drill.kind === 'prompts' ? shownPrompts : shownItems
      const result = await writeCsv(drillCsv(drill, shown))
      if (result.ok) {
        setCsvNote(`Saved ${countNoun(result.rowCount, 'row', 'rows')} to ${result.fileName}.`)
      } else if (result.reason === 'failed') {
        setCsvNote(result.message)
      }
    } catch (cause) {
      setCsvNote(errorText(cause, 'Could not export these rows.'))
    }
  }

  function showAll(): void {
    setFilter('all')
    setQuery('')
  }

  const scopeParts = [scope.marketLabel, scope.checkDateLabel].filter((part) => part.length > 0)
  const shownNoun = countNoun(shownCount, noun[0], noun[1])
  const exportLabel = `Export CSV of ${shownCount === 1 ? `this ${noun[0]}` : `these ${shownNoun}`}`
  const subtitle = [`${capital(noun[1])} behind this number`, ...scopeParts].join(' · ')

  const search =
    total >= SEARCH_FROM ? (
      <SearchBox
        className="drill-search"
        label={`Search ${totalNoun}`}
        value={query}
        onChange={setQuery}
      />
    ) : null

  return (
    <Drawer
      id="drill"
      title={drill.title}
      heading={
        <span className="drill-title num">
          {drill.omitCount ? drill.title : `${drill.title} · ${totalNoun}`}
        </span>
      }
      subtitle={subtitle}
      className="drill-drawer"
      attributes={{ 'data-drill': drill.id }}
      focusOnOpen="close"
      focusKey={drill.id}
      onClose={onClose}
      footer={{
        summary: (
          <span className="drill-foot-notes">
            <span>Counts match the number you clicked.</span>
            {csvNote ? <span className="drill-csv-note">{csvNote}</span> : null}
          </span>
        ),
        cancel: 'Close'
      }}
      tools={[
        {
          id: 'csv',
          kind: 'csv',
          label: exportLabel,
          disabled: shownCount === 0,
          onClick: () => void onExport()
        }
      ]}
    >
      <div className="drill-body" onClick={onBodyClick}>
        <DrawerGrid>
          <DrawerMain>
            <DrawerSection
              title={capital(noun[1])}
              count={narrowed ? `${shownCount} of ${total}` : total}
              actions={search}
              className="drill-list"
            >
              {narrowed ? (
                <p className="drill-filtered" role="status">
                  Showing {shownCount} of {totalNoun}
                  {filter !== 'all' ? ` · ${filterLabel}` : ''}
                  {query.trim() ? ` · “${query.trim()}”` : ''}{' '}
                  <button type="button" className="drill-link" onClick={showAll}>
                    Show all
                  </button>
                </p>
              ) : null}
              {drill.kind === 'prompts' ? (
                <PromptList
                  label={`${drill.title} list`}
                  rows={shownPrompts}
                  scope={scope}
                  onOpen={open}
                />
              ) : (
                <ItemList
                  label={`${drill.title} list`}
                  primaryLabel={drill.primaryLabel}
                  columns={drill.columns ?? []}
                  items={shownItems}
                  onOpen={open}
                />
              )}
              {shownCount === 0 ? (
                <p className="drill-empty">
                  {total === 0 ? `No ${noun[1]} behind this number.` : `No ${noun[1]} match.`}
                </p>
              ) : null}
            </DrawerSection>
          </DrawerMain>
          <DrawerRail>
            {drill.insight ? (
              <DrawerSection title="What stands out">
                <p className="drill-insight" data-testid="drill-insight">
                  {drill.insight}
                </p>
              </DrawerSection>
            ) : null}
            <DrawerSection title="What this number counts">
              <div className="drill-desc">
                <Markdown baseLevel={4}>{drill.description}</Markdown>
              </div>
            </DrawerSection>
            {strip.length > 0 ? (
              <DrawerSection
                title="Filter the list"
                description="Pick a tile to show only those rows. Pick it again to show all."
              >
                <div className="drill-stats" role="group" aria-label="Filter this list">
                  {strip.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className="drill-stat"
                      aria-pressed={filter === item.id}
                      disabled={item.value === 0 && item.id !== 'all'}
                      onClick={() => setFilter(filter === item.id ? 'all' : item.id)}
                    >
                      <span className="drill-stat-value num">{item.value}</span>
                      <span className="drill-stat-label">{item.label}</span>
                    </button>
                  ))}
                </div>
              </DrawerSection>
            ) : null}
            <DrawerSection title="How to read the list">
              <p className="drill-small">
                {drill.kind === 'prompts'
                  ? `Gap = an AI Overview that doesn't cite this page. Named = ${scope.brand} appears in the answer. Position is where ${scope.domain} sits in the overview's sources (1 = first). Select a question to open it, or expand it to read the overview.`
                  : (drill.note ?? 'Select a row to open it.')}
              </p>
            </DrawerSection>
          </DrawerRail>
        </DrawerGrid>
      </div>
    </Drawer>
  )
}
