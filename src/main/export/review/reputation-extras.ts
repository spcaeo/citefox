import type { SentimentClaim, SentimentOverview } from '@shared/domain'
import type { MetricsResult } from '@shared/metrics'
import { engineRowsOf, type ReputationData } from '@shared/report/review'
import {
  answerRows,
  mentionShares,
  ownClaims,
  rankLabel,
  themeRows,
  toneCounts
} from '@shared/sentiment-metrics'
import { filterFor } from '../../engine/checks/results'
import { runSentiment } from '../../engine/sentiment/view'
import { listStoredCheckRuns, type StoredCheckRun } from '../../storage/check-records'
import type { SqliteDatabase } from '../../storage/database'
import { listSentimentClaims, listSentimentReads } from '../../storage/sentiment-records'

/**
 * The Visibility report's Reputation tab data (src/shared/report/review/reputation.ts),
 * read the way the Full report's reputation block reads it
 * (src/main/export/sections/reputation.ts, the same `runSentiment` and
 * `@shared/sentiment-metrics`), but for the report's own checks: the answers of the
 * picked check's questions, and one tone point per check up to it. CiteFox AI reads
 * Google AI Overview answers, so the rows are Google rows. Read-only.
 */
export function loadReputationData(
  db: SqliteDatabase,
  projectId: string,
  metrics: MetricsResult,
  brand: string | null,
  competitors: readonly string[] = []
): ReputationData | null {
  // The Google rows of the picked check, by row id (`google_aio:<run>:<prompt>`).
  const current = new Set<string>()
  const sources = new Map<string, { pageId: string; marketId: string }>()
  const currentRuns = new Set<string>()
  for (const id of metrics.now.checked.ids) {
    for (const row of engineRowsOf(metrics, id)) {
      if (row.engine !== 'google_aio') continue
      current.add(row.id)
      currentRuns.add(row.checkId)
      sources.set(`${row.sourceId}|${row.marketId}`, {
        pageId: row.sourceId,
        marketId: row.marketId
      })
    }
  }
  if (current.size === 0) return null
  const checkIds = new Set(metrics.checks.map((check) => check.id))
  const latest = [...currentRuns]
  const toAt = metrics.checks.filter((check) => currentRuns.has(check.id)).at(-1)?.at ?? null
  const overviews: SentimentOverview[] = []
  const claims: SentimentClaim[] = []
  const trend = new Map<
    string,
    { at: string; positive: number; neutral: number; negative: number }
  >()
  for (const { pageId, marketId } of sources.values()) {
    const runs = listStoredCheckRuns(db, filterFor(projectId, pageId, marketId)).filter(
      (run): run is StoredCheckRun & { finishedAt: string } =>
        run.status === 'finished' &&
        run.finishedAt !== null &&
        checkIds.has(run.id) &&
        (toAt === null || run.finishedAt <= toAt)
    )
    const runIds = runs.map((run) => run.id)
    const reads = listSentimentReads(db, runIds)
    const stored = listSentimentClaims(db, runIds)
    for (const run of runs) {
      const read = runSentiment(db, projectId, run, reads, stored)
      const buyer = new Set(
        read.overviews.filter((overview) => overview.source === 'buyer').map((o) => o.id)
      )
      const counts = toneCounts(
        ownClaims(read.claims).filter((claim) => buyer.has(claim.overviewId))
      )
      const point = trend.get(run.id) ?? {
        at: run.finishedAt,
        positive: 0,
        neutral: 0,
        negative: 0
      }
      point.positive += counts.positive
      point.neutral += counts.neutral
      point.negative += counts.negative
      trend.set(run.id, point)
      if (!latest.includes(run.id)) continue
      for (const overview of read.overviews) {
        if (overview.source === 'buyer' && !current.has(rowIdOf(overview))) continue
        overviews.push(overview)
      }
      const kept = new Set(overviews.map((overview) => overview.id))
      claims.push(...read.claims.filter((claim) => kept.has(claim.overviewId)))
    }
  }
  const buyer = overviews.filter((overview) => overview.source === 'buyer')
  const buyerIds = new Set(buyer.map((overview) => overview.id))
  const byId = new Map(overviews.map((overview) => [overview.id, overview]))
  const buyerClaims = claims.filter((claim) => buyerIds.has(claim.overviewId))
  const ownBuyer = ownClaims(buyerClaims)
  const own = toneCounts(ownBuyer)
  const rowOf = (claim: SentimentClaim): string | null => {
    const overview = byId.get(claim.overviewId)
    return overview === undefined ? null : rowIdOf(overview)
  }
  const weight = { negative: 0, positive: 1, neutral: 2 } as const
  const themes = themeRows(ownBuyer)
    .slice(0, 6)
    .map((row) => {
      const items = ownBuyer
        .filter((claim) => claim.theme === row.theme)
        .sort((left, right) => weight[left.tone] - weight[right.tone])
      return {
        theme: row.theme,
        positive: row.counts.positive,
        neutral: row.counts.neutral,
        negative: row.counts.negative,
        examples: items
          .slice(0, 2)
          .map((claim) => ({ claim: claim.sentence, tone: claim.tone, rowId: rowOf(claim) }))
      }
    })
  // You first, then the competitors from settings, then any other brand a claim names.
  const names = [...(brand === null ? [] : [brand]), ...competitors]
  for (const claim of buyerClaims) if (!names.includes(claim.brand)) names.push(claim.brand)
  const brands = mentionShares(buyer, claims, brand, names.slice(brand === null ? 0 : 1))
    .filter((share) => share.mentions > 0)
    .map((share) => {
      const tones = toneCounts(buyerClaims.filter((claim) => claim.brand === share.brand))
      return {
        brand: share.brand,
        own: share.isOwn,
        rowIds: share.overviewIds.flatMap((id) => {
          const overview = byId.get(id)
          return overview === undefined ? [] : [rowIdOf(overview)]
        }),
        first: share.overviewIds.filter((id) => byId.get(id)?.brandsNamed[0] === share.brand)
          .length,
        positive: tones.positive,
        neutral: tones.neutral,
        negative: tones.negative
      }
    })
  return {
    themes,
    brands,
    brand,
    answers: buyer.length,
    read: buyer.filter((overview) => overview.readState === 'read').length,
    claims: { positive: own.positive, neutral: own.neutral, negative: own.negative },
    rows: answerRows(buyer, claims, brand).map((row) => {
      const overview = byId.get(row.overviewId)
      return {
        rowId: overview === undefined ? '' : rowIdOf(overview),
        tone: row.tone,
        theme: row.theme,
        rank: rankLabel(row),
        reason: row.reason
      }
    }),
    issues: claims
      .filter((claim) => claim.factProblem !== null)
      .sort((left, right) => Number(right.isOwn) - Number(left.isOwn))
      .map((claim) => {
        const overview = byId.get(claim.overviewId)
        return {
          id: claim.id,
          rowId: overview?.source === 'buyer' ? rowIdOf(overview) : null,
          question: overview?.promptText ?? '',
          claim: claim.sentence,
          brand: claim.brand,
          own: claim.isOwn,
          why: claim.factProblem?.why ?? '',
          correction: claim.factProblem?.correction ?? '',
          sourceToFix: claim.factProblem?.sourceToFix ?? null
        }
      }),
    trend: [...trend.values()].sort((left, right) => left.at.localeCompare(right.at))
  }
}

/** A buyer overview's metrics row id (assemble.ts `googleRows`). */
function rowIdOf(overview: SentimentOverview): string {
  return `google_aio:${overview.runId}:${overview.promptId}`
}
