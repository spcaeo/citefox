import { useEffect, useMemo, useRef, useState, type JSX } from 'react'
import type { Market } from '@shared/domain'
import type { PageDetail } from '@shared/ipc'
import type { AssistClient } from '../assist/client'
import { useAiContext } from '../assistant/context/useAiContext'
import { HeaderActions } from '../components/HeaderActions'
import { LoadError } from '../components/LoadError'
import { DrillHost } from '../drill'
import { pageLabel } from '../projects/copy'
import { ScreenDrawerLevel } from '../shell/DrawerLevel'
import { openDrawer } from '../shell/drawers'
import { marketLabel } from '../shell/model'
import { botParam, Button, Confirm, TabPanel, Tabs, useAssistMenu, wayParam } from '../ui'
import { formatDay } from '../utils/dates'
import { useHashQuery } from '../utils/hashQuery'
import { AddMarketDrawer } from './components/AddMarketDrawer'
import { CitedInstead } from './components/CitedInstead'
import { MarketGrid } from './components/MarketGrid'
import { PromptMatrix } from './components/PromptMatrix'
import { useMarketActions, type MarketActionResult } from './hooks/useMarketActions'
import { useMarketAssist } from './hooks/useMarketAssist'
import { useMarketResults } from './hooks/useMarketResults'
import { createMarketsSource, type MarketsSource } from './source'
import '../m3/m3.css'
import './markets.css'

const PANEL = 'mk-tabs'
type MarketsTab = 'prompts' | 'cited'

/**
 * The screen's state on the route: `?view=cited` (Every prompt has no value),
 * `?panel=add-market` while the Add a market drawer is open, and its ✦ Help me
 * fill this way and bot (`mk.help=describe|chatbot`, `mk.bot=chatgpt`).
 */
const MARKETS_QUERY = ['view', 'panel', 'mk.help', 'mk.bot'] as const
const ADD_PANEL = 'add-market'

/**
 * The page's Markets tab (FR-9.4, FR-9.6, FR-9.7; Mockups/Markets.dc.html): the
 * markets as one list grid whose toolbar holds the search, the one Add market
 * action and the section's AI menu, then sub-tabs for every prompt in every
 * market and the domains cited instead. Add market opens a side panel. The
 * page header's Check now checks every market.
 */
