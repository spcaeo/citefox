import { SEARCHES_PER_PROMPT_MAX } from '@shared/domain'
import type { AllPageRow } from '@shared/ipc'
import { pluralize } from '@shared/pluralize'
import {
  SCOPE_KINDS,
  type PickerItem,
  type Scope,
  type ScopeKind,
  type ScopeOptions,
  type ScopePage,
  type ScopeSet,
  type SearchEstimate
} from './types'

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/
/** A URL holds at most this many picked ids; a bigger pick is a group. */
export const MAX_SCOPE_IDS = 500

const PICKS: readonly ScopeKind[] = ['pages', 'group', 'cluster', 'topic', 'view']

export function isScopeKind(value: string | null | undefined): value is ScopeKind {
  return typeof value === 'string' && (SCOPE_KINDS as readonly string[]).includes(value)
}

/** True when the kind needs picked ids. */
export function scopeNeedsIds(kind: ScopeKind): boolean {
  return PICKS.includes(kind)
}

/** Comma list of opaque ids, unknown shapes and repeats dropped, capped. */
export function parseIds(value: string | null | undefined): string[] {
  const out: string[] = []
  for (const part of (value ?? '').split(',')) {
    const id = part.trim()
    if (id && ID.test(id) && !out.includes(id)) out.push(id)
    if (out.length === MAX_SCOPE_IDS) break
  }
  return out
}

export function formatIds(ids: readonly string[]): string | null {
  return ids.length === 0 ? null : ids.slice(0, MAX_SCOPE_IDS).join(',')
}

/**
 * The scope in `<prefix>.scope` and `<prefix>.ids`. A missing or unknown kind
 * is `fallback`, and so is a pick kind with no ids left.
 */
export function parseScope(
  params: Readonly<Record<string, string | undefined>>,
  prefix: string,
  fallback: ScopeKind,
  allowed: readonly ScopeKind[] = SCOPE_KINDS
): Scope {
  const raw = params[`${prefix}.scope`]
  const kind = isScopeKind(raw) && allowed.includes(raw) ? raw : fallback
  if (!scopeNeedsIds(kind)) return { kind, ids: [] }
  const ids = parseIds(params[`${prefix}.ids`])
  return { kind, ids }
}

/** The URL values for `scope` (a patch: null removes a key). */
export function scopeParams(scope: Scope, prefix: string): Record<string, string | null> {
  return {
    [`${prefix}.scope`]: scope.kind,
    [`${prefix}.ids`]: scopeNeedsIds(scope.kind) ? formatIds(scope.ids) : null
  }
}

function pageLabel(row: Pick<AllPageRow, 'label' | 'title' | 'url'>): string {
  const label = row.label?.trim() || row.title?.trim()
  if (label) return label
  try {
    return new URL(row.url).pathname || row.url
  } catch {
    return row.url
  }
}

/** The path of a URL, such as `/blog/a/`. The URL itself when it does not parse. */
export function pathOf(url: string): string {
  try {
    const parsed = new URL(url)
    return `${parsed.pathname}${parsed.search}` || '/'
  } catch {
    return url
  }
}

export function isTrackedStatus(status: ScopePage['status']): boolean {
  return status === 'tracked' || status === 'setting_up' || status === 'paused'
}

/** An All pages row as a scope page. */
export function scopePageFromRow(row: AllPageRow): ScopePage {
  return {
    id: row.id,
    url: row.url,
    label: pageLabel(row),
    folder: row.folder,
    status: row.status,
    tracked: isTrackedStatus(row.status),
    groupIds: (row.groups ?? []).map((item) => item.id),
    clusterIds: (row.clusters ?? []).map((item) => item.id),
    marketIds: row.marketIds,
    promptCount: row.promptCount,
    samples: row.samples,
    nextCheckAt: row.nextCheckAt,
    score: row.score,
    pageCited: row.pageCited,
    aioPrompts: row.aioPrompts
  }
}

/** True when a tracked, not paused page's next check is at or before `now`. */
export function isDue(page: ScopePage, now: Date): boolean {
  if (page.status !== 'tracked' && page.status !== 'setting_up') return false
  if (page.nextCheckAt === null) return false
  return Date.parse(page.nextCheckAt) <= now.getTime()
}

/**
 * The page ids (and topic ids: a topic is checked as its own subject) a scope
 * covers. `project` and `tracked` cover every tracked page; `view` is resolved
 * by the caller (it needs All pages' filters) and gives nothing here.
 */
export function resolveScopeIds(scope: Scope, options: ScopeOptions, now = new Date()): string[] {
  const picked = new Set(scope.ids)
  switch (scope.kind) {
    case 'due':
      return options.pages.filter((page) => isDue(page, now)).map((page) => page.id)
    case 'tracked':
    case 'project':
      return options.pages.filter((page) => page.tracked).map((page) => page.id)
    case 'all':
      return [
        ...options.pages.filter((page) => page.tracked).map((page) => page.id),
        ...options.topics.map((topic) => topic.id)
      ]
    case 'pages':
      return options.pages.filter((page) => picked.has(page.id)).map((page) => page.id)
    case 'group':
      return options.pages
        .filter((page) => page.groupIds.some((id) => picked.has(id)))
        .map((page) => page.id)
    case 'cluster':
      return options.pages
        .filter((page) => page.clusterIds.some((id) => picked.has(id)))
        .map((page) => page.id)
    case 'topic':
      return options.topics.filter((topic) => picked.has(topic.id)).map((topic) => topic.id)
    case 'view':
      return []
  }
}

