import type {
  SentimentCheckPoint,
  SentimentClaim,
  SentimentOverview,
  SentimentView
} from '@shared/domain'
import { listBrandFacts } from '../../storage/brand-records'
import { listStoredCheckRuns, type StoredCheckRun } from '../../storage/check-records'
import type { SqliteDatabase } from '../../storage/database'
import { getPage } from '../../storage/pages'
import { readProjectProfile } from '../../storage/project-profile'
import {
  listSentimentClaims,
  listSentimentReads,
  type StoredSentimentClaim,
  type StoredSentimentRead
} from '../../storage/sentiment-records'
import { CheckInputError, filterFor } from '../checks/results'
import { brandPromptSetView, pageMarkets } from './brand-prompts'
import { sourceKindFor } from './claims'
import { pageCompetitors } from './context'
import { runOverviews, type RunOverview } from './overviews'

/**
 * Full (non-partial) finished runs of one page and market, oldest first.
 * Section 7.4: follow-up checks never enter trends or headline numbers.
 */
export function fullRuns(
  db: SqliteDatabase,
  projectId: string,
  pageId: string,
  marketId: string | null
): StoredCheckRun[] {
  return listStoredCheckRuns(db, filterFor(projectId, pageId, marketId)).filter(
    (run) => run.status === 'finished' && !run.partial
  )
}

/** One run's overviews (those with text) and claims, in the shared shapes. */
export function runSentiment(
  db: SqliteDatabase,
  projectId: string,
  run: StoredCheckRun,
  reads: readonly StoredSentimentRead[],
  claims: readonly StoredSentimentClaim[]
): { overviews: SentimentOverview[]; claims: SentimentClaim[] } {
  const byCapture = new Map(
    reads.filter((read) => read.runId === run.id).map((read) => [read.captureId, read] as const)
  )
  const listed = runOverviews(db, projectId, run).filter((overview) => overview.aioText !== null)
  const overviews = listed.map((overview) =>
    toOverview(run, overview, byCapture.get(overview.captureId))
  )
  const byId = new Map(listed.map((overview) => [overview.captureId, overview] as const))
  const shaped = claims.flatMap((claim): SentimentClaim[] => {
    const overview = byId.get(claim.captureId)
    if (claim.runId !== run.id || overview === undefined) return []
    return [
      {
        id: claim.id,
        overviewId: claim.captureId,
        runId: run.id,
        marketId: run.marketId,
        source: claim.source,
        promptId: overview.promptId,
        brand: claim.brand,
        isOwn: claim.isOwn,
        theme: claim.theme,
        attribute: claim.attribute,
        tone: claim.tone,
        sentence: claim.sentence,
        url: claim.url,
        sourceKind: sourceKindFor(claim.url, overview.references),
        factProblem: claim.factProblem
      }
    ]
  })
  return { overviews, claims: shaped }
}

/** FR-16.4. One full check's own-brand claim counts. */
function trendPoint(
  run: StoredCheckRun,
  shaped: { overviews: readonly SentimentOverview[]; claims: readonly SentimentClaim[] }
): SentimentCheckPoint {
  const own = shaped.claims.filter((claim) => claim.isOwn)
  return {
    runId: run.id,
    checkedAt: run.finishedAt ?? run.startedAt,
    overviews: shaped.overviews.length,
    overviewsRead: shaped.overviews.filter((overview) => overview.readState === 'read').length,
    positive: own.filter((claim) => claim.tone === 'positive').length,
    neutral: own.filter((claim) => claim.tone === 'neutral').length,
    negative: own.filter((claim) => claim.tone === 'negative').length
  }
}

/** Everything the Sentiment tab draws for one page and market (FR-16.4 to FR-16.7). */
export function loadSentimentView(
  db: SqliteDatabase,
  input: { projectId: string; pageId: string; marketId: string | null; running: boolean }
): SentimentView {
  const page = getPage(db, input.pageId, input.projectId)
  if (page === null) throw new CheckInputError('Unknown page')
  const markets = pageMarkets(db, page.id)
  const marketId = input.marketId ?? page.defaultMarketId ?? markets[0]?.id ?? ''
  if (input.marketId !== null && !markets.some((market) => market.id === input.marketId)) {
    throw new CheckInputError('Unknown market')
  }
  const profile = readProjectProfile(db)
  const brands = (profile?.brandNames ?? []).filter((name) => name.trim().length > 0)
  const runs = marketId.length === 0 ? [] : fullRuns(db, input.projectId, page.id, marketId)
  const runIds = runs.map((run) => run.id)
  const reads = listSentimentReads(db, runIds)
  const claims = listSentimentClaims(db, runIds)
  const latest = runs.at(-1) ?? null
  const shaped = runs.map((run) => runSentiment(db, input.projectId, run, reads, claims))
  const current = shaped.at(-1) ?? { overviews: [], claims: [] }
  const earlier = shaped.slice(0, -1)
  const earlierClaims = earlier.flatMap((run) => run.claims.filter((claim) => claim.isOwn))
  const cited = new Set(earlierClaims.map((claim) => claim.overviewId))
  const earlierOverviews = earlier.flatMap((run) =>
    run.overviews.filter((overview) => cited.has(overview.id))
  )
  return {
    projectId: input.projectId,
    pageId: page.id,
    marketId,
    brand: brands[0]?.trim() ?? null,
    competitors: viewCompetitors(
      pageCompetitors(db, page.id, profile?.competitors ?? []).keys,
      current.claims
    ),
    brandPrompts: brandPromptSetView(db, page.id),
    facts: listBrandFacts(db),
    latestRunId: latest?.id ?? null,
    overviews: current.overviews,
    claims: current.claims,
    trend: runs.map((run, index) =>
      trendPoint(run, shaped[index] ?? { overviews: [], claims: [] })
    ),
    earlierClaims,
    earlierOverviews,
    reading: {
      pending: current.overviews.filter((overview) => overview.readState === 'pending').length,
      failed: current.overviews.filter((overview) => overview.readState === 'failed').length,
      running: input.running
    }
  }
}

/**
 * The competitor columns (prompt audit P9): the page's product's competitors, then any
 * other competitor the shown claims name, so an old read made against an older list
 * still shows its claims.
 */
function viewCompetitors(keys: readonly string[], claims: readonly SentimentClaim[]): string[] {
  const out = keys.map((name) => name.trim()).filter((name) => name.length > 0)
  const known = new Set(out.map((name) => name.toLowerCase()))
  for (const claim of claims) {
    if (claim.isOwn || known.has(claim.brand.toLowerCase())) continue
    known.add(claim.brand.toLowerCase())
    out.push(claim.brand)
  }
  return out
}

function toOverview(
  run: StoredCheckRun,
  overview: RunOverview,
  read: StoredSentimentRead | undefined
): SentimentOverview {
  return {
    id: overview.captureId,
    source: overview.source,
    runId: run.id,
    marketId: run.marketId,
    promptId: overview.promptId,
    promptLabel: overview.promptLabel,
    promptText: overview.promptText,
    checkedAt: run.finishedAt ?? run.startedAt,
    readState: read === undefined ? 'pending' : read.ok ? 'read' : 'failed',
    brandsNamed: read?.ok === true ? read.brandsNamed : [],
    reason: read?.ok === true ? read.reason : null,
    references: overview.references
  }
}
