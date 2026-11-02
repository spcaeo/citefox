import type { PromptCheckStatus } from '@shared/domain'
import { formatMoment } from '../utils/dates'
import type { ChipTone } from './Chip'
import { GOOGLE_WORDS, type ResultWords } from './resultWords'

/**
 * What a check found for one question, in the words every grid shares (grid
 * audit R7). `own_page` is another page of the same site; `no_overview` and
 * `not_checked` are not results, so they show as faint text, not a pill.
 */
export type ResultKind =
  'cited' | 'named' | 'own_page' | 'not_cited' | 'failed' | 'no_overview' | 'not_checked'

/** The label of each result: its tone, and the text and ground tokens it is drawn in. */
export interface ResultTone {
  tone: ChipTone
  className?: string
  /** For the contrast test: the label colour and the ground it sits on (styles/tokens.css). */
  ink: string
  ground: string
  /** The small square before the label, in the result's colour (ui/views.css `.ui-result`). */
  mark: string | null
}

/**
 * One colour map for every result label: grey text after a small square in
 * the result's colour, cited green, your other page blue, not cited orange,
 * failed red (owner, 2026-10-30: colour only on result marks, no tinted pills).
 * Named is a plain outlined chip beside the result.
 */
export const RESULT_TONES: Readonly<
  Record<Exclude<ResultKind, 'no_overview' | 'not_checked'>, ResultTone>
> = {
  cited: { tone: 'ok', ink: '--ink-2', ground: '--surface', mark: '--result-target' },
  named: {
    tone: 'neutral',
    className: 'ui-result-named',
    ink: '--ink-2',
    ground: '--surface',
    mark: null
  },
  own_page: { tone: 'info', ink: '--ink-2', ground: '--surface', mark: '--result-other' },
  not_cited: {
    tone: 'neutral',
    className: 'ui-result-not-cited',
    ink: '--ink-2',
    ground: '--surface',
    mark: '--result-not-cited'
  },
  failed: { tone: 'bad', ink: '--bad', ground: '--surface', mark: '--bad' }
}

export const DEFAULT_RESULT_LABEL: Readonly<Record<ResultKind, string>> = {
  cited: 'Cited',
  named: 'Named',
  own_page: 'Your other page',
  not_cited: 'Not cited',
  failed: 'Check failed',
  no_overview: 'No AI Overview',
  not_checked: 'Not checked'
}

/** A check row's status as a result. */
export function resultOfCheck(status: PromptCheckStatus): ResultKind {
  switch (status) {
    case 'page_cited':
      return 'cited'
    case 'other_own_page':
      return 'own_page'
    case 'brand_mentioned':
      return 'named'
    case 'not_cited':
      return 'not_cited'
    case 'no_aio':
      return 'no_overview'
    case 'error':
      return 'failed'
  }
}

/**
 * The four results a search ends in, as every bar, legend, group row and
 * "What to do" line shows them (owner, 2026-10-29). Named counts as not
 * cited: the brand is in the answer but no page of the site is.
 */
export type ResultBucket = 'not_cited' | 'other_page' | 'target' | 'no_overview'

export interface ResultBucketInfo {
  key: ResultBucket
  /** The word in a group row or a chip: "Not cited". */
  label: string
  /** The word after a count in a legend: "96 not cited". */
  legend: string
  /** Fill of a bar segment, a dot or a group-row marker (styles/tokens.css). */
  colour: string
  /** Text in that colour, AA on `tint`. */
  ink: string
  /** Pill and chip ground. */
  tint: string
  /** The "What to do" line without its date ({@link whatToDo} adds it). */
  todo: string
}

/** In the order bars and legends draw them: the work first, the quiet ones last. */
export const RESULT_BUCKETS: readonly ResultBucketInfo[] = [
  {
    key: 'not_cited',
    label: 'Not cited',
    legend: 'not cited',
    colour: 'var(--result-not-cited)',
    ink: 'var(--result-not-cited-ink)',
    tint: 'var(--result-not-cited-tint)',
    todo: 'Improve the target page, highest win odds first.'
  },
  {
    key: 'other_page',
    label: 'Your other page',
    legend: 'your other page',
    colour: 'var(--result-other)',
    ink: 'var(--result-other-ink)',
    tint: 'var(--result-other-tint)',
    todo: 'Keep that page as the owner, or strengthen the target page.'
  },
  {
    key: 'target',
    label: 'Right page',
    legend: 'right page cited',
    colour: 'var(--result-target)',
    ink: 'var(--result-target-ink)',
    tint: 'var(--result-target-tint)',
    todo: 'Done.'
  },
  {
    key: 'no_overview',
    label: 'No AI Overview',
    legend: 'no AI Overview',
    colour: 'var(--result-none)',
    ink: 'var(--result-none-ink)',
    tint: 'var(--result-none-tint)',
    todo: 'Nothing to do.'
  }
]

