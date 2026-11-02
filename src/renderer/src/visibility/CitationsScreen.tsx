import { useEffect, useMemo, useState, type JSX } from 'react'
import type { Market, PageResults } from '@shared/domain'
import { pluralize, pluralWord } from '@shared/pluralize'
import { LINK_COUNT_LABELS } from '@shared/report-copy'
import { useAiContext } from '../assistant/context/useAiContext'
import { LoadError } from '../components/LoadError'
import { errorText } from '../components/errorText'
import { DrillButton, DrillFigure, DrillHost, DrillNumber, openTarget } from '../drill'
import { Leaderboard } from '../m3/Leaderboard'
import { CannibalizingCard, CitedInsteadCard } from '../m3/results/CitedSections'
import { useResultsDrills, type ResultsDrills } from '../m3/results/drills'
import { useEngineRevision } from '../shell/engineRevision'
import { runningHash } from '../shell/routes'
import { EmptyState, LinkButton, SectionHead } from '../ui'
import { pageScopeRefs } from './aiContext'
import { CitationGrid } from './CitationGrid'
import { citationRows, type CitationListRow } from './citations'
import { createVisibilitySource, type VisibilitySource } from './source'
import '../m3/m3.css'
import './visibility.css'

/**
 * Citations for one page in one market. Every count opens what it counts:
 * the links KPI lists links, each domain lists the overviews that cite it,
 * and each source row opens its prompt. Shares the shell's drill drawer.
 */
export function CitationsScreen({
  source,
  projectId,
  pageId,
  marketId,
  market,
  readHref,
  runId = null,
  withSharedSections = true
}: {
  source?: VisibilitySource
  projectId: string
  pageId: string
  marketId: string | null
  market?: Market
  readHref?: string
  /** A check pinned by the route. Null is the latest check. */
  runId?: string | null
  /**
   * Show the links KPI, the leaderboard, "Cited instead of you", and "Your
   * other pages cited instead". False when the Results tab already draws them
   * above this screen; only "Sources Google listed" is left.
   */
  withSharedSections?: boolean
}): JSX.Element {
  const client = useMemo(() => source ?? createVisibilitySource(), [source])
  const [results, setResults] = useState<PageResults | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loadedKey, setLoadedKey] = useState<string | null>(null)
  const [reload, setReload] = useState(0)
  const requestKey = `${projectId}\0${pageId}\0${marketId ?? ''}\0${runId ?? ''}\0${reload}`
  const revision = useEngineRevision()

  useEffect(() => {
    let cancelled = false
    void client['results:get']({ projectId, pageId, marketId, runId }).then(
      (payload) => {
        if (cancelled) return
        setResults(payload)
        setError(null)
        setLoadedKey(requestKey)
      },
      (cause: unknown) => {
        if (cancelled) return
        setResults(null)
        setError(errorText(cause, 'Could not load citations.'))
        setLoadedKey(requestKey)
      }
    )
    return () => {
      cancelled = true
    }
  }, [client, projectId, pageId, marketId, runId, requestKey, revision])

  if (loadedKey !== requestKey || !results) {
    if (loadedKey === requestKey && error) {
      return (
        <LoadError
          title="Could not load citations."
          message={error}
          onRetry={() => setReload((n) => n + 1)}
        />
      )
    }
    return <p role="status">Loading citations…</p>
  }
  if (!results.run) {
    return (
      <div className="page-stack">
        {readHref ? (
          <p>
            <LinkButton href={readHref}>Check what CiteFox read</LinkButton>
          </p>
        ) : null}
        <EmptyState
          icon="inbox"
          title="No check in this market yet."
          body="Press Check now to see which sites AI Overviews link to."
          action={
            <LinkButton href={runningHash(pageId)} variant="primary">
              Check now
            </LinkButton>
          }
        />
      </div>
    )
  }
  return (
    <DrillHost>
      <CitationsBody
        projectId={projectId}
        pageId={pageId}
        market={market}
        runId={runId}
        results={results}
        readHref={readHref}
        withSharedSections={withSharedSections}
      />
    </DrillHost>
  )
}

