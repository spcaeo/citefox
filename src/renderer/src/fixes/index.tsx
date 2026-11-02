import type { ProjectFix } from '@shared/ipc'
import { useEffect, useMemo, type JSX, type ReactNode } from 'react'
import { rollupPageFixes } from '@shared/page-fixes'
import type { AssistClient } from '../assist/client'
import { ChangesView } from '../changes'
import { LoadError } from '../components/LoadError'
import { DrillHost } from '../drill'
import { LostGround } from '../lostGround'
import { openDrawer } from '../shell/drawers'
import { SectionFrame } from '../shell/SectionFrame'
import { Dropdown, TabPanel, Tabs } from '../ui'
import { useHashQuery } from '../utils/hashQuery'
import { Backlinks } from './backlinks/Backlinks'
import { newFixValues, viewFixValues } from './drawer/model'
import { FixLog } from './FixLog'
import { useChangeLedger, type ChangeLedgerState } from './hooks/useChangeLedger'
import { useProjectFixes } from './hooks/useProjectFixes'
import { useProjectSearches } from './hooks/useProjectSearches'
import { legacyFixId, withoutFixParam } from './model'
import { NextRound } from './round/NextRound'
import { createProjectFixesSource, type ProjectFixesSource } from './source'
import { leadLine } from './todo/model'
import { WhatToFix } from './todo/WhatToFix'
import {
  FIXES_TABS,
  fixesView,
  SCREEN_QUERY,
  tabOf,
  viewPatch,
  type FixesTab,
  type FixesView
} from './views'
import './fixes.css'
import './todo/todo.css'

const NO_FIXES: readonly ProjectFix[] = []

const PANEL_ID = 'fixes-views'
const ALL_TOPICS = 'all'

/** The back link of a view reached from Did it work? (Next round, Backlinks, Lost ground). */
const BACK_LABEL: Partial<Record<FixesView, string>> = {
  round: 'Next round',
  backlinks: 'Backlinks',
  lost: 'Lost ground'
}

/**
 * Fixes (project level, Fixes.dc.html): What to fix rolls every search that needs
 * work up into page fixes; Changes made is every logged fix; Did it work? measures
 * each change, with Next round and Backlinks a link away. Every view, filter and
 * open panel is in the route; `?topic=<id>` keeps one topic's or page's searches.
 * "Log a fix" opens the window-wide fix drawer, as every other "Log a fix" does.
 */