const BUCKETS_BY_KEY = new Map(RESULT_BUCKETS.map((bucket) => [bucket.key, bucket]))

export function resultBucket(key: ResultBucket): ResultBucketInfo {
  return BUCKETS_BY_KEY.get(key) as ResultBucketInfo
}

export function isResultBucket(value: string | null | undefined): value is ResultBucket {
  return value !== null && value !== undefined && BUCKETS_BY_KEY.has(value as ResultBucket)
}

/** A result as one of the four. Failed and not checked are not results yet: null. */
export function bucketOfResult(kind: ResultKind): ResultBucket | null {
  switch (kind) {
    case 'cited':
      return 'target'
    case 'own_page':
      return 'other_page'
    case 'named':
    case 'not_cited':
      return 'not_cited'
    case 'no_overview':
      return 'no_overview'
    case 'failed':
    case 'not_checked':
      return null
  }
}

/** A check row's status as one of the four. */
export function bucketOfCheck(status: PromptCheckStatus): ResultBucket | null {
  return bucketOfResult(resultOfCheck(status))
}

/** How many searches ended in each result. */
export type ResultCounts = Readonly<Record<ResultBucket, number>>

export const NO_RESULTS: ResultCounts = { not_cited: 0, other_page: 0, target: 0, no_overview: 0 }

/** Counts of each result in `items`; items with no result (failed, not checked) are left out. */
export function countResults<T>(
  items: readonly T[],
  bucketOf: (item: T) => ResultBucket | null
): ResultCounts {
  const out = { ...NO_RESULTS }
  for (const item of items) {
    const bucket = bucketOf(item)
    if (bucket !== null) out[bucket] += 1
  }
  return out
}

/** Adds result counts, such as children up to their parent. */
export function addResults(...counts: readonly ResultCounts[]): ResultCounts {
  const out = { ...NO_RESULTS }
  for (const part of counts)
    for (const bucket of RESULT_BUCKETS) out[bucket.key] += part[bucket.key]
  return out
}

export function totalResults(counts: ResultCounts): number {
  return counts.not_cited + counts.other_page + counts.target + counts.no_overview
}

/**
 * The "What to do" line of a result. No AI Overview names the next check:
 * "Nothing to do; checked again Oct 30, 10:27 AM".
 */
export function whatToDo(key: ResultBucket, options: { nextCheckAt?: string | null } = {}): string {
  const bucket = resultBucket(key)
  if (key === 'no_overview' && options.nextCheckAt) {
    return `Nothing to do; checked again ${formatMoment(options.nextCheckAt)}.`
  }
  return bucket.todo
}

/** A result's word in a group row or chip, on the picked engine ("No answer" on ChatGPT). */
export function bucketLabel(key: ResultBucket, words: ResultWords = GOOGLE_WORDS): string {
  if (key === 'target' && words.cited) return words.cited.label
  return key === 'no_overview' ? words.none : resultBucket(key).label
}

/** A result's word after a count, on the picked engine ("34 no answer" on ChatGPT). */
export function bucketLegend(key: ResultBucket, words: ResultWords = GOOGLE_WORDS): string {
  if (key === 'target' && words.cited) return words.cited.legend
  return key === 'no_overview' ? words.noneLegend : resultBucket(key).legend
}

/** "96 not cited, 38 your other page, 72 target page cited, 34 no AI Overview". */
export function resultBarText(counts: ResultCounts, words: ResultWords = GOOGLE_WORDS): string {
  return RESULT_BUCKETS.map(
    (bucket) => `${counts[bucket.key].toLocaleString('en-US')} ${bucketLegend(bucket.key, words)}`
  ).join(', ')
}