/** Questions a check of every tracked page and every topic would ask (their enabled questions). */
export function allQuestionCount(options: ScopeOptions): number {
  const pages = options.pages.reduce((sum, page) => sum + (page.tracked ? page.promptCount : 0), 0)
  return options.topics.reduce((sum, topic) => sum + (topic.questions ?? 0), pages)
}

/**
 * Searches a check of `pageIds` can use: questions × markets × samples, once
 * (no AI Overview) to twice (an overview's second call) per question. `marketIds`
 * null is each page's own markets; a list keeps only those a page has.
 * `questionLimit` caps the questions per page (only not cited, picked questions).
 */
export function estimateSearches(
  options: ScopeOptions,
  pageIds: readonly string[],
  marketIds: readonly string[] | null,
  questionLimit: ((id: string) => number | null) | null = null
): SearchEstimate {
  const pages = new Map(options.pages.map((page) => [page.id, page]))
  const topics = new Map(options.topics.map((topic) => [topic.id, topic]))
  const allMarkets = options.markets.map((market) => market.id)
  let min = 0
  let count = 0
  for (const id of pageIds) {
    const page = pages.get(id)
    const topic = topics.get(id)
    if (!page && !topic) continue
    const own = page ? page.marketIds : allMarkets
    const markets =
      marketIds === null ? own.length : own.filter((m) => marketIds.includes(m)).length
    const questions = page ? page.promptCount : (topic?.questions ?? 0)
    const limit = questionLimit?.(id)
    const asked = limit === null || limit === undefined ? questions : Math.min(questions, limit)
    const samples = page ? page.samples : 1
    if (markets === 0 || asked === 0) continue
    count += 1
    min += asked * markets * samples
  }
  return { min, max: min * SEARCHES_PER_PROMPT_MAX, pages: count }
}

/** "About 24–48 searches", "No searches". */
export function estimateText(estimate: SearchEstimate): string {
  if (estimate.max === 0) return 'No searches'
  if (estimate.min === estimate.max) return `About ${pluralize(estimate.min, 'search', 'searches')}`
  return `About ${estimate.min.toLocaleString()}–${pluralize(estimate.max, 'search', 'searches')}`
}

/** "About 24–48 searches · 3,760 left this month", with a warning when it may not fit. */
export function costLine(estimate: SearchEstimate, searchesLeft: number | null): string {
  const base = estimateText(estimate)
  if (searchesLeft === null) return base
  const left = `${searchesLeft.toLocaleString()} left this month`
  if (estimate.max > searchesLeft) return `${base} · only ${left}`
  return `${base} · ${left}`
}

/** Picker rows for pages: label, path, and why a page cannot be picked. */
export function pageItems(
  pages: readonly ScopePage[],
  disabled: ((page: ScopePage) => string | null) | null = null
): PickerItem[] {
  return pages.map((page) => {
    const reason = disabled?.(page) ?? null
    return {
      id: page.id,
      label: page.label,
      detail: pathOf(page.url),
      url: page.url,
      ...(reason ? { disabledReason: reason } : {})
    }
  })
}

/** Picker rows for groups, clusters, topics and views. */
export function setItems(sets: readonly ScopeSet[]): PickerItem[] {
  return sets.map((set) => ({
    id: set.id,
    label: set.name,
    detail:
      set.kind === 'topic'
        ? pluralize(set.questions ?? 0, 'question')
        : set.kind === 'view'
          ? 'Saved view'
          : pluralize(set.count, 'page')
  }))
}

/** "3 pages", "Money pages", "Email + 2 more clusters", "Everything due". */
export function describeScope(scope: Scope, options: ScopeOptions | null): string {
  const names = (sets: readonly ScopeSet[], noun: string, plural: string): string => {
    const picked = sets.filter((set) => scope.ids.includes(set.id))
    const first = picked[0]
    if (!first) return `No ${plural} picked`
    return picked.length === 1
      ? first.name
      : `${first.name} + ${picked.length - 1} more ${picked.length - 1 === 1 ? noun : plural}`
  }
  switch (scope.kind) {
    case 'due':
      return 'Everything due'
    case 'tracked':
      return 'Every tracked page'
    case 'all':
      return 'Everything again'
    case 'project':
      return 'Whole project'
    case 'pages':
      return scope.ids.length === 0 ? 'No pages picked' : pluralize(scope.ids.length, 'page')
    case 'group':
      return options ? names(options.groups, 'group', 'groups') : 'Groups'
    case 'cluster':
      return options ? names(options.clusters, 'cluster', 'clusters') : 'Clusters'
    case 'topic':
      return options ? names(options.topics, 'topic', 'topics') : 'Topics'
    case 'view':
      return options ? names(options.views, 'view', 'views') : 'Saved view'
  }
}

/** Plain-words label of each kind, for the scope radio list. */
export const SCOPE_LABELS: Readonly<Record<ScopeKind, string>> = {
  due: 'Everything due',
  tracked: 'Every tracked page',
  all: 'Everything again',
  project: 'Whole project',
  pages: 'Pages I pick',
  group: 'A group',
  cluster: 'A cluster',
  topic: 'A topic',
  view: 'A saved view'
}

/** Case-insensitive match on every word of `query` against the label and detail. */
export function matchesQuery(item: PickerItem, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return true
  const hay = `${item.label} ${item.detail ?? ''} ${item.url ?? ''}`.toLowerCase()
  return words.every((word) => hay.includes(word))
}