export function MarketsScreen({
  source,
  projectId,
  page,
  onChanged,
  assistClient
}: {
  /** Tests only. Production uses the preload bridge. */
  source?: MarketsSource
  /** Tests only. Production picks the assist client from the client mode. */
  assistClient?: AssistClient
  projectId: string
  page: PageDetail
  /** Reloads the page detail after its market list changed. */
  onChanged: () => void
}): JSX.Element {
  const client = useMemo(() => source ?? createMarketsSource(), [source])
  // The default market first, like the mock-up; the rest keep the page's order.
  const ordered = useMemo(
    () => [
      ...page.markets.filter((market) => market.id === page.defaultMarketId),
      ...page.markets.filter((market) => market.id !== page.defaultMarketId)
    ],
    [page.markets, page.defaultMarketId]
  )
  const { markets, searchesLeft, reload } = useMarketResults(client, projectId, page.id, ordered)
  const actions = useMarketActions(client, projectId, page, onChanged)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  /** True when this screen pushed the drawer's history entry, so closing goes back over it. */
  const openedHere = useRef(false)
  /** The entries pushed while the drawer is open (opening it, then each way picked). */
  const trail = useRef<string[]>([])
  const [query, setQuery] = useHashQuery(MARKETS_QUERY)
  const tab: MarketsTab = query.view === 'cited' ? 'cited' : 'prompts'
  const adding = query.panel === ADD_PANEL
  const [removing, setRemoving] = useState<Market | null>(null)
  const assistScope = {
    projectId,
    pageId: page.id,
    ...(assistClient ? { client: assistClient } : {})
  }
  const suggest = useAssistMenu({
    label: 'AI actions for markets',
    scope: assistScope,
    actions: [{ assistId: 'markets.suggest', label: 'Suggest markets to add', icon: 'compass' }]
  })
  const perMarket = useMarketAssist(assistScope)
  const prompts = page.promptCount
  const latest = (markets ?? [])
    .map((entry) => entry.results?.run?.finishedAt ?? null)
    .filter((value): value is string => value !== null)
    .sort()
    .at(-1)
  const defaultMarket = page.markets.find((market) => market.id === page.defaultMarketId) ?? null
  useAiContext({
    entities: [{ kind: 'page', id: page.id, label: pageLabel(page) }],
    filters: { tab: tab === 'cited' ? 'Cited instead' : 'Every question' },
    facts: defaultMarket ? [`Default market: ${marketLabel(defaultMarket)}`] : []
  })

  async function report(work: Promise<MarketActionResult>): Promise<void> {
    setError(null)
    const result = await work
    if (!result.ok) setError(result.message)
  }

  function openAddForm(): void {
    setNotice(null)
    openedHere.current = true
    setQuery({ panel: ADD_PANEL })
    trail.current = [window.location.hash]
  }

  // Back inside the drawer (to the other way) leaves fewer entries to go back over.
  useEffect(() => {
    function onPop(): void {
      const at = trail.current.lastIndexOf(window.location.hash)
      if (at >= 0) trail.current = trail.current.slice(0, at + 1)
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  /**
   * Back closes the drawer, so ✕ and Escape go back over the entry Add market
   * pushed (no dead Back step). A pasted link has none: the URL is rewritten.
   */
  function closeAddForm(): void {
    if (openedHere.current) {
      openedHere.current = false
      window.history.go(-Math.max(1, trail.current.length))
      trail.current = []
    } else {
      setQuery({ panel: null, 'mk.help': null, 'mk.bot': null }, { replace: true })
    }
  }

  const failed = (markets ?? []).filter((entry) => entry.error)

  return (
    <DrillHost>
      <div className="page-stack mk-screen" data-testid="markets-tab">
        <p className="muted mk-intro">
          Each market is checked and scored on its own, with its own baseline.
          {latest ? ` Last checked ${formatDay(latest)}.` : ''}
        </p>
        {error ? (
          <p className="bridge-alert" role="alert">
            {error}
          </p>
        ) : null}
        {notice ? (
          <p className="mk-message" role="status">
            {notice}
          </p>
        ) : null}
        {removing ? (
          <Confirm
            title={`Remove ${marketLabel(removing)}?`}
            body="This page stops being checked in this market. Its stored checks are not deleted."
            confirmLabel="Remove market"
            cancelLabel="Keep it"
            busy={actions.busy}
            testId="mk-confirm-remove"
            onCancel={() => setRemoving(null)}
            onConfirm={() => {
              const id = removing.id
              setRemoving(null)
              void report(actions.remove(id))
            }}
          />
        ) : null}
        {failed.map((entry) => (
          <LoadError
            key={entry.market.id}
            title={`Could not load results for ${marketLabel(entry.market)}.`}
            message={entry.error ?? ''}
            onRetry={reload}
          />
        ))}
        {markets === null ? (
          <p role="status">Loading markets…</p>
        ) : (
          <>
            <MarketGrid
              pageId={page.id}
              markets={markets}
              defaultMarketId={page.defaultMarketId}
              prompts={prompts}
              samples={page.samples}
              busy={actions.busy}
              ai={suggest.menu}
              add={
                <>
                  <Button size="sm" icon="plus" onClick={openAddForm}>
                    Add market
                  </Button>
                  <HeaderActions
                    moreLabel="Markets actions"
                    more={[
                      {
                        id: 'mk-import',
                        label: 'Import markets',
                        icon: 'upload',
                        onSelect: () =>
                          openDrawer(
                            'import',
                            { 'import.entity': 'markets', 'import.target': page.id },
                            { onResult: () => void reload() }
                          )
                      }
                    ]}
                  />
                </>
              }
              actions={{
                onCheck: (market) => void report(actions.check([market.id])),
                onRemove: setRemoving,
                onMakeDefault: (market) => void report(actions.makeDefault(market.id)),
                onAssist: perMarket.start
              }}
            />
            {suggest.card}
            {perMarket.card}
          </>
        )}
        <div className="mk-tabs">
          <Tabs
            label="Markets sections"
            size="sm"
            panelId={PANEL}
            value={tab}
            onChange={(next) => setQuery({ view: next === 'prompts' ? null : next })}
            tabs={[
              { id: 'prompts', label: 'Every question' },
              { id: 'cited', label: 'Cited instead' }
            ]}
          />
          {tab === 'prompts' ? (
            <TabPanel panelId={PANEL} id="prompts" className="mk-panel">
              {markets === null ? null : <PromptMatrix pageId={page.id} markets={markets} />}
            </TabPanel>
          ) : (
            <TabPanel panelId={PANEL} id="cited" className="mk-panel">
              {markets === null ? null : <CitedInstead pageId={page.id} markets={markets} />}
            </TabPanel>
          )}
        </div>
        {adding ? (
          <ScreenDrawerLevel onClose={closeAddForm}>
            <AddMarketDrawer
              projectId={projectId}
              pageId={page.id}
              help={{
                way: wayParam(query['mk.help']),
                // A way is a history entry (Back returns to the other way); a bot is rewritten in place.
                onWay: (way) => {
                  const before = window.location.hash
                  setQuery({ 'mk.help': way })
                  const after = window.location.hash
                  if (openedHere.current && after !== before) trail.current.push(after)
                },
                bot: botParam(query['mk.bot']),
                onBot: (bot) => setQuery({ 'mk.bot': bot }, { replace: true })
              }}
              defaultMarket={defaultMarket}
              tracked={ordered}
              prompts={prompts}
              samples={page.samples}
              searchesLeft={searchesLeft}
              busy={actions.busy}
              onAdd={actions.add}
              onClose={(added) => {
                if (added) setNotice('Market added. Its baseline starts on its first check.')
                closeAddForm()
              }}
            />
          </ScreenDrawerLevel>
        ) : null}
      </div>
    </DrillHost>
  )
}
