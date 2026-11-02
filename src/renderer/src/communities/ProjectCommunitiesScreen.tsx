import { useMemo, type JSX } from 'react'
import type { Market, PageSummary } from '@shared/domain'
import type { AssistClient } from '../assist/client'
import { useAiContext } from '../assistant/context/useAiContext'
import { DrillHost } from '../drill'
import { addStartHash, navigateHash, sectionHash } from '../shell/routes'
import { SectionFrame } from '../shell/SectionFrame'
import { EmptyState, LinkButton, ToolButton } from '../ui'
import { useHashQuery } from '../utils/hashQuery'
import { CommunitiesBody } from './components/CommunitiesBody'
import { ProjectFilters } from './components/ProjectFilters'
import { useCommunities } from './hooks/useCommunities'
import { createCommunitiesSource, type CommunitiesSource } from './source'
import type { AssistSlot } from './types'
import { COMMUNITIES_LEAD } from './utils/messages'
import { communityScopes, marketName, plural, scopeName } from './utils/model'
import { tabFromView, type CommunitiesTab } from './utils/tabs'
import './communities.css'

/** Route keys: the open section, a market id and a page id (absent: source mix, every one). */
const QUERY = ['view', 'market', 'page'] as const

/**
 * Communities across the project (`#/communities`, SRS §4.17): the page tab's
 * KPI tiles and sections over every tracked page, from `communities:get` with
 * `scope: 'project'` (no page). The market and one page or topic narrow it;
 * a page filter asks for that page's report (`scope: 'page'`), so the numbers
 * match its own Communities tab. The section and both filters are in the route
 * (`?view=`, `?market=`, `?page=`), so Back and Forward step through them, and
 * an id the project no longer has falls back to "all". Every number opens its
 * drill as on the page tab.
 */
export function ProjectCommunitiesScreen({
  projectId,
  markets,
  pages,
  source,
  assists,
  assistClient
}: {
  projectId: string
  /** The project's markets, for the market filter. */
  markets: readonly Market[]
  /** The project's pages and topics, for the page filter. */
  pages: readonly PageSummary[]
  source?: CommunitiesSource
  /** AI-assist hook point (FR-17.6). Renders nothing unless another module passes a slot. */
  assists?: AssistSlot
  /** The client for "Draft a helpful reply" (FR-17.6). Defaults to the app's. */
  assistClient?: AssistClient
}): JSX.Element {
  const client = useMemo(() => source ?? createCommunitiesSource(), [source])
  const [query, setQuery] = useHashQuery(QUERY)
  const choices = useMemo(() => communityScopes(pages), [pages])
  const page = choices.find((item) => item.id === query.page) ?? null
  const marketId = markets.some((item) => item.id === query.market) ? query.market : null
  const pageId = page?.id ?? null
  const state = useCommunities(client, {
    projectId,
    scope: page === null ? 'project' : 'page',
    pageId,
    marketId
  })
  const report = state.report
  const tab = tabFromView(query.view)
  const setTab = (next: CommunitiesTab): void => setQuery({ view: next === 'mix' ? null : next })
  const marketText = marketId === null ? 'All markets' : marketName(markets, marketId)
  const pageText =
    page !== null
      ? scopeName(page)
      : report === null
        ? 'All tracked pages'
        : plural(report.pageCount, 'tracked page')
  const scopeLabel = `${pageText} · ${marketText}`
  useAiContext({
    entities: [
      ...(page
        ? [
            {
              kind: page.kind === 'topic' ? ('topic' as const) : ('page' as const),
              id: page.id,
              label: scopeName(page)
            }
          ]
        : []),
      ...(marketId !== null ? [{ kind: 'market' as const, id: marketId, label: marketText }] : [])
    ],
    numbers: report
      ? [
          { label: 'Tracked pages checked', value: String(report.pageCount) },
          { label: 'Reddit threads', value: String(report.reddit.length) },
          { label: 'YouTube videos', value: String(report.youtube.length) },
          { label: 'LinkedIn posts', value: String(report.linkedin.length) },
          { label: 'Other forums', value: String(report.forums.length) },
          { label: 'Opportunities', value: String(report.opportunities.length) }
        ]
      : []
  })
  const filters = (
    <ProjectFilters
      markets={markets}
      pages={choices}
      marketId={marketId}
      pageId={pageId}
      onMarket={(next) => setQuery({ market: next })}
      onPage={(next) => setQuery({ page: next })}
      loading={state.loading}
    />
  )

  return (
    <SectionFrame
      title="Communities"
      subtitle={COMMUNITIES_LEAD}
      actions={
        <ToolButton
          kind="schedule"
          label="Email it weekly"
          onClick={() => navigateHash(sectionHash('reports'))}
        />
      }
    >
      <DrillHost resetKey={`${pageId ?? ''}\0${marketId ?? ''}`}>
        <div className="cm-screen" aria-busy={state.loading}>
          <CommunitiesBody
            client={client}
            state={state}
            scopeLabel={scopeLabel}
            filters={filters}
            empty={
              page === null && marketId === null ? (
                <EmptyState
                  level={2}
                  title="No page checked yet"
                  body="Set up your site and run a first check."
                  action={
                    <LinkButton href={addStartHash()} icon="plus" size="sm" variant="primary">
                      Set up your site
                    </LinkButton>
                  }
                />
              ) : (
                <EmptyState
                  level={2}
                  title="No check in this scope yet"
                  body={`No check yet for ${page === null ? 'any tracked page' : scopeName(page)} in ${
                    marketId === null ? 'any market' : marketText
                  }. Pick All tracked pages or All markets above, or run a check.`}
                />
              )
            }
            tab={tab}
            onTab={setTab}
            pageId={pageId}
            assists={assists}
            {...(assistClient ? { assistClient } : {})}
          />
        </div>
      </DrillHost>
    </SectionFrame>
  )
}
