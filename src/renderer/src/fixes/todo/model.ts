import type { TopicRowState } from '@shared/domain'
import {
  PAGE_FIX_KIND_COPY,
  PAGE_FIX_KINDS,
  bySearches,
  fixForSource,
  isPageFixKind,
  type FixSearch,
  type PageFix,
  type PageFixKind,
  type PageFixRollup,
  type ProjectSearches
} from '@shared/page-fixes'
import { pluralize } from '@shared/pluralize'
import type { DrillItem, ItemDrill } from '../../drill'
import { pathOf } from '../model'

/** What to fix: view helpers over the page-fix rollup. Pure. */

/** The ways to group What to fix (`?by=`): by kind of fix (default), by page, by topic. */
export const TODO_VIEWS = ['kind', 'page', 'topic'] as const
export type TodoView = (typeof TODO_VIEWS)[number]

export const TODO_VIEW_LABEL: Readonly<Record<TodoView, string>> = {
  kind: 'By kind',
  page: 'By page',
  topic: 'By topic'
}

/** Fixes a group shows before "Show N more". */
export const GROUP_SHOWN = 3

/** One result's words (one result language, owner 2026-10-29). */
export const RESULT_LABEL: Readonly<Record<TopicRowState, string>> = {
  not_cited: 'Not cited',
  no_page: 'Not cited',
  other_page: 'Your other page',
  right_page: 'Right page',
  no_aio: 'No AI Overview',
  failed: 'Check failed',
  not_checked: 'Not checked yet'
}

/** The kind filter from the URL, or null for every kind. */
export function kindFilter(value: string | null): PageFixKind | null {
  return isPageFixKind(value) ? value : null
}

/** The `more` key: the groups whose "Show N more" is open. */
export function openGroups(value: string | null): Set<string> {
  return new Set((value ?? '').split(',').filter((part) => part.length > 0))
}

export function toggleGroup(value: string | null, group: string): string | null {
  const open = openGroups(value)
  if (open.has(group)) open.delete(group)
  else open.add(group)
  return open.size === 0 ? null : [...open].sort().join(',')
}

/** "/integration/nagios" for a page, "New page: School texts" for a page to write. */
export function fixTitle(fix: PageFix): string {
  if (fix.kind === 'new') return `New page: ${fix.proposed ?? 'untitled'}`
  if (fix.kind === 'owner' && fix.citedUrl) return pathOf(fix.citedUrl)
  return fix.page ? pathOf(fix.page.url) : 'No target page yet'
}

/** "Nagios alerts", or "Nagios alerts +1" when the fix serves more topics. */
export function sourcesLabel(fix: PageFix): string {
  const [first, ...rest] = fix.sources
  if (!first) return '—'
  return rest.length === 0 ? first.name : `${first.name} +${rest.length}`
}

/** One group of fix rows (a kind, a topic, or the single By page list). */
export interface TodoGroup {
  key: string
  label: string
  /** "What to do: …" under the group's name. Null for topic groups. */
  todo: string | null
  fixes: readonly PageFix[]
  searches: number
}

/** The groups a view shows, in order. Every group's searches add up to the shown total. */
export function todoGroups(
  rollup: PageFixRollup,
  view: TodoView,
  sources: ProjectSearches['sources'],
  kind: PageFixKind | null
): TodoGroup[] {
  const fixes = rollup.fixes.filter((fix) => kind === null || fix.kind === kind)
  const total = (list: readonly PageFix[]): number =>
    list.reduce((sum, fix) => sum + fix.searches.length, 0)
  if (view === 'page') {
    const sorted = [...fixes].sort(bySearches)
    return [{ key: 'all', label: 'Pages', todo: null, fixes: sorted, searches: total(sorted) }]
  }
  if (view === 'topic') {
    const out: TodoGroup[] = []
    for (const source of sources) {
      const mine = fixes
        .filter((fix) => fix.sources.some((item) => item.id === source.id))
        .map((fix) => fixForSource(fix, source.id))
        .sort(bySearches)
      if (mine.length === 0) continue
      out.push({
        key: source.id,
        label: source.name,
        todo: null,
        fixes: mine,
        searches: total(mine)
      })
    }
    return out
  }
  return PAGE_FIX_KINDS.filter((item) => kind === null || item === kind)
    .map((item) => {
      const mine = fixes.filter((fix) => fix.kind === item)
      return {
        key: item,
        label: PAGE_FIX_KIND_COPY[item].title,
        todo: PAGE_FIX_KIND_COPY[item].line,
        fixes: mine,
        searches: total(mine)
      }
    })
    .filter((group) => group.fixes.length > 0)
}

/** "1,310 searches need work. We grouped them by page, so you fix 64 pages, not 1,310 searches." */
export function leadLine(rollup: PageFixRollup): string {
  if (rollup.total === 0) return 'No searches checked yet. Check a topic or a page first.'
  if (rollup.fixes.length === 0)
    return 'Nothing needs work right now. Every search is cited or has no AI Overview.'
  const searches = pluralize(rollup.needWork, 'search', 'searches')
  const verb = rollup.needWork === 1 ? 'needs' : 'need'
  const pages = pluralize(rollup.fixes.length, 'page')
  return `${searches} ${verb} work. We grouped them by page, so you fix ${pages}, not ${searches}.`
}

/** The search's own row in a drill: its words, its source, its result and odds. */
export function searchItem(search: FixSearch, projectId: string | null): DrillItem {
  return {
    id: search.id,
    primary: search.text,
    secondary: `${search.label} · ${search.sourceName}`,
    target: {
      kind: 'prompt',
      pageId: search.sourceId,
      promptId: search.promptId,
      marketId: search.marketId,
      runId: search.runId,
      projectId
    },
    cells: {
      result: RESULT_LABEL[search.state],
      instead: search.citedInstead.slice(0, 2).join(', ') || '—',
      odds: search.winOdds?.score ?? null
    }
  }
}

/** A list of searches as a drill (the count it opens equals the list). */
export function searchesDrill(input: {
  id: string
  title: string
  description: string
  searches: readonly FixSearch[]
  projectId: string | null
  domain: string
}): ItemDrill {
  return {
    kind: 'items',
    id: input.id,
    title: input.title,
    description: input.description,
    noun: ['search', 'searches'],
    primaryLabel: 'Search',
    columns: [
      { id: 'result', label: 'Result', width: 'minmax(96px, 0.5fr)' },
      { id: 'instead', label: 'Cited instead', width: 'minmax(96px, 0.6fr)' },
      { id: 'odds', label: 'Win odds', align: 'end', width: '72px' }
    ],
    items: input.searches.map((search) => searchItem(search, input.projectId)),
    scope: {
      pageId: null,
      marketId: null,
      runId: null,
      marketLabel: '',
      checkDateLabel: '',
      brand: '',
      domain: input.domain
    }
  }
}

/** The drill behind a fix's searches count. */
export function fixDrill(fix: PageFix, projectId: string | null, domain: string): ItemDrill {
  return searchesDrill({
    id: `fix:${fix.id}`,
    title: `${PAGE_FIX_KIND_COPY[fix.kind].title}: ${fixTitle(fix)}`,
    description: `Searches this fix can win, highest win odds first.`,
    searches: fix.searches,
    projectId,
    domain
  })
}
