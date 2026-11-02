import type { CheckRunKind, EngineId, GridSortKey } from '@shared/domain'
import type { HistorySubject, ProjectCheck, StartCheckRequest } from '@shared/ipc'
import { engineShortLabel } from '../../engines/model'
import { estimateText } from '../../scope/model'
import { pageHash, runningHash, topicHash } from '../../shell/routes'

/**
 * Check history's state, all of it in the route (owner rule "every state has a
 * URL"): `#/history?scope=…&page=…&market=…&status=…&q=…&sort=…&sel=…&cols=…`.
 * Defaults are left out, so a plain `#/history` is every check, newest first.
 * `compare` is the old Compare content link: it now opens the Compare drawer
 * (`drawer=compare-checks&cmp.a=…&cmp.b=…`) and leaves the URL.
 */
export const PROJECT_HISTORY_QUERY = [
  'scope',
  'page',
  'market',
  'status',
  'q',
  'sort',
  'compare',
  'sel',
  'cols'
] as const

/** The Compare checks drawer's tabs (`cmp.tab`): results first, then the page's content diff. */
export type CompareTab = 'results' | 'content'

export function isCompareTab(value: string | null | undefined): value is CompareTab {
  return value === 'results' || value === 'content'
}

/** All pages and topics, only pages, or only topics. */
export type ScopeFilter = 'all' | 'pages' | 'topics'

/** What the Status column says. A finished partial follow-up is its own state. */
export const CHECK_STATES = [
  { id: 'finished', label: 'Finished' },
  { id: 'partial', label: 'Partial' },
  { id: 'running', label: 'Running' },
  { id: 'cancelled', label: 'Stopped' },
  { id: 'error', label: 'Failed' }
] as const

export type CheckState = (typeof CHECK_STATES)[number]['id']
export type StatusFilter = CheckState | 'all'

/** Every column, in grid order. */
export const COLUMN_IDS = [
  'date',
  'subject',
  'market',
  'kind',
  'engines',
  'questions',
  'score',
  'change',
  'aio',
  'cited',
  'named',
  'searches',
  'credits',
  'cost',
  'status'
] as const

export type ColumnId = (typeof COLUMN_IDS)[number]

/** Columns the Columns menu can hide. Date, the page and the status always show. */
export const OPTIONAL_COLUMNS: readonly { id: ColumnId; label: string }[] = [
  { id: 'market', label: 'Market' },
  { id: 'kind', label: 'Type' },
  { id: 'engines', label: 'Engines' },
  { id: 'questions', label: 'Questions' },
  { id: 'score', label: 'Score' },
  { id: 'change', label: 'Change' },
  { id: 'aio', label: 'Overviews' },
  { id: 'cited', label: 'Cited' },
  { id: 'named', label: 'Named' },
  { id: 'searches', label: 'Searches' },
  { id: 'credits', label: 'Credits' },
  { id: 'cost', label: 'Cost' }
]

/** A window narrower than this starts with fewer columns, so the grid fits without scrolling. */
export const WIDE_WINDOW = 1380

/**
 * Hidden until the Columns menu adds them (audit #10): the date's tooltip has the
 * questions, Spend has the credits and cost, and the type is in the check's own page.
 * Fewer columns leave "Page or topic" room to be read.
 */
const HIDDEN_BY_DEFAULT: readonly ColumnId[] = ['kind', 'questions', 'named', 'credits', 'cost']

const NARROW_COLUMNS: readonly ColumnId[] = [
  'date',
  'subject',
  'market',
  'score',
  'change',
  'cited',
  'status'
]

/**
 * Columns the grid leaves out first while it is narrower than its row (ListGrid
 * `narrowDrops`), so a 1134px window never scrolls sideways, whatever the Columns
 * menu shows. Credits and cost stay longest after the page, date and status;
 * `dropOrder` keeps the columns the Columns menu added longer still.
 */
export const NARROW_DROPS: readonly ColumnId[] = [
  'questions',
  'named',
  'aio',
  'searches',
  'engines',
  'kind',
  'market',
  'change',
  'score'
]

/**
 * The columns shown when `cols` is not in the URL. A wide window shows every
 * column but Type, Questions, Named, Credits and Cost; a 1134px window keeps the
 * ones that answer "when, what, where, did it get better, did it finish". The
 * Columns menu adds the rest back; columns that do not fit are left out in
 * `dropOrder` order.
 */
export function defaultColumns(wide: boolean): ColumnId[] {
  return wide
    ? COLUMN_IDS.filter((id) => !HIDDEN_BY_DEFAULT.includes(id))
    : COLUMN_IDS.filter((id) => NARROW_COLUMNS.includes(id))
}

