import {
  SEARCHES_PER_PROMPT_MAX,
  SEARCHES_PER_PROMPT_MIN,
  type GridSortKey,
  type PageKind,
  type TopicPromptKind
} from '@shared/domain'
import {
  isQuestionChange,
  isQuestionResult,
  type QuestionChange,
  type QuestionResult,
  type QuestionRow,
  type QuestionSource
} from '@shared/ipc'
import { resultBucket, resultOfCheck, type ResultBucket, type ResultKind } from '../ui/resultTones'

/** How rows are grouped: by topic, journey stage or target page, or one flat list. */
export type GroupMode = 'topic' | 'stage' | 'target' | 'none'

export const GROUP_MODES: readonly GroupMode[] = ['topic', 'stage', 'target', 'none']

/** The drawer open over the list: Claude sorting "Not in a topic", or picking a target page. */
export type QuestionsPanel = 'sort' | 'target'

/** The small confirm open over the list: re-check the picked questions. */
export type QuestionsConfirm = 'recheck'

/**
 * Everything the screen shows that a link should bring back (owner rule "every state
 * has a URL"): `#/questions?q=…&kind=…&source=…&result=…&change=…&market=…&sort=…&group=…&row=…&panel=…&confirm=…&pick=…`.
 * Defaults are left out of the URL.
 */
export interface QuestionsView {
  /** Search text. */
  q: string
  kind: PageKind | null
  /** Buyer questions or keywords (short topic searches) only. Null shows both. */
  type: TopicPromptKind | null
  /** One page or topic id. */
  source: string | null
  result: QuestionResult | null
  change: QuestionChange | null
  market: string | null
  sort: readonly GridSortKey[]
  group: GroupMode
  /** The question last opened, marked in the list. */
  row: string | null
  panel: QuestionsPanel | null
  confirm: QuestionsConfirm | null
  /** The questions the target drawer sets or the re-check confirm checks (prompt ids). Else empty. */
  pick: readonly string[]
}

export const COLUMN_IDS = [
  'question',
  'kind',
  'source',
  'stage',
  'target',
  'result',
  'instead',
  'sentiment',
  'change',
  'checked'
] as const

/** The query keys this screen owns. Any other key (such as `dialog`) is left as it is. */
export const VIEW_KEYS = [
  'q',
  'kind',
  'type',
  'source',
  'result',
  'change',
  'market',
  'sort',
  'group',
  'row',
  'panel',
  'confirm',
  'pick'
] as const

export const DEFAULT_VIEW: QuestionsView = {
  q: '',
  kind: null,
  type: null,
  source: null,
  result: null,
  change: null,
  market: null,
  sort: [],
  group: 'topic',
  row: null,
  panel: null,
  confirm: null,
  pick: []
}

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/

function id(value: string | null): string | null {
  return value !== null && ID.test(value) ? value : null
}

/** The view a query string describes. Unknown or malformed values fall back to the default. */
export function parseView(query: string): QuestionsView {
  const params = new URLSearchParams(query.startsWith('?') ? query.slice(1) : query)
  const kind = params.get('kind')
  const type = params.get('type')
  const result = params.get('result')
  const change = params.get('change')
  const panel = params.get('panel')
  const confirm = params.get('confirm') === 'recheck' ? 'recheck' : null
  return {
    q: params.get('q') ?? '',
    kind: kind === 'page' || kind === 'topic' ? kind : null,
    type: type === 'question' || type === 'keyword' ? type : null,
    source: id(params.get('source')),
    result: result !== null && isQuestionResult(result) ? result : null,
    change: change !== null && isQuestionChange(change) ? change : null,
    market: id(params.get('market')),
    sort: parseSort(params.get('sort')),
    group: parseGroup(params.get('group')),
    row: id(params.get('row')),
    panel: panel === 'sort' || panel === 'target' ? panel : null,
    confirm,
    pick: panel === 'target' || confirm !== null ? parsePick(params.get('pick')) : []
  }
}

/** `topic` (the default), `stage`, `target` or `none`. The old `source` grouping is `topic`. */
export function parseGroup(value: string | null): GroupMode {
  return GROUP_MODES.find((mode) => mode === value) ?? 'topic'
}

/** At most this many picked ids ride in the URL. */
const PICK_MAX = 200

function parsePick(value: string | null): string[] {
  if (!value) return []
  const out: string[] = []
  for (const part of value.split(',')) {
    const one = id(part)
    if (one !== null && !out.includes(one)) out.push(one)
    if (out.length === PICK_MAX) break
  }
  return out
}