export function FixesScreen({
  projectId,
  source,
  assistClient,
  now
}: {
  projectId: string
  source?: ProjectFixesSource
  /** Tests only. Production picks the assist client from the client mode. */
  assistClient?: AssistClient
  /** Clock for "goes live" vs "live" and CSV names. Tests pass a fixed one. */
  now?: Date
}): JSX.Element {
  const client = useMemo(() => source ?? createProjectFixesSource(), [source])
  const [query, setQuery] = useHashQuery(SCREEN_QUERY)
  const view = fixesView(query.view)
  const tab: FixesTab = tabOf(view)
  const ledger = useChangeLedger(client, projectId)
  const fixes = useProjectFixes(client, projectId)
  const searches = useProjectSearches(client, projectId)
  const topic =
    query.topic !== null && searches.data?.sources.some((item) => item.id === query.topic)
      ? query.topic
      : null
  const rollup = useMemo(
    () => (searches.data ? rollupPageFixes(searches.data.searches, topic) : null),
    [searches.data, topic]
  )
  const clock = now ?? new Date()
  const assist = assistClient ? { assistClient } : {}

  // An old `#/fixes?fix=<id>` link opens that fix in the drawer.
  useEffect(() => {
    const legacy = legacyFixId(window.location.hash)
    if (legacy === null) return
    // The old key is the drawer's own `fix`: drop it, then open the drawer in its place.
    window.history.replaceState(window.history.state, '', withoutFixParam(window.location.hash))
    openDrawer('fix', viewFixValues(legacy), { replace: true })
  }, [])

  const tabs = FIXES_TABS.map((item) => {
    const count =
      item.id === 'todo'
        ? rollup?.fixes.length
        : item.id === 'log'
          ? fixes.data?.fixes.length
          : ledger.data?.rows.filter((row) => row.status !== 'too_new').length
    return count === undefined ? item : { ...item, count }
  })
  const topicPicker =
    tab === 'todo' && searches.data && searches.data.sources.length > 1 ? (
      <Dropdown
        size="sm"
        aria-label="Topic"
        value={topic ?? ALL_TOPICS}
        onChange={(next) => setQuery({ topic: next === ALL_TOPICS ? null : next, pf: null })}
        options={[
          { value: ALL_TOPICS, label: 'All topics' },
          ...searches.data.sources.map((item) => ({ value: item.id, label: item.name }))
        ]}
      />
    ) : null

  return (
    <DrillHost>
      <SectionFrame
        title="Fixes"
        subtitle={
          tab === 'todo' && rollup ? leadLine(rollup) : 'Log a change, see what it did, repeat.'
        }
        actions={topicPicker}
        primary={{
          label: 'Log a fix',
          icon: 'plus',
          onClick: () => openDrawer('fix', newFixValues({ pageId: query.page }))
        }}
      >
        <div className="fxp-screen">
          <Tabs
            label="Fixes views"
            size="sm"
            tabs={tabs}
            value={tab}
            onChange={(id) => setQuery(viewPatch(id))}
            panelId={PANEL_ID}
          />
          <TabPanel panelId={PANEL_ID} id={tab} className="fxp-panel">
            {view === 'todo' ? (
              searches.error && searches.data === null ? (
                <LoadError
                  title="Could not load the searches."
                  message={searches.error}
                  onRetry={searches.reload}
                />
              ) : searches.data === null || rollup === null ? (
                <p role="status" className="muted">
                  Loading what to fix…
                </p>
              ) : (
                <WhatToFix
                  data={searches.data}
                  rollup={rollup}
                  projectId={projectId}
                  client={client}
                  query={query}
                  setQuery={setQuery}
                  reload={searches.reload}
                  logged={fixes.data?.fixes ?? NO_FIXES}
                />
              )
            ) : view === 'log' ? (
              <FixLog projectId={projectId} client={client} />
            ) : view === 'lost' ? (
              <BackTo view={view} onBack={() => setQuery(viewPatch('changes'))}>
                {query.lost ? (
                  <LostGround
                    key={query.lost}
                    projectId={projectId}
                    pageId={query.lost}
                    vsRunId={query.vs}
                    editing={query.plan === 'edit'}
                    client={client}
                    {...assist}
                    onVs={(runId) => setQuery({ vs: runId, plan: null })}
                    onEdit={(editing) => setQuery({ plan: editing ? 'edit' : null })}
                    onBack={() => setQuery(viewPatch('changes'))}
                  />
                ) : (
                  <p className="muted" role="status">
                    Pick a page that lost ground on Did it work?.
                  </p>
                )}
              </BackTo>
            ) : (
              <LedgerGate state={ledger}>
                {(data) =>
                  view === 'round' ? (
                    <BackTo view={view} onBack={() => setQuery(viewPatch('changes'))}>
                      <NextRound
                        ledger={data}
                        projectId={projectId}
                        client={client}
                        {...assist}
                        query={query}
                        setQuery={setQuery}
                        reload={ledger.reload}
                      />
                    </BackTo>
                  ) : view === 'backlinks' ? (
                    <BackTo view={view} onBack={() => setQuery(viewPatch('changes'))}>
                      <Backlinks
                        ledger={data}
                        projectId={projectId}
                        client={client}
                        now={clock}
                        reload={ledger.reload}
                      />
                    </BackTo>
                  ) : (
                    <>
                      {/* Next round and Backlinks build on logged fixes: hidden until there is one. */}
                      {data.rows.length > 0 ? (
                        <p className="fxp-more muted">
                          Keep going:{' '}
                          <a href="#/fixes?view=round" onClick={(event) => go(event, 'round')}>
                            Next round
                          </a>{' '}
                          ·{' '}
                          <a
                            href="#/fixes?view=backlinks"
                            onClick={(event) => go(event, 'backlinks')}
                          >
                            Backlinks
                          </a>
                        </p>
                      ) : null}
                      <ChangesView
                        ledger={data}
                        projectId={projectId}
                        client={client}
                        query={query}
                        setQuery={setQuery}
                        reload={ledger.reload}
                      />
                    </>
                  )
                }
              </LedgerGate>
            )}
          </TabPanel>
        </div>
      </SectionFrame>
    </DrillHost>
  )

  function go(event: { preventDefault: () => void }, next: FixesView): void {
    event.preventDefault()
    setQuery(viewPatch(next))
  }
}

/** A view reached from Did it work?, with the way back. */
function BackTo({
  view,
  onBack,
  children
}: {
  view: FixesView
  onBack: () => void
  children: ReactNode
}): JSX.Element {
  return (
    <div className="fxp-sub">
      <p className="fxp-back">
        <a
          href="#/fixes?view=changes"
          onClick={(event) => {
            event.preventDefault()
            onBack()
          }}
        >
          ← Did it work?
        </a>
        <span className="muted"> · {BACK_LABEL[view]}</span>
      </p>
      {children}
    </div>
  )
}

/** Loading and error states of the ledger views; the view renders once it has data. */
function LedgerGate({
  state,
  children
}: {
  state: ChangeLedgerState
  children: (ledger: NonNullable<ChangeLedgerState['data']>) => JSX.Element
}): JSX.Element {
  if (state.error && state.data === null) {
    return (
      <LoadError title="Could not load the changes." message={state.error} onRetry={state.reload} />
    )
  }
  if (state.data === null) {
    return (
      <p role="status" className="muted">
        Loading changes…
      </p>
    )
  }
  return children(state.data)
}
