import {
  BRAND_PROMPT_MAX_LENGTH,
  type BrandSearchEstimate,
  type ClaimTone,
  type SentimentCheckPoint,
  type SentimentClaim,
  type SentimentOverview,
  type SentimentReading,
  type SentimentView
} from '@shared/domain'
import type { BrandPromptDraft } from '@shared/ipc'
import { netSentiment, type AnswerRow, type ToneCounts } from '@shared/sentiment-metrics'
import { formatMoment } from '../../utils/dates'
import type { SortSpec } from '../../utils/sort'
import type { SourceFilter } from '../types'

/** The overviews and claims the "Overviews from" picker keeps. */
export function filterBySource(
  view: Pick<SentimentView, 'overviews' | 'claims'>,
  source: SourceFilter
): { overviews: readonly SentimentOverview[]; claims: readonly SentimentClaim[] } {
  if (source === 'all') return { overviews: view.overviews, claims: view.claims }
  return {
    overviews: view.overviews.filter((overview) => overview.source === source),
    claims: view.claims.filter((claim) => claim.source === source)
  }
}

/** Colour band for a net value, matching the mock-up's legend. */
export function netBand(net: number | null): 'pos2' | 'pos1' | 'zero' | 'neg1' | 'neg2' | 'none' {
  if (net === null) return 'none'
  if (net >= 50) return 'pos2'
  if (net >= 15) return 'pos1'
  if (net > -15) return 'zero'
  if (net > -50) return 'neg1'
  return 'neg2'
}

export function pointCounts(point: SentimentCheckPoint): ToneCounts {
  return {
    positive: point.positive,
    neutral: point.neutral,
    negative: point.negative,
    total: point.positive + point.neutral + point.negative
  }
}

export function pointNet(point: SentimentCheckPoint): number | null {
  return netSentiment(pointCounts(point))
}

/**
 * "+9 since Oct 5", "No change since Oct 5", "First check", or "Not enough data"
 * when either check has fewer than 5 claims.
 */
export function changeLabel(current: number | null, trend: readonly SentimentCheckPoint[]): string {
  if (trend.length < 2) return 'First check'
  const previous = trend[trend.length - 2]
  if (previous === undefined) return 'First check'
  const before = pointNet(previous)
  if (current === null || before === null) return 'Change: not enough data'
  const delta = current - before
  const day = formatMoment(previous.checkedAt)
  if (delta === 0) return `No change since ${day}`
  return `${delta > 0 ? '+' : '−'}${Math.abs(delta)} since ${day}`
}

/** Rounded share, 0 when there is no total. */
export function pct(count: number, total: number): number {
  return total === 0 ? 0 : Math.round((count / total) * 100)
}

export function countNoun(count: number, one: string, many: string): string {
  return `${count.toLocaleString('en-US')} ${count === 1 ? one : many}`
}

export function languageLabel(language: string): string {
  return (language.split('-')[0] ?? language).toUpperCase()
}

/**
 * "5 prompts × 4 markets = 20–40 searches per check". When markets use
 * different languages each market searches only its own prompts, so the line
 * says "across" instead of multiplying.
 */
export function estimateLabel(estimate: BrandSearchEstimate): string {
  const prompts = countNoun(estimate.prompts, 'question', 'questions')
  const markets = countNoun(estimate.markets, 'market', 'markets')
  const join = estimate.prompts * estimate.markets === estimate.minSearches ? '×' : 'across'
  return `${prompts} ${join} ${markets} = ${estimate.minSearches}–${estimate.maxSearches} searches per check`
}

/** One point of the trend chart, placed on a time-true axis (NFR-15). */
export interface TrendPoint {
  point: SentimentCheckPoint
  net: number | null
  total: number
  x: number
  y: number
}

/**
 * Places each full check by its real date between `left` and `right`.
 * Net −100..+100 maps to `bottom`..`top`. A point without enough claims sits on 0.
 */
