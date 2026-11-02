import { CLAIM_TONES } from '@shared/domain'
import type { ReputationSection as SentimentReputation } from '../sections/reputation'
import type { ReportBuildContext, ReportRow, ReputationSection } from '../model/types'

/**
 * REPORT-SPEC section 5 from the brand-sentiment block (`sections/reputation.ts`,
 * the numbers the Sentiment tab shows). Answers to brand prompts have no report row,
 * so a tone count drills only when every answer behind it is a report row; otherwise
 * it is a plain number. A drill list therefore always has exactly `n` rows (NFR-14).
 */
export function reputationModel(
  sentiment: SentimentReputation,
  context: ReportBuildContext
): ReputationSection {
  const rowOf = rowLookup(context.rows)
  const overviewById = new Map(sentiment.overviews.map((overview) => [overview.id, overview]))
  const rowIdOfOverview = (overviewId: string): string | null => {
    const overview = overviewById.get(overviewId)
    if (overview === undefined || overview.source !== 'buyer') return null
    const pageId = sentiment.rows.find((row) => row.overviewId === overviewId)?.pageId
    return rowOf(pageId, overview.marketId, overview.promptId)
  }
  const pageOfOverview = new Map(sentiment.rows.map((row) => [row.overviewId, row.pageId]))
  const rowIdOfClaim = (claimId: string): string | null => {
    const claim = sentiment.claims.find((item) => item.id === claimId)
    if (claim === undefined || claim.source !== 'buyer') return null
    return rowOf(pageOfOverview.get(claim.overviewId), claim.marketId, claim.promptId)
  }
  const answers = sentiment.rows.map((row) => ({
    rowId: rowIdOfOverview(row.overviewId),
    prompt: row.prompt,
    tone: row.tone,
    theme: row.theme ?? '—',
    rank: row.rankLabel,
    why: row.reason ?? ''
  }))
  const tone = Object.fromEntries(
    CLAIM_TONES.map((value) => {
      const list = answers.filter((answer) => answer.tone === value)
      const ids = list.flatMap((answer) => (answer.rowId === null ? [] : [answer.rowId]))
      const count =
        ids.length === list.length && new Set(ids).size === ids.length
          ? context.count(`tone:${value}`, ids)
          : { n: list.length, drill: null }
      return [value, count]
    })
  ) as Record<(typeof CLAIM_TONES)[number], ReputationSection['positive']>
  const empty =
    sentiment.overviews.length === 0
      ? {
          title: 'Not measured yet',
          message: 'Brand sentiment reads the AI Overviews that name your brand.',
          nextStep: 'Run a check with brand sentiment on to fill this.'
        }
      : answers.length === 0
        ? {
            title: 'Your brand is not named yet',
            message: 'None of the AI Overviews read in this scope names your brand.',
            nextStep: null
          }
        : null
  return {
    empty,
    positive: tone.positive,
    neutral: tone.neutral,
    negative: tone.negative,
    analysed: answers.length,
    net: sentiment.counts.net,
    trend: sentiment.trend.map((point) => ({
      at: point.checkedAt,
      positive: point.positive,
      neutral: point.neutral,
      negative: point.negative
    })),
    issues: sentiment.issues.map((issue) => ({
      rowId: rowIdOfClaim(issue.claimId),
      prompt: issue.prompt,
      claim: issue.claim,
      whyWrong: issue.why,
      correction: issue.correction,
      sourceToFix: issue.sourceToFix
    })),
    answers
  }
}

function rowLookup(
  rows: readonly ReportRow[]
): (pageId: string | undefined, marketId: string, promptId: string) => string | null {
  const byKey = new Map(
    rows.map((row) => [`${row.pageId}|${row.marketId}|${row.promptId}`, row.id])
  )
  return (pageId, marketId, promptId) =>
    pageId === undefined ? null : (byKey.get(`${pageId}|${marketId}|${promptId}`) ?? null)
}
