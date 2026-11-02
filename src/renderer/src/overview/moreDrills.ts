import type {
  OverviewQuestion,
  OverviewWeek,
  OverviewWeekSearch,
  VisibilityOverview
} from '@shared/ipc'
import {
  PAGE_FIX_KIND_COPY,
  PAGE_FIX_KINDS,
  type FixSearch,
  type PageFix
} from '@shared/page-fixes'
import type { DrillItem, DrillScope, ItemDrill } from '../drill'
import { formatDay } from '../utils/dates'
import { compareLabel, questionKeysDrill } from './compare'
import { insteadLine, movedLine } from './insights'
import { countNoun, nounCount, sourceText, youLabel, type CountNoun } from './model'

/**
 * Summary's drills beyond the headline sets: what moved behind a tile's change,
 * each week of the chart, the change since the first check, every page fix and a
 * fix's searches. Each drawer lists exactly the rows its number counts. Pure.
 */

function scopeOf(data: Pick<VisibilityOverview, 'marketId' | 'brand' | 'domain'>): DrillScope {
  return {
    pageId: null,
    marketId: data.marketId,
    runId: null,
    marketLabel: '',
    checkDateLabel: '',
    brand: data.brand,
    domain: data.domain
  }
}

const MOVED_SUMMARY = [
  { label: 'Gained', group: 'gained' },
  { label: 'Lost', group: 'lost' }
] as const

/** The headline tiles whose change chip opens what moved. */
export type TrendSet = 'aio' | 'cited' | 'named'

const TREND_TITLE: Readonly<Record<TrendSet, string>> = {
  aio: 'AI Overview shows',
  cited: 'You’re cited',
  named: 'You’re named'
}

const TREND_WHAT: Readonly<Record<TrendSet, string>> = {
  aio: 'an AI Overview shows',
  cited: 'an AI Overview cites your site',
  named: 'the AI Overview names you'
}

function hasAio(you: OverviewQuestion['you']): boolean | null {
  if (you === 'error') return null
  return you !== 'no_aio'
}

/**
 * Which way one question moved for a tile since the compared check: `gained`,
 * `lost`, or null (no earlier result, a failed check, or no move).
 */
function trendMove(
  question: OverviewQuestion,
  set: TrendSet,
  named: { before: ReadonlySet<string>; after: ReadonlySet<string> }
): 'gained' | 'lost' | null {
  const before = question.before
  if (before === null) return null
  let then: boolean | null
  let now: boolean | null
  if (set === 'aio') {
    then = hasAio(before.you)
    now = hasAio(question.you)
  } else if (set === 'cited') {
    then = before.you === 'error' ? null : before.you === 'cited'
    now = question.you === 'error' ? null : question.you === 'cited'
  } else {
    then = named.before.has(question.key)
    now = named.after.has(question.key)
  }
  if (then === null || now === null || then === now) return null
  return now ? 'gained' : 'lost'
}

/** The drill id of a tile's change chip. */
export function trendDrillId(set: TrendSet): string {
  return `kpi:${set}:moved`
}

/**
 * The searches behind a tile's change chip: each one that moved since the compared
 * check, with Gained and Lost tiles. The chip is the net change; the insight says
 * when searches added or removed since make it differ from gained minus lost.
 */
export function trendDrill(data: VisibilityOverview, set: TrendSet): ItemDrill {
  const named = {
    before: new Set(data.verdictSets.named_before),
    after: new Set(data.verdictSets.named_after)
  }
  const moves = new Map<string, 'gained' | 'lost'>()
  for (const question of data.questions) {
    const move = trendMove(question, set, named)
    if (move !== null) moves.set(question.key, move)
  }
  const keys = [...moves.keys()].sort(
    (left, right) =>
      (moves.get(left) === 'gained' ? 0 : 1) - (moves.get(right) === 'gained' ? 0 : 1)
  )
  const gained = [...moves.values()].filter((move) => move === 'gained').length
  const delta = data.kpis[set === 'aio' ? 'withAio' : set].delta
  const since = compareLabel(data) ?? 'the check before'
  const drill = questionKeysDrill(data, {
    id: trendDrillId(set),
    title: `${TREND_TITLE[set]}: what changed`,
    description: `${countNoun(data).Many} that moved since ${since}. Gained: ${TREND_WHAT[set]} now, not then. Lost: the other way round.`,
    keys,
    insight: movedLine(gained, keys.length - gained, delta)
  })
  return {
    ...drill,
    items: drill.items.map((item) => ({ ...item, group: moves.get(item.id) ?? 'gained' })),
    summary: MOVED_SUMMARY
  }
}

/** A week's id by its place from the end: `week:0` is this week, so a link keeps its week. */
export function weekDrillId(weeks: readonly OverviewWeek[], index: number): string {
  return `week:${weeks.length - 1 - index}`
}

