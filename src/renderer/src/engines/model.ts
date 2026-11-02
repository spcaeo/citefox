import {
  ENGINE_IDS,
  ENGINE_LABEL,
  isEngineId,
  MICROS_PER_USD,
  type EngineAnswerStatus,
  type EngineId
} from '@shared/domain'
import type { EngineCounts, QuestionEngineStatuses } from '@shared/ipc'

/**
 * Multi-engine screens (Engines.dc.html panels 2 and 3): the engine filter, the dot per
 * engine on a question row and the per-engine tabs of a question. Google AI Overview is
 * the engine every screen showed before, so "All" and Google keep today's views.
 */

/** The engine filter's URL key on every results screen (`?engine=chatgpt`). */
export const ENGINE_PARAM = 'engine'
/** The question detail's engine tab (`?eng=chatgpt`). */
export const ENGINE_TAB_PARAM = 'eng'

/** `all`, or one engine. */
export type EngineFilter = 'all' | EngineId

/** Short names for the filter, where six full names would not fit a row. */
const SHORT_LABEL: Readonly<Record<EngineId, string>> = {
  ...ENGINE_LABEL,
  google_aio: 'Google AI Overview'
}

export function engineLabel(engine: EngineId): string {
  return ENGINE_LABEL[engine]
}

export function engineShortLabel(engine: EngineId): string {
  return SHORT_LABEL[engine]
}

/** The engine a URL value names, when the screen offers it; anything else is All. */
export function parseEngineFilter(
  value: string | null,
  offered: readonly EngineId[]
): EngineFilter {
  return isEngineId(value) && offered.includes(value) ? value : 'all'
}

/**
 * True when a row asked the filter's engine: every row under All. A row with no engine
 * list is a Google AI Overview row (it was made before engines, or the list is Google only).
 */
export function hasEngine(
  rowEngines: readonly EngineId[] | null | undefined,
  filter: EngineFilter
): boolean {
  if (filter === 'all') return true
  return (rowEngines && rowEngines.length > 0 ? rowEngines : ['google_aio']).includes(filter)
}

/** Every engine some row names, in display order (Google AI Overview for rows without a list). */
export function enginesOf(lists: readonly (readonly EngineId[] | null | undefined)[]): EngineId[] {
  const seen = new Set<EngineId>()
  for (const list of lists) {
    if (!list || list.length === 0) seen.add('google_aio')
    else for (const engine of list) seen.add(engine)
  }
  return ENGINE_IDS.filter((engine) => seen.has(engine))
}

/** True when the filter shows another engine than Google AI Overview. */
export function isAnswerFilter(filter: EngineFilter): filter is Exclude<EngineId, 'google_aio'> {
  return filter !== 'all' && filter !== 'google_aio'
}

/**
 * The engines a screen offers: the project's, and any engine with stored answers (a
 * page or topic can check its own), in display order. With one engine there is no filter.
 */
export function offeredEngines(
  projectEngines: readonly EngineId[],
  counts: readonly Pick<EngineCounts, 'engine' | 'checked'>[]
): EngineId[] {
  const seen = new Set<EngineId>(projectEngines)
  for (const count of counts) if (count.checked > 0) seen.add(count.engine)
  return ENGINE_IDS.filter((engine) => seen.has(engine))
}

/** The four looks a dot has, as the legend draws them. */
export type DotKind = 'cited' | 'named' | 'not_cited' | 'none'

export function dotKind(status: EngineAnswerStatus | null | undefined): DotKind {
  if (status === 'cited') return 'cited'
  if (status === 'named') return 'named'
  if (status === 'not_cited') return 'not_cited'
  return 'none'
}

/** A status in plain words, such as "Not cited" or "Unavailable". */
export function statusText(status: EngineAnswerStatus | null | undefined): string {
  switch (status) {
    case 'cited':
      return 'Cited'
    case 'named':
      return 'Named, not cited'
    case 'not_cited':
      return 'Not cited'
    case 'no_answer':
      return 'No answer'
    case 'unavailable':
      return 'Unavailable'
    case 'error':
      return 'Could not check'
    default:
      return 'Not checked'
  }
}

export const LEGEND: readonly { kind: DotKind; label: string }[] = [
  { kind: 'cited', label: 'Cited' },
  { kind: 'named', label: 'Named, not cited' },
  { kind: 'not_cited', label: 'Not cited' },
  { kind: 'none', label: 'No answer or unavailable' }
]

/** Sort order of a status column: cited first, never checked last. */
const STATUS_RANK: readonly (EngineAnswerStatus | null)[] = [
  'cited',
  'named',
  'not_cited',
  'no_answer',
  'unavailable',
  'error',
  null
]

export function statusRank(status: EngineAnswerStatus | null | undefined): number {
  return STATUS_RANK.indexOf(status ?? null)
}

export type StatusMap = ReadonlyMap<string, Partial<Record<EngineId, EngineAnswerStatus>>>

