import { useMemo, type JSX } from 'react'
import type { CommunityScope, Market } from '@shared/domain'
import type { AssistClient } from '../assist/client'
import { useAiContext } from '../assistant/context/useAiContext'
import { DrillHost } from '../drill'
import { sectionHash } from '../shell/routes'
import { marketLabel } from '../shell/model'
import { EmptyState, LinkButton } from '../ui'
import { useHashQuery } from '../utils/hashQuery'
import { CommunitiesBody } from './components/CommunitiesBody'
import { ScopeFilters } from './components/ScopeFilters'
import { tabFromView, type CommunitiesTab } from './utils/tabs'
import { useCommunities } from './hooks/useCommunities'
import { createCommunitiesSource, type CommunitiesSource } from './source'
import type { AssistSlot, MarketChoice } from './types'
import { COMMUNITIES_LEAD } from './utils/messages'
import { plural } from './utils/model'
import './communities.css'

export type { AssistContext, AssistSlot } from './types'
export { ProjectCommunitiesScreen } from './ProjectCommunitiesScreen'

/** Route keys: the open section, `scope=project` and `markets=all` (defaults leave them out). */
const QUERY = ['view', 'scope', 'markets'] as const

/**
 * Communities tab (SRS §4.17) in the v2 results pattern: KPI tiles, then
 * sub-tabs (Source mix, Reddit, YouTube, LinkedIn, Other forums,
 * Opportunities) with list grids, drawn by `CommunitiesBody`, which the
 * project screen (`ProjectCommunitiesScreen`) shares. The market is the page header's; the scope
 * and "All markets" filters sit in the open section's grid toolbar. The
 * section and both filters live in the route (`?view=`, `?scope=`,
 * `?markets=`). Sorts the sources CiteFox already saved with each AI Overview by
 * type: no extra searches (FR-17.1). CiteFox never posts (FR-17.7). Every
 * number, bar and row opens what it counts in the shared drill drawer
 * (REPORT-SPEC "Interaction model", NFR-14).
 */
export function CommunitiesScreen({
  projectId,
  pageId,
  marketId,
  markets,
  source,
  assists,
  assistClient
}: {
  projectId: string
  pageId: string
  /** The page header's market. Null is every market. */
  marketId: string | null
  markets: readonly Market[]
  source?: CommunitiesSource
  /** AI-assist hook point (FR-17.6). Renders nothing unless another module passes a slot. */
  assists?: AssistSlot
  /** The client for "Draft a helpful reply" (FR-17.6). Defaults to the app's. */
  assistClient?: AssistClient
}): JSX.Element {
  const client = useMemo(() => source ?? createCommunitiesSource(), [source])
  const [query, setQuery] = useHashQuery(QUERY)
  const scope: CommunityScope = query.scope === 'project' ? 'project' : 'page'
  const market = markets.find((item) => item.id === marketId) ?? null
  const choice: MarketChoice = query.markets === 'all' || market === null ? 'all' : 'header'
  const tab = tabFromView(query.view)
  const setTab = (next: CommunitiesTab): void => setQuery({ view: next === 'mix' ? null : next })
  const effectiveMarket = choice === 'all' || market === null ? null : market.id
  const state = useCommunities(client, { projectId, scope, pageId, marketId: effectiveMarket })
  const report = state.report
  const marketText =
    effectiveMarket === null || market === null ? 'All markets' : marketLabel(market)
  const scopeLabel =
    report === null
      ? marketText
      : scope === 'page'
        ? `This page · ${marketText}`
        : `${plural(report.pageCount, 'tracked page')} · ${marketText}`
  useAiContext({
    entities:
      effectiveMarket === null || market === null
        ? []
        : [{ kind: 'market', id: market.id, label: marketLabel(market) }],
    filters: { tab, scope: scopeLabel }
  })
  const filters = (
    <ScopeFilters
      scope={scope}
      onScope={(next) => setQuery({ scope: next === 'project' ? 'project' : null })}
      choice={choice}
      onChoice={(next) => setQuery({ markets: next === 'all' ? 'all' : null })}
      hasMarket={market !== null}
      loading={state.loading}
    />
  )

  return (
    <DrillHost resetKey={`${pageId}\0${scope}\0${effectiveMarket ?? ''}`}>
      <div className="cm-screen" aria-busy={state.loading}>
        <div className="cm-intro">
          <p className="cm-lead">{COMMUNITIES_LEAD}</p>
          <LinkButton href={sectionHash('reports')} variant="text">
            Email it weekly
          </LinkButton>
        </div>
        <CommunitiesBody
          client={client}
          state={state}
          scopeLabel={scopeLabel}
          filters={filters}
          empty={
            <EmptyState
              title="No check yet"
              body={`No check yet in ${scope === 'page' ? 'this page' : 'this project'} for ${
                marketText.toLowerCase() === 'all markets' ? 'any market' : marketText
              }. Press Check now, and the sources its AI Overviews cite show up here.`}
            />
          }
          tab={tab}
          onTab={setTab}
          pageId={pageId}
          assists={assists}
          {...(assistClient ? { assistClient } : {})}
        />
      </div>
    </DrillHost>
  )
}
