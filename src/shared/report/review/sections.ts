import { VERDICT_WAIT_DAYS } from '../../fix-verdict'
import { domainMovers } from '../../metrics/breakdowns'
import { isMeasured, isCitedRow } from '../../metrics/counts'
import type { DomainRow, MetricCount, MetricsResult } from '../../metrics/types'
import { MOVEMENT_LABELS, PAGE_STATUS_LABELS, pathOf, plural, type DrillBook } from './items'
import { lostQuestionsNum } from './verdict'
import type {
  BarItem,
  ChangedView,
  Chip,
  CompetitorsView,
  MethodView,
  MoverItem,
  NotIndexedView,
  Num,
  PageItem,
  PagesView,
  PublishedView,
  QuestionItem,
  ReportContext,
  ReviewLens,
  SegmentItem,
  SiteItem,
  StandingView,
  Tile,
  TopicsView
} from './types'
import { REVIEW_LENSES } from './types'

/** The other sections of a ready report. Each number registers its drill in `book`. */

export interface SectionInput {
  metrics: MetricsResult
  book: DrillBook
  toIds: (ids: readonly string[]) => string[]
  ctx: ReportContext
  questions: readonly QuestionItem[]
  pages: readonly PageItem[]
  fromLabel: string | null
  toLabel: string
}

function questionsNum(
  input: SectionInput,
  id: string,
  title: string,
  count: MetricCount,
  sub?: string
): Num {
  return input.book.add(id, {
    title,
    kind: 'questions',
    ids: input.toIds(count.ids),
    ...(sub ? { sub } : {})
  })
}

function pagesNum(input: SectionInput, id: string, title: string, rows: readonly PageItem[]): Num {
  return input.book.add(id, { title, kind: 'pages', ids: rows.map((row) => row.url) })
}

function tile(label: string, num: Num, extra: Partial<Tile> = {}): Tile {
  return { label, value: num.n.toLocaleString('en-US'), drill: num.drill, ...extra }
}

export function standingView(input: SectionInput): StandingView {
  const now = input.metrics.now
  const n = (id: string, title: string, count: MetricCount): Num =>
    questionsNum(input, id, title, count)
  const tracked = n('now:checked', 'Every question checked', now.checked)
  const answered = n('now:answered', 'An AI answer showed', now.answered)
  const cited = n('now:cited', 'Questions citing your pages', now.cited)
  const named = n('now:named', `${input.ctx.brand} named in the answer`, now.named)
  const first = n('now:first', `${input.ctx.brand} is the number-one source`, now.first)
  const notVisible = n('now:invisible', 'An answer showed without you', now.notVisible)
  const namedIds = new Set(now.named.ids)
  const citedNamed = n('now:cited-named', `Cites your pages and names ${input.ctx.brand}`, {
    n: 0,
    ids: now.cited.ids.filter((id) => namedIds.has(id))
  })
  const k = (label: string, num: Num): StandingView['kpis'][number] => ({
    label,
    now: num.n.toLocaleString('en-US'),
    before: null,
    trend: null,
    drill: num.drill
  })
  const positions: number[] = []
  const byBucket = new Map<string, string[]>()
  for (const id of now.cited.ids) {
    const position = input.metrics.rows[id]?.position
    if (typeof position !== 'number') continue
    positions.push(position)
    const bucket = position <= 3 ? String(position) : position <= 5 ? '4-5' : '6+'
    byBucket.set(bucket, [...(byBucket.get(bucket) ?? []), id])
  }
  for (const bucket of ['1', '2', '3', '4-5', '6+']) {
    const label = bucket === '6+' ? '#6 or lower' : `#${bucket.replace('-', '–')}`
    input.book.add(`pos:${bucket}`, {
      title: `${input.ctx.brand} is source ${label}`,
      kind: 'questions',
      ids: byBucket.get(bucket) ?? []
    })
  }
  input.book.add('pos:none', {
    title: 'An AI answer that does not cite you',
    kind: 'questions',
    ids: now.notCited.ids
  })
  return {
    kpis: [
      k('Questions tracked', tracked),
      k('Show an AI answer', answered),
      k('Cite your pages', cited),
      k('Name your brand', named),
      k('Number-one source', first),
      k('Answer without you', notVisible)
    ],
    funnel: [
      { label: 'Questions tracked', value: tracked.n, drill: tracked.drill },
      { label: 'AI answer shown', value: answered.n, drill: answered.drill },
      { label: 'Your pages cited', value: cited.n, drill: cited.drill },
      // Cited and named, so the funnel only narrows (the Full report's last step).
      { label: 'Cited and named', value: citedNamed.n, drill: citedNamed.drill }
    ],
    positions,
    notCited: now.notCited.n
  }
}

export const PAGE_CHIPS = ['all', 'cited', 'notyet', 'toonew', 'lost'] as const