function weekItem(
  search: OverviewWeekSearch,
  latest: ReadonlyMap<string, OverviewQuestion>,
  group?: string
): DrillItem {
  const now = latest.get(search.key)
  return {
    id: search.key,
    primary: search.text,
    secondary: now ? sourceText(now.source) : null,
    // That week's answer: the check the chart counted.
    target: {
      kind: 'prompt',
      pageId: search.pageId,
      promptId: search.promptId,
      marketId: search.marketId,
      runId: search.runId
    },
    cells: { you: now ? youLabel(now) : 'Not tracked now' },
    ...(group ? { group } : {})
  }
}

function citedKeys(week: OverviewWeek | undefined): Set<string> {
  return new Set((week?.searches ?? []).filter((item) => item.cited).map((item) => item.key))
}

function weekCompare(
  cited: ReadonlySet<string>,
  earlier: ReadonlySet<string>
): { gained: number; lost: number } {
  let gained = 0
  let lost = 0
  for (const key of cited) if (!earlier.has(key)) gained += 1
  for (const key of earlier) if (!cited.has(key)) lost += 1
  return { gained, lost }
}

/**
 * The searches cited at the end of one week (the point's value), each opening the
 * answer of the check that counted. The insight sets it against that week's AI
 * Overviews and the week before.
 */
export function weekDrill(
  data: VisibilityOverview,
  weeks: readonly OverviewWeek[],
  index: number
): ItemDrill {
  const week = weeks[index]
  const noun = countNoun(data)
  const latest = new Map(data.questions.map((item) => [item.key, item]))
  const searches = week?.searches ?? []
  const cited = searches.filter((item) => item.cited)
  const back = weeks.length - 1 - index
  const day = week ? formatDay(week.endsAt, { year: false }) : ''
  const previous = weeks[index - 1]
  const parts = [
    searches.length === 0
      ? null
      : `${nounCount(searches.length, noun)} showed an AI Overview; you were cited in ${cited.length.toLocaleString('en-US')} (${Math.round((cited.length / searches.length) * 100)}%).`
  ]
  if (previous?.searches !== undefined) {
    const move = weekCompare(citedKeys(week), citedKeys(previous))
    parts.push(`Against the week before: ${move.gained} gained, ${move.lost} lost.`)
  }
  return {
    kind: 'items',
    id: weekDrillId(weeks, index),
    title: back === 0 ? 'Cited this week' : `Cited in the week to ${day}`,
    description: `${noun.Many} whose AI Overview cited your site at the end of ${
      back === 0 ? 'this week' : `the week to ${day}`
    }, each from the check the chart counted. Select one to open that answer.`,
    insight: parts.filter((part): part is string => part !== null).join(' ') || null,
    noun: [noun.one, noun.many],
    primaryLabel: noun.one === 'search' ? 'Search' : 'Question',
    columns: [{ id: 'you', label: 'Now', width: 'minmax(96px, 0.5fr)' }],
    items: cited.map((item) => weekItem(item, latest)),
    scope: scopeOf(data)
  }
}

export const WEEK_CHANGE_ID = 'week:change'

/**
 * The searches behind "N since the first check": cited now and not at the first
 * checked week (gained), or the other way round (lost).
 */
export function weekChangeDrill(
  data: VisibilityOverview,
  weeks: readonly OverviewWeek[]
): ItemDrill {
  const noun = countNoun(data)
  const latest = new Map(data.questions.map((item) => [item.key, item]))
  const first = weeks.find((week) => week.cited !== null)
  const last = weeks[weeks.length - 1]
  const now = citedKeys(last)
  const then = citedKeys(first)
  const items: DrillItem[] = []
  for (const search of last?.searches ?? []) {
    if (search.cited && !then.has(search.key)) items.push(weekItem(search, latest, 'gained'))
  }
  for (const search of first?.searches ?? []) {
    if (search.cited && !now.has(search.key)) items.push(weekItem(search, latest, 'lost'))
  }
  const gained = items.filter((item) => item.group === 'gained').length
  const delta =
    first && last && first.cited !== null && last.cited !== null ? last.cited - first.cited : null
  const day = first ? formatDay(first.endsAt, { year: false }) : ''
  return {
    kind: 'items',
    id: WEEK_CHANGE_ID,
    title: 'Change since the first check',
    description: `${noun.Many} cited this week and not in the week to ${day} (gained), or the other way round (lost).`,
    insight: movedLine(gained, items.length - gained, delta).replace(
      'The tile’s change',
      'The chart’s change'
    ),
    noun: [noun.one, noun.many],
    primaryLabel: noun.one === 'search' ? 'Search' : 'Question',
    columns: [{ id: 'you', label: 'Now', width: 'minmax(96px, 0.5fr)' }],
    items,
    summary: MOVED_SUMMARY,
    scope: scopeOf(data)
  }
}