export function questionKey(pageId: string, promptId: string): string {
  return `${pageId}\u0000${promptId}`
}

/** Each question's statuses by page and prompt, in one market. */
export function statusMap(
  questions: readonly QuestionEngineStatuses[],
  marketId: string | null
): Map<string, Partial<Record<EngineId, EngineAnswerStatus>>> {
  const out = new Map<string, Partial<Record<EngineId, EngineAnswerStatus>>>()
  for (const row of questions) {
    if (marketId !== null && row.marketId !== marketId) continue
    const key = questionKey(row.pageId, row.promptId)
    out.set(key, { ...out.get(key), ...row.statuses })
  }
  return out
}

/** Counts per engine, summed over several summaries (one per batch of pages). */
export function mergeCounts(lists: readonly (readonly EngineCounts[])[]): EngineCounts[] {
  const out = new Map<EngineId, EngineCounts>()
  for (const list of lists) {
    for (const count of list) {
      const was = out.get(count.engine)
      if (was === undefined) {
        out.set(count.engine, { ...count })
        continue
      }
      out.set(count.engine, {
        ...was,
        checked: was.checked + count.checked,
        cited: was.cited + count.cited,
        named: was.named + count.named,
        notCited: was.notCited + count.notCited,
        noAnswer: was.noAnswer + count.noAnswer,
        unavailable: was.unavailable + count.unavailable,
        error: was.error + count.error,
        gained: was.gained + count.gained,
        lost: was.lost + count.lost,
        lastCheckedAt:
          was.lastCheckedAt === null ||
          (count.lastCheckedAt !== null && count.lastCheckedAt > was.lastCheckedAt)
            ? count.lastCheckedAt
            : was.lastCheckedAt
      })
    }
  }
  return ENGINE_IDS.flatMap((engine) => out.get(engine) ?? [])
}

/**
 * Each engine's counts over exactly the questions a screen shows (each in its own market),
 * from per-question statuses, so they add up with the screen's Google numbers. The change
 * since the check before is per engine only: it comes from `previous`.
 */
export function scopedCounts(
  shown: readonly { pageId: string; promptId: string; marketId: string | null }[],
  questions: readonly QuestionEngineStatuses[],
  engines: readonly EngineId[],
  previous: readonly EngineCounts[]
): EngineCounts[] {
  const keys = new Set(
    shown.map((item) => `${item.pageId}\u0000${item.marketId ?? ''}\u0000${item.promptId}`)
  )
  // With each question's move known, gained and lost count only the shown questions too,
  // so they open exactly their rows; without it they stay the engine's own counts.
  const scopedMoves = questions.some((row) => row.moved !== undefined)
  return engines.map((engine) => {
    const before = previous.find((count) => count.engine === engine)
    const out: EngineCounts = {
      engine,
      label: ENGINE_LABEL[engine],
      checked: 0,
      cited: 0,
      named: 0,
      notCited: 0,
      noAnswer: 0,
      unavailable: 0,
      error: 0,
      gained: scopedMoves ? 0 : (before?.gained ?? 0),
      lost: scopedMoves ? 0 : (before?.lost ?? 0),
      lastCheckedAt: before?.lastCheckedAt ?? null
    }
    for (const row of questions) {
      if (!keys.has(`${row.pageId}\u0000${row.marketId}\u0000${row.promptId}`)) continue
      const status = row.statuses[engine]
      if (status === undefined) continue
      const move = row.moved?.[engine]
      if (move === 'gained') out.gained += 1
      else if (move === 'lost') out.lost += 1
      out.checked += 1
      if (status === 'cited') out.cited += 1
      else if (status === 'named') out.named += 1
      else if (status === 'not_cited') out.notCited += 1
      else if (status === 'no_answer') out.noAnswer += 1
      else if (status === 'unavailable') out.unavailable += 1
      else out.error += 1
    }
    return out
  })
}

/** Questions that got an answer with sources or text (cited, named or not cited). */
export function answered(count: Pick<EngineCounts, 'cited' | 'named' | 'notCited'>): number {
  return count.cited + count.named + count.notCited
}

/** "$0.006" under a cent, else "$0.11" ("$1,240.50"); nothing spent is "$0". */
export function costText(micros: number): string {
  const usd = micros / MICROS_PER_USD
  if (usd === 0) return '$0'
  if (usd < 0.01) return `$${usd.toFixed(3)}`
  return `$${usd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/** "7 credits · $0.006", or what to say when the answer cost nothing. */
export function spendText(credits: number, costMicros: number): string {
  if (credits <= 0 && costMicros <= 0) return 'No credits used'
  const unit = credits === 1 ? 'credit' : 'credits'
  return costMicros > 0
    ? `${credits.toLocaleString('en-US')} ${unit} · ${costText(costMicros)}`
    : `${credits.toLocaleString('en-US')} ${unit}`
}