export function publishedView(input: SectionInput): PublishedView {
  const rows = input.pages.filter((page) => page.published)
  const by = (status: PageItem['status']): PageItem[] => rows.filter((row) => row.status === status)
  const tiles: Tile[] = [
    tile('Pages published', pagesNum(input, 'pages:all', 'Pages published', rows), { chip: 'all' }),
    tile(
      'New pages',
      pagesNum(
        input,
        'pages:new',
        'New pages',
        rows.filter((row) => row.kind === 'new')
      )
    ),
    tile(
      'Rewrites',
      pagesNum(
        input,
        'pages:rewrite',
        'Rewrites',
        rows.filter((row) => row.kind === 'rewrite')
      )
    ),
    tile('Cited now', pagesNum(input, 'pages:cited', 'Pages cited now', by('cited')), {
      chip: 'cited',
      tone: 'ok'
    }),
    tile(
      `Live ${VERDICT_WAIT_DAYS}+ days, not cited`,
      pagesNum(input, 'pages:notyet', `Live ${VERDICT_WAIT_DAYS}+ days, not cited`, by('notyet')),
      { chip: 'notyet', tone: by('notyet').length > 0 ? 'warn' : 'neutral' }
    ),
    tile(
      'Too new to judge',
      pagesNum(
        input,
        'pages:toonew',
        `Too new to judge (under ${VERDICT_WAIT_DAYS} days)`,
        by('toonew')
      ),
      { chip: 'toonew' }
    )
  ]
  const chips: Chip[] = PAGE_CHIPS.map((id) => ({
    id,
    label: id === 'all' ? 'All' : PAGE_STATUS_LABELS[id],
    count: id === 'all' ? rows.length : by(id).length
  }))
  return { tiles, chips, rows }
}

export const QUESTION_CHIPS = ['all', 'gained', 'kept', 'lost', 'notcited', 'noanswer'] as const

/** The chip of questions not measured at both ends (new, or a search failed). */
export const NOT_COMPARED_CHIP = 'notcompared'

export function questionsView(input: SectionInput): { chips: Chip[]; rows: QuestionItem[] } {
  const rows = input.questions.filter((item) => item.now !== null)
  const chips: Chip[] = QUESTION_CHIPS.map((id) => ({
    id,
    label: id === 'all' ? 'All' : MOVEMENT_LABELS[id],
    count: id === 'all' ? rows.length : rows.filter((row) => row.change === id).length
  }))
  if (input.metrics.comparison === null) return { chips: chips.slice(0, 1), rows }
  const notCompared = rows.filter((row) => row.change === null).length
  if (notCompared > 0)
    chips.push({ id: NOT_COMPARED_CHIP, label: 'Not compared', count: notCompared })
  return { chips, rows }
}

function cellState(result: string, named = false): MoverItem['cells'][number]['state'] {
  if (result === 'target') return 'target'
  if (result === 'other') return 'other'
  if (result === 'not_cited') return named ? 'named' : 'not-cited'
  if (result === 'no_answer') return 'none'
  return 'missing'
}

export function changedView(input: SectionInput): ChangedView {
  const comparison = input.metrics.comparison
  const empty = { n: 0, ids: [] }
  const m = comparison?.movement
  const gained = questionsNum(input, 'gained', 'Started citing you', m?.gained ?? empty)
  const lost = questionsNum(input, 'lost', 'Stopped citing you', m?.lost ?? empty)
  const kept = questionsNum(input, 'kept', 'Kept citing you', m?.kept ?? empty)
  const fresh = questionsNum(
    input,
    'ans:new',
    'Questions that got an AI answer for the first time',
    m?.newAnswers ?? empty,
    'This is the market part of the change.'
  )
  const compared = questionsNum(
    input,
    'compared',
    'Questions checked at both ends',
    comparison?.compared ?? empty
  )
  const ex = comparison?.excluded
  const excludedIds = [
    ...(ex?.noBefore.ids ?? []),
    ...(ex?.noAfter.ids ?? []),
    ...(ex?.failed.ids ?? [])
  ]
  const excluded = questionsNum(
    input,
    'excluded',
    'Questions not compared',
    { n: excludedIds.length, ids: excludedIds },
    'New questions, questions no longer checked, and searches that failed at either end.'
  )
  const byId = new Map(input.questions.map((item) => [item.id, item]))
  const dates = input.metrics.checks.map((check) => input.ctx.day(check.at))
  const movers: MoverItem[] = []
  for (const history of input.metrics.history) {
    const last = history.points.at(-1)
    const question = last === undefined ? undefined : byId.get(last.rowId)
    if (question === undefined) continue
    if (question.change !== 'gained' && question.change !== 'lost') continue
    movers.push({
      question,
      cells: history.points.map((point) => ({
        date: input.ctx.day(point.checkedAt),
        state: cellState(point.result, point.named === true),
        position: point.position
      }))
    })
  }
  return {
    tiles: [
      tile('Started citing you', gained, { tone: 'ok', value: `+${gained.n}` }),
      tile('Stopped citing you', lost, { tone: 'warn', value: lost.n > 0 ? `−${lost.n}` : '0' }),
      tile('Kept citing you', kept),
      tile('Got an AI answer for the first time', fresh)
    ],
    net: gained.n - lost.n,
    moved: gained.n + lost.n,
    compared,
    excluded,
    movers,
    dates
  }
}

