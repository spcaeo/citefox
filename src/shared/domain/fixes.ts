/** Progress and fixes (SRS section 4.14, REPORT-SPEC section 6). */
import type { FixMeasure } from '../fix-verdict'
import type { PromptCheckStatus } from './checks'
import { isOneOf } from './one-of'
import type { FixRecheckRule } from './schedule'

/**
 * FR-14.7. One targeted prompt's result from its before and after checks.
 * `worked` is gained or improved (section 7.3), `got_worse` is lost or declined.
 * `not_checked` means the before or the after check has no result for it.
 */
const FIX_PROMPT_RESULTS = ['worked', 'no_change', 'got_worse', 'not_checked'] as const

export type FixPromptResult = (typeof FIX_PROMPT_RESULTS)[number]

/**
 * FR-14.7. One fix in one market. `waiting` means there is no after check yet.
 * `partly` is some targeted prompts better, not all.
 */
const FIX_VERDICTS = ['worked', 'partly', 'no_change', 'got_worse', 'waiting'] as const

export type FixVerdict = (typeof FIX_VERDICTS)[number]

/**
 * `planned`: the follow-up has not started. `started`: "Run follow-up now" started a
 * job that has not finished. `completed`: the follow-up run is stored.
 */
const FIX_STATUSES = ['planned', 'started', 'completed'] as const

export type FixStatus = (typeof FIX_STATUSES)[number]

/**
 * What a logged change is (the Changes ledger): a page that did not exist before, a
 * rewrite of an existing page, or a smaller fix on it. Stored in `fixes.kind`
 * (project migration 043); fixes logged before that are `fix`.
 */
const FIX_KINDS = ['new_page', 'rewrite', 'fix'] as const

export type FixKind = (typeof FIX_KINDS)[number]

export const FIX_KIND_OPTIONS: readonly { id: FixKind; label: string }[] = [
  { id: 'new_page', label: 'New page' },
  { id: 'rewrite', label: 'Rewrite' },
  { id: 'fix', label: 'Fix' }
]

export function isFixKind(value: unknown): value is FixKind {
  return typeof value === 'string' && isOneOf(FIX_KINDS, value)
}

export function fixKindLabel(kind: FixKind): string {
  return FIX_KIND_OPTIONS.find((option) => option.id === kind)?.label ?? 'Fix'
}

/** A prompt's status in one check, the same values Results shows. */
export interface FixPromptState {
  status: PromptCheckStatus
  /** Reference position of the tracked page where cited. */
  position: number | null
}

export interface FixPromptOutcome {
  promptId: string
  promptPosition: number
  label: string
  text: string
  /** Null when the before check has no result for this prompt. */
  before: FixPromptState | null
  /** Null when there is no after check yet, or it has no result for this prompt. */
  after: FixPromptState | null
  result: FixPromptResult
}

/**
 * FR-14.7 comparison. Non-targeted prompts that moved between the last full
 * check before go-live and the first full check after it. Never a claim of cause.
 */
export interface FixOtherPrompts {
  /** Non-targeted prompts compared (in both checks). */
  total: number
  moved: number
  /** `promptIds.length` is `moved` (NFR-14). */
  promptIds: readonly string[]
  fromRunId: string
  toRunId: string
}

/** One fix in one of its markets. */
export interface FixMarketOutcome {
  marketId: string
  /** Last full check in this market that finished before go-live. */
  beforeRunId: string | null
  beforeAt: string | null
  /**
   * The follow-up run in this market when it ran, else the first finished check
   * after go-live. Null while waiting.
   */
  afterRunId: string | null
  afterAt: string | null
  /** True when the after check is a partial follow-up (FR-14.6). */
  afterPartial: boolean
  verdict: FixVerdict
  /** Prompts with both a before and an after result. */
  compared: number
  /** Prompts whose result is `worked`. */
  worked: number
  /** Prompts whose result is `got_worse`. */
  worse: number
  /** Targeted prompts in prompt order. */
  prompts: readonly FixPromptOutcome[]
  /** Null until a full check after go-live exists. */
  others: FixOtherPrompts | null
}

/** A logged fix and what happened (FR-14.5, FR-14.7). */
export interface LoggedFix {
  id: string
  pageId: string
  /** Per page, from 1. */
  number: number
  /** New page, rewrite or fix (the Changes ledger). */
  kind: FixKind
  /** What changed. Untrusted text: render with the Markdown component. */
  description: string
  /** ISO-8601 UTC go-live. */
  goLiveAt: string
  rule: FixRecheckRule
  /** Targeted prompts, in the order picked. */
  promptIds: readonly string[]
  marketIds: readonly string[]
  status: FixStatus
  /** ISO-8601 UTC planned follow-up, earliest across markets. Null once started or completed. */
  followUpAt: string | null
  /** Job started by "Run follow-up now", or the scheduled job once linked. */
  followUpJobId: string | null
  followUpRunId: string | null
  /** ISO-8601 UTC. Null for fixes logged before this was stored. */
  createdAt: string | null
  /** Stored FR-14.7 text for the first market, such as "Partly worked · 1 of 3 prompts". */
  verdict: string | null
  /** One per market in `marketIds`, same order. */
  markets: readonly FixMarketOutcome[]
  /** The page address the fix is about, when it is not its page's own. */
  url?: string | null
  /** The What to fix page fix it was logged from ("I published this"). */
  pageFixId?: string | null
  /** Its searches before go-live and now, wherever they are asked: the verdict reads this. */
  measure?: FixMeasure
}

/** `fixes:list`. Fixes ordered by number. */
export interface FixList {
  pageId: string
  fixes: readonly LoggedFix[]
  nextFixNumber: number
}

/**
 * `fixes:preview` (FR-14.5). The follow-up date per rule and its search cost.
 * Searches are prompts × markets × samples, up to twice that when an overview
 * needs its second call (section 6.1).
 */
export interface FixPlanPreview {
  nextFixNumber: number
  followUpAt: {
    after_3_days: string
    after_7_days: string
    /** Null when the page has no scheduled check (paused or not tracked). */
    next_scheduled: string | null
  }
  samples: number
  searchesMin: number
  searchesMax: number
}

/** "Worked", "Partly worked · 1 of 3 prompts", "No change", "Got worse", "Waiting for the follow-up". */
export function fixVerdictLabel(verdict: FixVerdict, worked: number, compared: number): string {
  if (verdict === 'worked') return 'Worked'
  if (verdict === 'partly') {
    return `Partly worked · ${worked} of ${compared} ${compared === 1 ? 'prompt' : 'prompts'}`
  }
  if (verdict === 'no_change') return 'No change'
  if (verdict === 'got_worse') return 'Got worse'
  return 'Waiting for the follow-up'
}

export function isFixPromptResult(value: string): value is FixPromptResult {
  return isOneOf(FIX_PROMPT_RESULTS, value)
}

export function isFixVerdict(value: string): value is FixVerdict {
  return isOneOf(FIX_VERDICTS, value)
}

export function isFixStatus(value: string): value is FixStatus {
  return isOneOf(FIX_STATUSES, value)
}