/** `cols=market,score,…` (the optional ones shown). Unknown ids are dropped; null is the default. */
export function parseColumns(value: string | null, wide: boolean): ColumnId[] {
  if (value === null) return defaultColumns(wide)
  const picked = new Set(value.split(','))
  return COLUMN_IDS.filter(
    (id) => !OPTIONAL_COLUMNS.some((column) => column.id === id) || picked.has(id)
  )
}

/**
 * The order the grid leaves columns out in for the columns shown: `NARROW_DROPS`,
 * except that a column the Columns menu added beyond the window's default leaves
 * last, so ticking it always shows it (a default column gives way instead).
 */
export function dropOrder(shown: readonly ColumnId[], wide: boolean): ColumnId[] {
  const defaults = defaultColumns(wide)
  const added = NARROW_DROPS.filter((id) => shown.includes(id) && !defaults.includes(id))
  return [...NARROW_DROPS.filter((id) => !added.includes(id)), ...added]
}

/** The `cols` value for a set of shown columns: null when it is the default. */
export function columnsParam(shown: readonly ColumnId[], wide: boolean): string | null {
  const optional = OPTIONAL_COLUMNS.map((column) => column.id).filter((id) => shown.includes(id))
  const defaults = OPTIONAL_COLUMNS.map((column) => column.id).filter((id) =>
    defaultColumns(wide).includes(id)
  )
  if (optional.join(',') === defaults.join(',')) return null
  return optional.length === 0 ? 'none' : optional.join(',')
}

const KIND_LABELS: Readonly<Record<CheckRunKind, string>> = {
  baseline: 'Baseline',
  scheduled: 'Scheduled',
  manual: 'Manual',
  follow_up: 'Follow-up'
}

/** Kind sort order: the first check, then the ones a person, the schedule or a fix started. */
export const KIND_ORDER: readonly CheckRunKind[] = ['baseline', 'manual', 'scheduled', 'follow_up']

/** "Google AI Overview, ChatGPT": the engines a check asked. Checks from before engines asked Google. */
export function enginesText(engines: readonly EngineId[] | undefined): string {
  const list = engines && engines.length > 0 ? engines : (['google_aio'] as const)
  return list.map((engine) => engineShortLabel(engine)).join(', ')
}

export function kindLabel(kind: CheckRunKind): string {
  return KIND_LABELS[kind]
}

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/

export function isScopeFilter(value: string | null): value is Exclude<ScopeFilter, 'all'> {
  return value === 'pages' || value === 'topics'
}

export function isCheckState(value: string | null): value is CheckState {
  return CHECK_STATES.some((state) => state.id === value)
}

export function checkState(check: ProjectCheck): CheckState {
  if (check.status === 'finished') return check.partial ? 'partial' : 'finished'
  return check.status
}

export function stateLabel(state: CheckState): string {
  return CHECK_STATES.find((item) => item.id === state)?.label ?? state
}

export interface CheckFilters {
  scope: ScopeFilter
  /** One page or topic id. Wins over `scope`. */
  subjectId: string | null
  marketId: string | null
  status: StatusFilter
}

/** The checks the scope, market and status filters keep, in the order given. */
export function filterChecks(
  checks: readonly ProjectCheck[],
  subjects: ReadonlyMap<string, HistorySubject>,
  filters: CheckFilters
): ProjectCheck[] {
  return checks.filter((check) => {
    if (filters.subjectId !== null) {
      if (check.pageId !== filters.subjectId) return false
    } else if (filters.scope !== 'all') {
      const kind = subjects.get(check.pageId)?.kind
      if (kind !== (filters.scope === 'topics' ? 'topic' : 'page')) return false
    }
    if (filters.marketId !== null && check.marketId !== filters.marketId) return false
    return filters.status === 'all' || checkState(check) === filters.status
  })
}

/** Checks per state, for the status filter's counts. */
export function stateCounts(checks: readonly ProjectCheck[]): Record<StatusFilter, number> {
  const counts: Record<StatusFilter, number> = {
    all: checks.length,
    finished: 0,
    partial: 0,
    running: 0,
    cancelled: 0,
    error: 0
  }
  for (const check of checks) counts[checkState(check)] += 1
  return counts
}