function siteItem(input: SectionInput, row: DomainRow): SiteItem {
  const name = row.own ? `${row.domain} (you)` : row.domain
  const now = input.book.add(`dom:${row.domain}:a`, {
    title: `Questions citing ${name}, ${input.toLabel}`,
    kind: 'questions',
    ids: row.cited.after?.ids ?? row.cited.now.ids,
    ...(row.own ? {} : { sub: `${row.withYou.n} of them cite your pages in the same answer.` })
  })
  const before =
    row.cited.before === null
      ? null
      : input.book.add(`dom:${row.domain}:b`, {
          title: `Questions citing ${name}, ${input.fromLabel ?? ''}`,
          kind: 'questions',
          ids: input.toIds(row.cited.before.ids)
        })
  return {
    domain: row.domain,
    own: row.own,
    before: before?.n ?? null,
    now: now.n,
    beforeDrill: before?.drill ?? null,
    nowDrill: now.drill,
    withYou: row.withYou.n
  }
}

/** Sites in the ranking: the most cited now, you always among them. */
const RANKED = 12

export function competitorsView(input: SectionInput): CompetitorsView {
  const rows = input.metrics.domains
  const movers = domainMovers(rows)
  const ranked = [...rows]
    .sort(
      (a, b) =>
        (b.cited.after ?? b.cited.now).n - (a.cited.after ?? a.cited.now).n ||
        Number(b.own) - Number(a.own) ||
        a.domain.localeCompare(b.domain)
    )
    .filter((row, index) => index < RANKED || row.own)
  return {
    gained: movers.gained.slice(0, 8).map((row) => siteItem(input, row)),
    lost: movers.lost.slice(0, 8).map((row) => siteItem(input, row)),
    ranked: ranked.map((row) => siteItem(input, row)),
    all: rows.map((row) => siteItem(input, row))
  }
}

export function pagesView(input: SectionInput): PagesView {
  const { metrics, book } = input
  const bars: BarItem[] = metrics.pages.rows
    .filter((row) => row.cited.now.n > 0 || (row.cited.before?.n ?? 0) > 0)
    .sort(
      (a, b) =>
        b.cited.now.n - (b.cited.before?.n ?? 0) - (a.cited.now.n - (a.cited.before?.n ?? 0)) ||
        b.cited.now.n - a.cited.now.n
    )
    .slice(0, 16)
    .map((row) => {
      const path = pathOf(row.url)
      const now = book.add(`page:${row.url}:a`, {
        title: `${path}, ${input.toLabel}`,
        kind: 'questions',
        ids: row.cited.after?.ids ?? row.cited.now.ids,
        sub: pageSub(row.kind, row.daysLive, row.indexed)
      })
      const before =
        row.cited.before === null
          ? null
          : book.add(`page:${row.url}:b`, {
              title: `${path}, ${input.fromLabel ?? ''}`,
              kind: 'questions',
              ids: input.toIds(row.cited.before.ids)
            })
      return {
        label: path,
        ...(row.kind ? { sub: row.kind === 'new' ? 'New' : 'Rewrite' } : {}),
        before: before?.n ?? 0,
        now: now.n,
        beforeDrill: before?.drill ?? null,
        nowDrill: now.drill,
        tone: now.n < (before?.n ?? 0) ? ('not-cited' as const) : ('target' as const)
      }
    })
  const byId = new Map(input.questions.map((item) => [item.id, item]))
  const lost = input.pages
    .filter((page) => page.status === 'lost')
    .map((page) => {
      const num = lostQuestionsNum(metrics, book, input.toIds, page)
      const ids = book.drills[num.drill]?.ids ?? []
      return {
        page,
        questions: ids.flatMap((id) => {
          const item = byId.get(id)
          return item === undefined ? [] : [item]
        })
      }
    })
  return { bars, lost }
}

function pageSub(kind: PageItem['kind'], days: number | null, indexed: boolean | null): string {
  const parts = [
    kind === 'new' ? 'New page' : kind === 'rewrite' ? 'Rewrite' : 'Page of yours',
    days === null ? null : `${days} ${plural(days, 'day')} live`,
    indexed === null ? null : indexed ? 'indexed' : 'not indexed'
  ]
  return parts.filter(Boolean).join(' · ')
}