function CitationsBody({
  projectId,
  pageId,
  market,
  runId,
  results,
  readHref,
  withSharedSections
}: {
  projectId: string
  pageId: string
  market: Market | undefined
  runId: string | null
  results: PageResults
  readHref: string | undefined
  withSharedSections: boolean
}): JSX.Element {
  const drills = useResultsDrills(results, { pageId, market, runId })
  const rows = useMemo(() => citationRows(results), [results])
  const aio = drills.get('kpi:aio')?.rows.length ?? results.run?.promptsWithAio ?? 0
  useAiContext({
    entities: pageScopeRefs({
      pageId,
      page: results.scope.pageTitle ?? results.scope.pageUrl,
      market: market ?? null,
      runId,
      checkedAt: results.scope.checkedAt
    })
  })

  function openRow(row: CitationListRow): void {
    const prompt = results.prompts.find((item) => item.promptId === row.promptId)
    const target = prompt ? drills.prompt(prompt) : null
    if (target) openTarget(target)
  }

  return (
    <div className="page-stack m3-screen" data-nfr-screen="citations">
      {readHref ? (
        <p>
          <LinkButton href={readHref}>Check what CiteFox read</LinkButton>
        </p>
      ) : null}

      {withSharedSections ? (
        <>
          <LinksKpi drills={drills} />
          <Leaderboard results={results} aio={aio} drills={drills} projectId={projectId} />
          <div className="vis-split">
            <CitedInsteadCard results={results} drills={drills} aio={aio} />
            <CannibalizingCard pageId={pageId} results={results} drills={drills} />
          </div>
        </>
      ) : null}

      <div className="stack-tight">
        <SectionHead
          id="src-h"
          title="Sources Google listed"
          description="Every source in every overview. Select a row to open its question, or a domain to see every overview that cites it."
        />
        <CitationGrid rows={rows} onOpen={openRow} drills={drills} projectId={projectId} />
      </div>
    </div>
  )
}

/** "Citations (links)": opens one row per own-domain link; its two parts open their links. */
function LinksKpi({ drills }: { drills: ResultsDrills }): JSX.Element {
  const links = drills.links('all', undefined, 'kpi:links')
  const thisPage = drills.links('this_page')
  const otherOwn = drills.links('other_own')
  const domain = drills.scope.domain
  return (
    <section
      className="card vis-kpi"
      aria-labelledby="vis-links-h"
      data-nfr-chart="own-domain-links"
    >
      <h2 id="vis-links-h" className="label">
        {LINK_COUNT_LABELS.ownDomain}
      </h2>
      <DrillButton
        drill={links}
        className="vis-kpi-btn"
        label={`${links.items.length} ${pluralWord(links.items.length, 'link')}`}
      >
        <span className="vis-kpi-val">
          <DrillFigure drill={links} />
          <span className="faint"> {pluralWord(links.items.length, 'link')}</span>
        </span>
      </DrillButton>
      <p className="faint">
        <DrillNumber
          drill={thisPage}
          label={`${pluralize(thisPage.items.length, 'link')} to this page`}
        />{' '}
        to this page ·{' '}
        <DrillNumber
          drill={otherOwn}
          label={`${pluralize(otherOwn.items.length, 'link')} to other ${domain} pages`}
        />{' '}
        to other {domain} pages
      </p>
      <div className="sr-only">
        <p id="vis-links-parts">
          Own-domain citations. Counts are links, and the two parts add up to the total.
        </p>
        <ul aria-labelledby="vis-links-parts">
          <li>
            This page: <span data-nfr-segment="">{thisPage.items.length}</span>
          </li>
          <li>
            Other own pages: <span data-nfr-segment="">{otherOwn.items.length}</span>
          </li>
          <li>
            Total: <span data-nfr-total="">{links.items.length}</span>
          </li>
        </ul>
      </div>
    </section>
  )
}