export const PAGE_FIXES_ID = 'fixes:all'

function pathOf(url: string): string {
  try {
    const parsed = new URL(url)
    return `${parsed.pathname}${parsed.search}` || '/'
  } catch {
    return url
  }
}

/** Where a page fix lands: its page's path, the page to write, or none yet. */
export function fixPlace(fix: PageFix): string {
  if (fix.page) return pathOf(fix.page.url)
  return fix.proposed ?? 'No target page yet'
}

/**
 * Every page fix to do (the Fixes count), in What to fix's order, with a tile per
 * kind. Each opens the page fix drawer over this one, with its searches and brief.
 */
export function pageFixesDrill(
  fixes: readonly PageFix[],
  data: Pick<VisibilityOverview, 'marketId' | 'brand' | 'domain'>
): ItemDrill {
  const searches = fixes.reduce((sum, fix) => sum + fix.searches.length, 0)
  const top = fixes.slice(0, 3).reduce((sum, fix) => sum + fix.searches.length, 0)
  return {
    kind: 'items',
    id: PAGE_FIXES_ID,
    title: 'Page fixes to do',
    description:
      'Searches that need work, rolled up into one fix per page: improve a page, pick which page owns a search, or write a new page.',
    insight:
      fixes.length <= 3 || searches === 0
        ? null
        : `The top 3 fixes cover ${top.toLocaleString('en-US')} of the ${searches.toLocaleString('en-US')} searches that need work.`,
    noun: ['page fix', 'page fixes'],
    primaryLabel: 'Fix',
    columns: [
      { id: 'page', label: 'Page', width: 'minmax(200px, 1.2fr)' },
      { id: 'searches', label: 'Searches', align: 'end', width: '88px' }
    ],
    items: fixes.map((fix) => ({
      id: fix.id,
      primary: PAGE_FIX_KIND_COPY[fix.kind].title,
      secondary: fix.sources.map((source) => source.name).join(', ') || null,
      target: { kind: 'drawer', id: 'page-fix', values: { 'pfx.id': fix.id } },
      cells: { page: fixPlace(fix), searches: fix.searches.length },
      group: fix.kind
    })),
    summary: PAGE_FIX_KINDS.map((kind) => ({ label: PAGE_FIX_KIND_COPY[kind].title, group: kind })),
    note: 'Select a fix to open it over this list, with its searches and brief.',
    scope: scopeOf(data)
  }
}

/** The drill id of one fix's searches. */
export function fixSearchesId(fix: Pick<PageFix, 'id'>): string {
  return `fix:${fix.id}`
}

function stateLabel(search: FixSearch): string {
  switch (search.state) {
    case 'other_page':
      return 'Your other page'
    case 'right_page':
      return 'Right page'
    case 'no_aio':
      return 'No AI Overview'
    case 'failed':
      return 'Check failed'
    case 'not_checked':
      return 'Not checked yet'
    default:
      return 'Not cited'
  }
}

/** The searches one page fix rolls up, each opening its answer. */
export function fixSearchesDrill(
  fix: PageFix,
  data: Pick<VisibilityOverview, 'marketId' | 'brand' | 'domain'>,
  noun: CountNoun
): ItemDrill {
  const title = PAGE_FIX_KIND_COPY[fix.kind].title
  return {
    kind: 'items',
    id: fixSearchesId(fix),
    title: `${title}: ${fixPlace(fix)}`,
    description: `The searches this fix covers. What to do: ${PAGE_FIX_KIND_COPY[fix.kind].todo}`,
    insight: insteadLine(
      fix.searches.map((search) => ({
        you: search.state === 'right_page' ? ('cited' as const) : ('not_cited' as const),
        citedInstead: search.citedInstead
      }))
    ),
    noun: [noun.one, noun.many],
    primaryLabel: noun.one === 'search' ? 'Search' : 'Question',
    columns: [
      { id: 'you', label: 'Now', width: 'minmax(96px, 0.5fr)' },
      { id: 'instead', label: 'Cited instead', width: 'minmax(120px, 0.7fr)' }
    ],
    items: fix.searches.map((search) => ({
      id: search.id,
      primary: search.text,
      secondary: search.sourceName,
      target: {
        kind: 'prompt',
        pageId: search.sourceId,
        promptId: search.promptId,
        marketId: search.marketId,
        runId: search.runId
      },
      cells: {
        you: stateLabel(search),
        instead: search.citedInstead.slice(0, 2).join(', ') || '—'
      }
    })),
    scope: scopeOf(data)
  }
}