export const LENS_LABELS: Readonly<Record<ReviewLens, string>> = {
  topic: 'Topic group',
  funnel: 'Funnel stage',
  intent: 'Intent',
  pageType: 'Page type'
}

export function topicsView(input: SectionInput): TopicsView {
  const lenses = {} as Record<ReviewLens, SegmentItem[]>
  for (const lens of REVIEW_LENSES) {
    lenses[lens] = input.metrics.segments[lens].map((row) => {
      const key = `seg:${lens}:${row.value}`
      const now = questionsNum(
        input,
        `${key}:a`,
        `${row.value}: citing you`,
        row.cited.after ?? row.cited.now
      )
      const before =
        row.cited.before === null
          ? null
          : questionsNum(
              input,
              `${key}:b`,
              `${row.value}: citing you, ${input.fromLabel ?? ''}`,
              row.cited.before
            )
      const open = questionsNum(
        input,
        `${key}:open`,
        `${row.value}: answer shown, not citing you`,
        row.open
      )
      return {
        value: row.value,
        questions: questionsNum(input, `${key}:all`, `${row.value}: every question`, row.questions),
        before,
        now,
        shareBefore: row.rateBefore,
        shareNow: row.rateAfter ?? row.rateNow,
        open,
        change: before === null ? null : now.n - before.n
      }
    })
  }
  return { lenses }
}

export function notIndexedView(input: SectionInput): NotIndexedView {
  const rows = input.pages.filter((page) => page.published && page.indexed === false)
  const num = pagesNum(input, 'pages:notindexed', 'Not indexed yet', rows)
  const longest = rows.reduce((max, row) => Math.max(max, row.daysLive ?? 0), 0)
  return {
    tiles: [
      tile("Pages Google hasn't indexed", num, { tone: rows.length > 0 ? 'warn' : 'neutral' }),
      { label: 'Longest wait, in days', value: String(longest), drill: null }
    ],
    rows
  }
}

export function methodView(input: SectionInput): MethodView {
  const { metrics, ctx } = input
  const comparison = metrics.comparison
  const compared =
    comparison === null
      ? questionsNum(input, 'now:measured', 'Questions measured', metrics.now.measured)
      : questionsNum(input, 'compared', 'Questions checked at both ends', comparison.compared)
  const noise = noiseOf(compared.n)
  const when =
    input.fromLabel === null
      ? `in the check of ${input.toLabel}`
      : `the same way on ${input.fromLabel} and ${input.toLabel}`
  const paragraphs = [
    `AI answers change from one search to the next, so we never judge one question. We checked ${compared.n} ${plural(compared.n, 'question')} ${when}, in ${ctx.marketLabel}, on ${ctx.engineLabel}.`,
    `A question counts as citing your pages when a ${ctx.domain} page is among the answer's sources. Only finished checks count.`,
    metrics.counting === 'once'
      ? 'Under All engines, each question counts once: it cites you when any engine cites your site. Pick one engine to see it on its own.'
      : 'Under All engines, each question counts once for each engine that checked it.',
    `Pages live under ${VERDICT_WAIT_DAYS} days are listed but not judged yet. The market vs your work split is exact: the two parts add back to the total change.`,
    `Answers vary. Ask the same question twice and an AI engine can cite different pages, so a small change can be chance. We read a change of fewer than ${noise} ${plural(noise, 'question')} (5% of those checked, at least 1) as noise, not a trend. Trust what holds over several checks.`
  ]
  return { paragraphs, compared, agreement: agreementOf(input), noise }
}

/** The answers-vary band: 5% of the questions compared, at least 1, rounded up. */
export function noiseOf(compared: number): number {
  return Math.max(1, Math.ceil(compared * 0.05))
}

/** Under All engines: questions two or more engines measured, and how many agree on "cited". */
function agreementOf(input: SectionInput): MethodView['agreement'] {
  const pairs: string[] = []
  const agree: string[] = []
  for (const id of input.metrics.now.checked.ids) {
    const row = input.metrics.rows[id]
    const parts = (row?.parts ?? [])
      .map((part) => input.metrics.rows[part])
      .filter((part) => part !== undefined && isMeasured(part))
    if (parts.length < 2) continue
    pairs.push(id)
    const cited = parts.map((part) => isCitedRow(part!))
    if (cited.every((value) => value === cited[0])) agree.push(id)
  }
  if (pairs.length === 0) return null
  return {
    percent: Math.round((agree.length / pairs.length) * 100),
    pairs: input.book.add('agree:all', {
      title: 'Questions two or more engines answered',
      kind: 'questions',
      ids: pairs
    }),
    agree: input.book.add('agree:same', {
      title: 'Engines agree on cited or not cited',
      kind: 'questions',
      ids: agree
    })
  }
}