export function layoutTrend(
  trend: readonly SentimentCheckPoint[],
  box: { left: number; right: number; top: number; bottom: number }
): TrendPoint[] {
  const times = trend.map((point) => Date.parse(point.checkedAt))
  const first = Math.min(...times)
  const last = Math.max(...times)
  const span = last - first
  const mid = (box.top + box.bottom) / 2
  return trend.map((point, index) => {
    const net = pointNet(point)
    const time = times[index] ?? first
    const x =
      trend.length === 1 || span === 0
        ? (box.left + box.right) / 2
        : box.left + ((time - first) / span) * (box.right - box.left)
    const y = net === null ? mid : mid - (net / 100) * ((box.bottom - box.top) / 2)
    return { point, net, total: pointCounts(point).total, x, y }
  })
}

/** Status line while Claude still reads, or after a reading failed. Null when all are read. */
export function readingLine(reading: SentimentReading): string | null {
  if (reading.running) return 'CiteFox AI is reading the saved overviews. No new searches.'
  if (reading.pending > 0) {
    // Nothing is reading now (Claude was unavailable or the report was stopped).
    const noun = countNoun(reading.pending, 'overview', 'overviews')
    return `${noun} not read yet. Re-read saved overviews to read them. No new searches.`
  }
  if (reading.failed > 0) {
    const noun = countNoun(reading.failed, 'overview', 'overviews')
    return `${noun} could not be read. Re-read saved overviews to try again.`
  }
  return null
}

/** Client-side check before `sentiment:saveBrandPrompts`. Null when the drafts can be saved. */
export function brandPromptProblem(
  drafts: readonly BrandPromptDraft[],
  brandNames: readonly string[]
): string | null {
  if (drafts.length === 0) return 'Add at least one brand question.'
  const names = brandNames.map((name) => name.trim().toLowerCase()).filter(Boolean)
  for (const [index, draft] of drafts.entries()) {
    const text = draft.text.trim()
    const row = `Brand question ${index + 1}`
    if (text.length < 3) return `${row} is empty. Write the question or remove the row.`
    if (text.length > BRAND_PROMPT_MAX_LENGTH) {
      return `${row} is longer than ${BRAND_PROMPT_MAX_LENGTH} characters.`
    }
    if (names.length > 0 && !names.some((name) => text.toLowerCase().includes(name))) {
      return `${row} doesn't name ${brandNames[0] ?? 'the brand'}. Brand questions name the brand on purpose.`
    }
  }
  const seen = new Set<string>()
  for (const draft of drafts) {
    const key = `${draft.language}\0${draft.text.trim().toLowerCase()}`
    if (seen.has(key)) return 'Two brand questions are the same. Remove one.'
    seen.add(key)
  }
  return null
}

export type AnswerSortKey = 'prompt' | 'tone' | 'theme' | 'rank'

const TONE_ORDER: Readonly<Record<ClaimTone, number>> = { positive: 0, neutral: 1, negative: 2 }

export function filterAnswers(
  rows: readonly AnswerRow[],
  query: string,
  tone: ClaimTone | 'all'
): AnswerRow[] {
  const needle = query.trim().toLowerCase()
  return rows.filter((row) => {
    if (tone !== 'all' && row.tone !== tone) return false
    if (!needle) return true
    return [row.promptText, row.promptLabel, row.reason ?? '', row.theme ?? '']
      .join(' ')
      .toLowerCase()
      .includes(needle)
  })
}

export function sortAnswers(
  rows: readonly AnswerRow[],
  sorts: readonly SortSpec<AnswerSortKey>[]
): AnswerRow[] {
  const value = (row: AnswerRow, key: AnswerSortKey): string | number => {
    if (key === 'prompt') return row.promptText.toLowerCase()
    if (key === 'tone') return TONE_ORDER[row.tone]
    if (key === 'theme') return (row.theme ?? '￿').toLowerCase()
    return row.rank ?? Number.MAX_SAFE_INTEGER
  }
  return [...rows].sort((left, right) => {
    for (const sort of sorts) {
      const a = value(left, sort.key)
      const b = value(right, sort.key)
      if (a === b) continue
      const order = a < b ? -1 : 1
      return sort.dir === 'asc' ? order : -order
    }
    return 0
  })
}

/** Short display for a URL: host and path, no scheme or `www.`. */
export function displayUrl(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/^www\./, '')
}

/**
 * An opaque key for a theme on the URL (`sth.id`): a short hash of its name,
 * so the address carries no free text.
 */
export function themeKey(theme: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < theme.length; index += 1) {
    hash ^= theme.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return `t${hash.toString(36)}`
}