/** The day a check started on the computer's own calendar, as `2026-10-19`: its Day group. */
export function dayKey(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return 'unknown'
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** `date:desc,cited:asc`. Unknown columns and repeats are dropped. */
export function parseSort(value: string | null): GridSortKey[] {
  if (!value) return []
  const out: GridSortKey[] = []
  for (const part of value.split(',')) {
    const [key, dir] = part.split(':')
    if (!key || !(COLUMN_IDS as readonly string[]).includes(key)) continue
    if (out.some((item) => item.key === key)) continue
    out.push({ key, dir: dir === 'desc' ? 'desc' : 'asc' })
  }
  return out
}

export function sortParam(sort: readonly GridSortKey[]): string | null {
  return sort.length === 0 ? null : sort.map((item) => `${item.key}:${item.dir}`).join(',')
}

/** Run ids of `sel=a,b,c`: well-formed ids only, no repeats. */
export function parseSelection(value: string | null): string[] {
  if (!value) return []
  return [...new Set(value.split(',').filter((id) => ID.test(id)))]
}

export function selectionParam(ids: readonly string[]): string | null {
  return ids.length === 0 ? null : ids.join(',')
}

/** The two run ids of `?compare=<older>,<newer>`. Null when the value is not two ids. */
export function parseCompare(value: string | null): readonly [string, string] | null {
  if (!value) return null
  const [from, to, ...rest] = value.split(',')
  if (!from || !to || rest.length > 0 || from === to) return null
  return ID.test(from) && ID.test(to) ? [from, to] : null
}

/** Older first, so a comparison reads before → after. */
export function olderFirst(
  left: ProjectCheck,
  right: ProjectCheck
): readonly [ProjectCheck, ProjectCheck] {
  return left.startedAt <= right.startedAt ? [left, right] : [right, left]
}

/**
 * Why two checks cannot be compared, or null when they can. Any two checks of
 * the same page or topic compare (their results side by side), whatever they
 * read; checks of two different pages or topics do not.
 */
export function compareBlock(selected: readonly ProjectCheck[]): string | null {
  if (selected.length !== 2) return 'Pick exactly two checks of the same page or topic to compare.'
  const [left, right] = selected as readonly [ProjectCheck, ProjectCheck]
  if (left.pageId !== right.pageId) {
    return 'These checks are of different pages or topics: their questions are not the same.'
  }
  return null
}

/**
 * Whether the Compare drawer's "Page content" tab has anything to show, and why
 * not: it diffs the page each check read, so both must be checks of a page that
 * read different versions of it.
 */
export function contentBlock(
  pair: readonly [ProjectCheck, ProjectCheck],
  subjects: ReadonlyMap<string, HistorySubject>
): string | null {
  const [left, right] = pair
  if (subjects.get(left.pageId)?.kind !== 'page')
    return 'A topic has no page of its own to compare.'
  if (left.snapshotId === right.snapshotId) {
    return 'Both checks read the same version of the page: its content did not change.'
  }
  return null
}

/** The check before this one of the same page or topic in the same market. */
export function previousCheck(
  check: ProjectCheck,
  checks: readonly ProjectCheck[]
): ProjectCheck | null {
  return (
    checks
      .filter(
        (item) =>
          item.runId !== check.runId &&
          item.pageId === check.pageId &&
          item.marketId === check.marketId &&
          item.startedAt <= check.startedAt
      )
      .sort((a, b) => (a.startedAt < b.startedAt ? 1 : a.startedAt > b.startedAt ? -1 : 0))[0] ??
    null
  )
}

/** Where a row opens: that check's results (a running page check opens its progress). */
export function checkHash(check: ProjectCheck, subject: HistorySubject | undefined): string {
  const scope = { marketId: check.marketId, runId: check.runId }
  if (subject?.kind === 'topic') return topicHash(check.pageId, scope)
  if (check.status === 'running') return runningHash(check.pageId)
  return pageHash(check.pageId, 'results', scope)
}

/** `checks:start` for the same page, market and questions as `check`. */
export function rerunRequest(projectId: string, check: ProjectCheck): StartCheckRequest {
  return {
    projectId,
    pageIds: [check.pageId],
    marketIds: [check.marketId],
    promptIds: check.promptIds === null ? null : [...check.promptIds]
  }
}

/** `checks:start` for only the questions `check` has no result for. */
export function retryRequest(projectId: string, check: ProjectCheck): StartCheckRequest {
  return {
    projectId,
    pageIds: [check.pageId],
    marketIds: [check.marketId],
    promptIds: [...check.failedPromptIds]
  }
}

/** Questions a re-run asks: a follow-up's own list, else every enabled question. */
export function rerunQuestions(check: ProjectCheck): number {
  return check.promptIds?.length ?? check.questionsTotal
}

/** "About 3–6 searches": questions × samples, once or twice each (an overview's second call). */
export function searchCost(questions: number, samples: number): string {
  const min = questions * samples
  return estimateText({ min, max: min * 2, pages: 1 })
}

/** True when Retry failed questions applies: an ended check with questions left without a result. */
export function canRetry(check: ProjectCheck): boolean {
  return check.status !== 'running' && check.failedPromptIds.length > 0
}

// Score change text and tone are the page History tab's, so both read the same.
export { changeText, changeTone } from '../model'

/** "1m 30s", "12s", "2h 5m". An em dash while it runs. */
export function durationText(ms: number | null): string {
  if (ms === null) return '—'
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

/** The page's path, such as `/blog/text-alerts/`. The full URL when it does not parse. */
export function pathOf(url: string): string {
  try {
    const parsed = new URL(url)
    return `${parsed.pathname}${parsed.search}` || '/'
  } catch {
    return url
  }
}
