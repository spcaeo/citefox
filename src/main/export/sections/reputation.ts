import type { SentimentClaim, SentimentOverview } from '@shared/domain'
import {
  answerRows,
  brandMatrix,
  factualProblems,
  mentionShares,
  negativeSources,
  netSentiment,
  overviewsNamingBrand,
  ownClaims,
  rankLabel,
  themeRows,
  toneBuckets,
  toneCounts,
  type BrandMatrix,
  type ClaimBucket,
  type MentionShare,
  type NegativeSourceRow,
  type ThemeRow
} from '@shared/sentiment-metrics'
import { listSentimentClaims, listSentimentReads } from '../../storage/sentiment-records'
import type { SqliteDatabase } from '../../storage/database'
import { listPages } from '../../storage/pages'
import { readProjectProfile } from '../../storage/project-profile'
import { pageMarkets } from '../../engine/sentiment/brand-prompts'
import { fullRuns, runSentiment } from '../../engine/sentiment/view'
import type { ExportSentimentRow } from '../types'

/**
 * REPORT-SPEC section 5 (Reputation) and SRS 4.16, as one typed block of the
 * export model. The HTML and PDF renderers read this, never the database, and
 * every number comes from `@shared/sentiment-metrics`, the same functions the
 * Sentiment tab uses, so the app and every export agree for the same scope.
 *
 * Scope: one page or the whole project (`pageIds: null`), one market or all.
 * The latest full check of each page × market is the current reading. Partial
 * (follow-up) checks never count (section 7.4).
 */

export interface ReputationScope {
  projectId: string
  /** Null is every tracked page. */
  pageIds: readonly string[] | null
  /** Null is every market of each page. */
  marketIds: readonly string[] | null
}

/** Claim counts are own-brand claims. Net is null below 5 claims ("Not enough data"). */
export interface ReputationCounts {
  claims: number
  positive: number
  neutral: number
  negative: number
  net: number | null
  notEnoughData: boolean
  /** Overviews with text in the current checks. */
  overviews: number
  overviewsRead: number
  overviewsNamingBrand: number
}

/** Claims per check by tone (FR-16.4). One point per check, or per day across pages and markets. */
export interface ReputationTrendPoint {
  /** The run id for one page and market, or the UTC day (`YYYY-MM-DD`) when combined. */
  key: string
  /** ISO-8601 UTC of the latest run in the point. */
  checkedAt: string
  positive: number
  neutral: number
  negative: number
  total: number
  net: number | null
}

/** "Answer by answer": Prompt · Tone · Theme · Rank · Why. */
export interface ReputationRow {
  overviewId: string
  pageId: string
  marketId: string
  source: SentimentOverview['source']
  prompt: string
  promptLabel: string
  tone: SentimentClaim['tone']
  theme: string | null
  rank: number | null
  brandsNamed: number
  /** "#1 of 3 brands named". */
  rankLabel: string
  reason: string | null
  claimIds: readonly string[]
}

/** "Factual problems worth correcting". */
export interface ReputationIssue {
  claimId: string
  pageId: string
  marketId: string
  prompt: string
  /** What the overview claims, word for word. */
  claim: string
  brand: string
  basis: 'fact' | 'page'
  why: string
  correction: string
  sourceToFix: string | null
}

export interface ReputationSection {
  scope: ReputationScope
  brand: string | null
  competitors: readonly string[]
  counts: ReputationCounts
  /** The tone split with the claim ids behind each part (drill tokens). */
  split: Readonly<Record<SentimentClaim['tone'], ClaimBucket>>
  share: readonly MentionShare[]
  trend: readonly ReputationTrendPoint[]
  rows: readonly ReputationRow[]
  issues: readonly ReputationIssue[]
  themes: readonly ThemeRow[]
  matrix: BrandMatrix
  negativeSources: readonly NegativeSourceRow[]
  /** Every claim of the current checks, all brands, for drill-downs. */
  claims: readonly SentimentClaim[]
  /** Every overview of the current checks, for drill-downs. */
  overviews: readonly SentimentOverview[]
}