function parseSort(value: string | null): GridSortKey[] {
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

/** The query string for a view, keeping keys this screen does not own. No leading `?`. */
export function viewQuery(view: QuestionsView, current: string = ''): string {
  const params = new URLSearchParams(current.startsWith('?') ? current.slice(1) : current)
  for (const key of VIEW_KEYS) params.delete(key)
  const set = (key: string, value: string | null): void => {
    if (value !== null && value !== '') params.set(key, value)
  }
  set('q', view.q.trim() === '' ? null : view.q)
  set('kind', view.kind)
  set('type', view.type)
  set('source', view.source)
  set('result', view.result)
  set('change', view.change)
  set('market', view.market)
  set('sort', view.sort.map((item) => `${item.key}:${item.dir}`).join(','))
  set('group', view.group === 'topic' ? null : view.group)
  set('row', view.row)
  set('panel', view.panel)
  set('confirm', view.confirm)
  set(
    'pick',
    view.panel === 'target' || view.confirm !== null ? view.pick.slice(0, PICK_MAX).join(',') : null
  )
  return params.toString()
}

/** True when a chip filter is on (search is the grid's own). */
export function isFiltered(view: QuestionsView): boolean {
  return (
    view.kind !== null ||
    view.type !== null ||
    view.source !== null ||
    view.result !== null ||
    view.change !== null
  )
}

/** The rows the chip filters keep, in the order given. */
export function filterRows(
  rows: readonly QuestionRow[],
  sources: ReadonlyMap<string, QuestionSource>,
  view: QuestionsView
): QuestionRow[] {
  return rows.filter((row) => {
    if (view.source !== null && row.sourceId !== view.source) return false
    if (view.kind !== null && sources.get(row.sourceId)?.kind !== view.kind) return false
    if (view.type !== null && row.promptKind !== view.type) return false
    if (view.result !== null && row.result !== view.result) return false
    if (view.change !== null && row.change !== view.change) return false
    return true
  })
}

export const RESULT_LABEL: Readonly<Record<QuestionResult, string>> = {
  cited: 'Cited',
  named: 'Named, not cited',
  not_cited: 'Not cited',
  no_overview: 'No AI Overview',
  error: 'Check failed',
  not_checked: 'Not checked'
}

export const CHANGE_LABEL: Readonly<Record<QuestionChange, string>> = {
  gained: 'Gained',
  lost: 'Lost',
  new_overview: 'New overview',
  gone: 'Overview gone',
  none: 'No change'
}

/** Best first, so an ascending sort puts cited questions on top. */
const RESULT_RANK: Readonly<Record<QuestionResult, number>> = {
  cited: 0,
  named: 1,
  not_cited: 2,
  no_overview: 3,
  error: 4,
  not_checked: 5
}

const CHANGE_RANK: Readonly<Record<QuestionChange, number>> = {
  gained: 0,
  lost: 1,
  new_overview: 2,
  gone: 3,
  none: 4
}

/** Cited questions by position, then named, not cited, and so on. */
export function resultSort(row: QuestionRow): number {
  return RESULT_RANK[row.result] * 100 + (row.position ?? 99)
}

export function changeSort(row: QuestionRow): number | null {
  return row.change === 'none' ? null : CHANGE_RANK[row.change]
}

/**
 * A question's latest check as a result kind: the rolled-up status when there
 * is one (target page, your other page, named, …), else its result.
 */
export function questionResultKind(row: QuestionRow): ResultKind {
  if (row.status) return resultOfCheck(row.status)
  switch (row.result) {
    case 'cited':
      return 'cited'
    case 'named':
      return 'named'
    case 'not_cited':
      return 'not_cited'
    case 'no_overview':
      return 'no_overview'
    case 'error':
      return 'failed'
    case 'not_checked':
      return 'not_checked'
  }
}

/** One of the four results (Named counts as not cited), or null for failed and not checked. */
export function questionBucket(row: QuestionRow): ResultBucket | null {
  const kind = questionResultKind(row)
  if (kind === 'cited') return 'target'
  if (kind === 'own_page') return 'other_page'
  if (kind === 'named' || kind === 'not_cited') return 'not_cited'
  if (kind === 'no_overview') return 'no_overview'
  return null
}

/**
 * The result in the four shared words (audit2 #3): "Target page", "Your other
 * page", "Not cited", "No AI Overview"; else "Check failed" or "Not checked".
 * Google's place and "Named" are shown apart, never in the result word.
 */
export function resultText(row: QuestionRow): string {
  if (!row.inMarket) return 'Not in this market'
  const bucket = questionBucket(row)
  if (bucket !== null) return resultBucket(bucket).label
  return questionResultKind(row) === 'failed' ? 'Check failed' : 'Not checked'
}

/** A page's path, or "Topic · <name>". */
export function sourceLabel(source: QuestionSource | undefined): string {
  if (!source) return 'Unknown'
  return source.kind === 'topic' ? `Topic · ${source.name}` : (source.path ?? source.name)
}

export interface QuestionKpis {
  tracked: number
  /** How many of `tracked` are keywords (short topic searches) rather than questions. */
  keywords: number
  overviews: number
  cited: number
  named: number
}

/** Tracked questions are the enabled ones (keywords counted apart too); the rest count the latest checks. */
export function questionKpis(rows: readonly QuestionRow[]): QuestionKpis {
  let tracked = 0
  let keywords = 0
  let overviews = 0
  let cited = 0
  let named = 0
  for (const row of rows) {
    if (row.enabled) tracked += 1
    if (row.enabled && row.promptKind === 'keyword') keywords += 1
    if (row.overview === true) overviews += 1
    if (row.cited === true) cited += 1
    if (row.named === true) named += 1
  }
  return { tracked, keywords, overviews, cited, named }
}

/** "4 of 9" with a percentage, or "None yet". */
export function shareText(count: number, of: number): string {
  if (of === 0) return 'None yet'
  return `${count.toLocaleString('en-US')} of ${of.toLocaleString('en-US')} · ${Math.round((count / of) * 100)}%`
}

export interface RecheckPlan {
  /** Enabled questions in the picked market, grouped by source for `checks:start`. */
  promptIds: string[]
  pageIds: string[]
  /** Selected questions left out: disabled, or their source is not in the market. */
  skipped: number
  min: number
  max: number
}

/** What "Re-check selected" searches: one search per sample, two when the overview loads apart. */
export function recheckPlan(
  rows: readonly QuestionRow[],
  sources: ReadonlyMap<string, QuestionSource>
): RecheckPlan {
  const promptIds: string[] = []
  const pageIds: string[] = []
  let skipped = 0
  let samples = 0
  for (const row of rows) {
    const source = sources.get(row.sourceId)
    if (!row.enabled || !row.inMarket || source === undefined) {
      skipped += 1
      continue
    }
    promptIds.push(row.promptId)
    if (!pageIds.includes(source.id)) pageIds.push(source.id)
    samples += source.samples
  }
  return {
    promptIds,
    pageIds,
    skipped,
    min: samples * SEARCHES_PER_PROMPT_MIN,
    max: samples * SEARCHES_PER_PROMPT_MAX
  }
}

function count(value: number, noun: string, plural = `${noun}s`): string {
  return `${value.toLocaleString('en-US')} ${value === 1 ? noun : plural}`
}

/** "Uses 5 searches in US · EN, up to 10 if Google loads the overview separately · 31,898 left." */
export function costLine(plan: RecheckPlan, market: string, searchesLeft: number | null): string {
  const uses = `Uses ${count(plan.min, 'search', 'searches')} in ${market}`
  const most =
    plan.max > plan.min
      ? `, up to ${plan.max.toLocaleString('en-US')} if Google loads the overview separately`
      : ''
  const left = searchesLeft === null ? '' : ` · ${searchesLeft.toLocaleString('en-US')} left`
  const skipped =
    plan.skipped === 0
      ? ''
      : ` ${count(plan.skipped, 'question')} skipped (off or not in ${market}).`
  return `${uses}${most}${left}.${skipped}`
}

/** Why the re-check cannot start, or null. The engine also stops at the project's cap. */
export function costProblem(plan: RecheckPlan, searchesLeft: number | null): string | null {
  if (plan.promptIds.length === 0) return 'None of these questions can be checked here.'
  if (searchesLeft !== null && plan.min > searchesLeft) {
    return `Not enough searches left this month: this uses ${plan.min.toLocaleString('en-US')} and ${searchesLeft.toLocaleString('en-US')} ${searchesLeft === 1 ? 'is' : 'are'} left.`
  }
  return null
}

export { count as countText }