export function buildReputation(db: SqliteDatabase, scope: ReputationScope): ReputationSection {
  const profile = readProjectProfile(db)
  const brand = (profile?.brandNames ?? []).map((name) => name.trim()).find(Boolean) ?? null
  const competitors = (profile?.competitors ?? []).map((name) => name.trim()).filter(Boolean)
  const pairs = scopePairs(db, scope)
  const overviews: SentimentOverview[] = []
  const claims: SentimentClaim[] = []
  const pageOf = new Map<string, string>()
  const series: { pageId: string; runs: ReturnType<typeof fullRuns> }[] = []
  for (const pair of pairs) {
    const runs = fullRuns(db, scope.projectId, pair.pageId, pair.marketId)
    series.push({ pageId: pair.pageId, runs })
    const latest = runs.at(-1)
    if (latest === undefined) continue
    const current = runSentiment(
      db,
      scope.projectId,
      latest,
      listSentimentReads(db, [latest.id]),
      listSentimentClaims(db, [latest.id])
    )
    for (const overview of current.overviews) pageOf.set(overview.id, pair.pageId)
    overviews.push(...current.overviews)
    claims.push(...current.claims)
  }
  const own = ownClaims(claims)
  const counts = toneCounts(own)
  const net = netSentiment(counts)
  const promptOf = new Map(overviews.map((overview) => [overview.id, overview.promptText]))
  return {
    scope,
    brand,
    competitors,
    counts: {
      claims: counts.total,
      positive: counts.positive,
      neutral: counts.neutral,
      negative: counts.negative,
      net,
      notEnoughData: net === null,
      overviews: overviews.length,
      overviewsRead: overviews.filter((overview) => overview.readState === 'read').length,
      overviewsNamingBrand: overviewsNamingBrand(overviews, claims, brand).length
    },
    split: toneBuckets(own),
    share: mentionShares(overviews, claims, brand, competitors),
    trend: trendFor(db, scope.projectId, series, pairs.length === 1),
    rows: answerRows(overviews, claims, brand).map((row) => ({
      overviewId: row.overviewId,
      pageId: pageOf.get(row.overviewId) ?? '',
      marketId: row.marketId,
      source: row.source,
      prompt: row.promptText,
      promptLabel: row.promptLabel,
      tone: row.tone,
      theme: row.theme,
      rank: row.rank,
      brandsNamed: row.brandsNamed,
      rankLabel: rankLabel(row),
      reason: row.reason,
      claimIds: row.claimIds
    })),
    issues: factualProblems(claims).flatMap((claim): ReputationIssue[] =>
      claim.factProblem === null
        ? []
        : [
            {
              claimId: claim.id,
              pageId: pageOf.get(claim.overviewId) ?? '',
              marketId: claim.marketId,
              prompt: promptOf.get(claim.overviewId) ?? '',
              claim: claim.sentence,
              brand: claim.brand,
              basis: claim.factProblem.basis,
              why: claim.factProblem.why,
              correction: claim.factProblem.correction,
              sourceToFix: claim.factProblem.sourceToFix
            }
          ]
    ),
    themes: themeRows(own),
    matrix: brandMatrix(claims, brand, competitors),
    negativeSources: negativeSources(claims),
    claims,
    overviews
  }
}

/**
 * Rows for `ExportPage.sentiment` (XLSX and CSV): every claim of the page's
 * current full checks, all brands, with its factual problem when Claude found one.
 */
export function exportSentimentRows(
  db: SqliteDatabase,
  projectId: string,
  pageId: string,
  marketIds: readonly string[] | null
): ExportSentimentRow[] {
  const section = buildReputation(db, { projectId, pageIds: [pageId], marketIds })
  return section.claims.map((claim) => ({
    marketId: claim.marketId,
    theme: claim.theme,
    claim: `${claim.brand}: ${claim.sentence}`,
    stance: claim.tone,
    source: claim.url ?? '',
    factualProblem:
      claim.factProblem === null
        ? null
        : `${claim.factProblem.why} Suggested correction: ${claim.factProblem.correction}`
  }))
}

function scopePairs(
  db: SqliteDatabase,
  scope: ReputationScope
): { pageId: string; marketId: string }[] {
  const pages =
    scope.pageIds ??
    listPages(db, scope.projectId)
      .filter((page) => page.status === 'tracked' || page.status === 'paused')
      .map((page) => page.id)
  return pages.flatMap((pageId) =>
    pageMarkets(db, pageId)
      .filter((market) => scope.marketIds === null || scope.marketIds.includes(market.id))
      .map((market) => ({ pageId, marketId: market.id }))
  )
}

function trendFor(
  db: SqliteDatabase,
  projectId: string,
  series: readonly { pageId: string; runs: ReturnType<typeof fullRuns> }[],
  perRun: boolean
): ReputationTrendPoint[] {
  const points = new Map<string, ReputationTrendPoint>()
  for (const { runs } of series) {
    const runIds = runs.map((run) => run.id)
    const reads = listSentimentReads(db, runIds)
    const claims = listSentimentClaims(db, runIds)
    for (const run of runs) {
      const own = runSentiment(db, projectId, run, reads, claims).claims.filter(
        (claim) => claim.isOwn
      )
      const checkedAt = run.finishedAt ?? run.startedAt
      const key = perRun ? run.id : checkedAt.slice(0, 10)
      const point = points.get(key) ?? {
        key,
        checkedAt,
        positive: 0,
        neutral: 0,
        negative: 0,
        total: 0,
        net: null
      }
      const counts = toneCounts(own)
      point.positive += counts.positive
      point.neutral += counts.neutral
      point.negative += counts.negative
      point.total += counts.total
      if (checkedAt > point.checkedAt) point.checkedAt = checkedAt
      points.set(key, point)
    }
  }
  return [...points.values()]
    .map((point) => ({ ...point, net: netSentiment(point) }))
    .sort((left, right) => left.checkedAt.localeCompare(right.checkedAt))
}
