import { ENGINE_IDS, ENGINE_LABEL, type EngineId } from '../../domain/engines'
import { isAnswered, isCitedRow, isNamedRow } from '../../metrics/counts'
import { pageKey } from '../../metrics/pages'
import type { MetricsResult } from '../../metrics/types'
import { engineRowsOf } from './engine-rows'
import {
  headlineNoun,
  reportHeadlineParts,
  type HeadlineFigure,
  type HeadlineWords
} from '../../report-copy'
import { pathOf, plural } from './items'
import { reputationView } from './reputation'
import { LENS_LABELS, noiseOf, type SectionInput } from './sections'
import { REVIEW_LENSES } from './types'
import type { Num, PageItem, Part, ReviewLens, StandingView, Tile, TopicsView } from './types'
import { EMPTY_VISIBILITY, type VisibilityExtras } from './visibility-extras'
import type {
  CoverFact,
  EnginesView,
  OpportunityView,
  OtherPageRow,
  SegmentExtra,
  SinceView,
  TargetPageRow,
  TargetsView,
  TopicsExtra,
  VisibilityView
} from './visibility-types'

/**
 * The Visibility report's own cards (Docs/REPORT-SPEC.md "Visibility report"): the cover
 * strip, the headline sentence (the Full report's wording, `reportHeadlineParts`), the
 * opportunity, each engine side by side, the counts since the previous check, your target
 * pages, the Topics universe and the Reputation tab. Pure; every number is a drill.
 */

/** Best and weakest groups are judged only from groups this size or larger. */
export const SEGMENT_MINIMUM = 5

const LENS_PLURALS: Readonly<Record<ReviewLens, string>> = {
  topic: 'Topic groups',
  funnel: 'Funnel stages',
  intent: 'Intents',
  pageType: 'Page types'
}

const UGC_HOST = /(^|\.)(reddit\.com|youtube\.com|youtu\.be)$/i

export interface VisibilityInput extends SectionInput {
  extras: VisibilityExtras
  standing: StandingView
  topics: TopicsView
}

function q(
  input: SectionInput,
  id: string,
  title: string,
  ids: readonly string[],
  sub?: string
): Num {
  return input.book.add(id, {
    title,
    kind: 'questions',
    ids: [...new Set(ids)],
    ...(sub ? { sub } : {})
  })
}

function pct(part: number, whole: number): string {
  return whole > 0 ? `${Math.round((part / whole) * 100)}%` : '—'
}

export function visibilityView(input: VisibilityInput): VisibilityView {
  const extras = input.extras ?? EMPTY_VISIBILITY
  const targets = targetsView(input, extras)
  return {
    cover: coverOf(input, extras, targets),
    headline: headlineOf(input),
    kpiNotes: kpiNotes(input),
    opportunity: opportunityOf(input),
    engines: enginesOf(input),
    since: sinceOf(input, extras),
    targets,
    topics: topicsExtra(input),
    reputation: reputationView(input, extras.reputation)
  }
}

/** Target and other own pages missing from the report's pages, for the page drawers. */
export function visibilityPageItems(view: VisibilityView, known: readonly PageItem[]): PageItem[] {
  const keys = new Set(known.map((page) => pageKey(page.url)))
  const out: PageItem[] = []
  const add = (url: string, now: number): void => {
    const key = pageKey(url)
    if (keys.has(key)) return
    keys.add(key)
    out.push({
      url,
      path: pathOf(url),
      title: null,
      kind: null,
      liveSince: null,
      daysLive: null,
      indexed: null,
      before: null,
      now,
      status: now > 0 ? 'cited' : 'notyet',
      published: false
    })
  }
  for (const row of view.targets.rows) add(row.url, row.total.n)
  for (const row of view.targets.others) add(row.url, row.questions.n)
  return out
}

function toAtOf(metrics: MetricsResult): string | null {
  const to = metrics.window.to
  let at: string | null = null
  for (const check of metrics.checks) if (to === null || check.at <= to) at = check.at
  return at
}

function coverOf(input: SectionInput, extras: VisibilityExtras, targets: TargetsView): CoverFact[] {
  const { metrics, ctx } = input
  const checked = metrics.now.checked
  const tracked = q(input, 'now:checked', 'Every question checked', input.toIds(checked.ids))
  const topics = new Set(checked.ids.map((id) => metrics.rows[id]?.segments.topic ?? 'Not set'))
  const scope =
    extras.scopeLabel ||
    (metrics.scope.kind === 'project'
      ? 'Whole project'
      : metrics.scope.kind === 'topic'
        ? 'One topic'
        : 'One page')
  const brands = extras.brands.length > 0 ? extras.brands.join(', ') : ctx.brand
  const toAt = toAtOf(metrics)
  const upTo = metrics.checks.filter((check) => toAt === null || check.at <= toAt)
  const first = upTo[0]?.at ?? null
  const window =
    toAt === null
      ? 'No check yet'
      : first === null || first === toAt
        ? `${ctx.day(toAt)} · 1 check`
        : `${ctx.day(first)} → ${ctx.day(toAt)} · ${upTo.length} checks`
  const facts: CoverFact[] = [
    { label: 'Scope', value: scope },
    { label: 'Market', value: ctx.marketLabel },
    { label: 'Brands looked for', value: brands },
    {
      label: 'Questions',
      value: `${tracked.n} ${plural(tracked.n, 'question')} × ${topics.size} ${plural(topics.size, 'topic')}`,
      num: tracked
    }
  ]
  if (targets.set !== null) {
    facts.push({
      label: 'Target pages set',
      value: `${targets.set.n.n} of ${targets.set.of} questions`,
      num: targets.set.n
    })
  }
  facts.push({ label: 'Data window', value: window })
  return facts
}

function wordsFor(engine: MetricsResult['engine']): HeadlineWords | undefined {
  if (engine === 'google_aio') return undefined
  if (engine === 'all') {
    return {
      shows: 'An AI answer shows',
      showsNone: 'No AI answer shows',
      whether: 'whether an AI answer shows'
    }
  }
  const name = ENGINE_LABEL[engine]
  return {
    shows: `${name} shows an AI answer`,
    showsNone: `${name} shows no AI answer`,
    whether: `whether ${name} shows an AI answer`
  }
}

/** The Full report's headline sentence, with every number opening its questions. */
function headlineOf(input: SectionInput): Part[] {
  const { metrics, ctx } = input
  const now = metrics.now
  const n = (id: string, title: string, ids: readonly string[]): Num =>
    q(input, id, title, input.toIds(ids))
  const nums: Readonly<Record<HeadlineFigure['key'], Num>> = {
    tracked: n('now:checked', 'Every question checked', now.checked.ids),
    measured: n('now:measured', 'Questions measured', now.measured.ids),
    aio: n('now:answered', 'An AI answer showed', now.answered.ids),
    cited: n('now:cited', 'Questions citing your pages', now.cited.ids),
    named: n('now:named', `${ctx.brand} named in the answer`, now.named.ids),
    notVisible: n('now:invisible', 'An answer showed without you', now.notVisible.ids)
  }
  const markets = new Set(now.checked.ids.map((id) => metrics.rows[id]?.marketId ?? ''))
  const pieces = reportHeadlineParts(
    {
      measured: now.measured.n,
      aio: now.answered.n,
      cited: now.cited.n,
      named: now.named.n,
      notVisible: now.notVisible.n,
      failed: now.failed.n,
      noun: headlineNoun(markets.size, metrics.scope.kind === 'project')
    },
    wordsFor(metrics.engine)
  )
  return pieces.map((piece) => {
    if (typeof piece === 'string') return piece
    const num = nums[piece.key]
    // The sentence says the stored count; a number only opens a list of the same size.
    return num.n === piece.n ? num : String(piece.n)
  })
}

function kpiNotes(input: SectionInput): string[] {
  const now = input.metrics.now
  const answers = now.answered.n
  const ofAnswers = (n: number): string =>
    answers === 0 ? 'No AI answers yet' : `${pct(n, answers)} of answers`
  return [
    now.failed.n > 0
      ? `${now.failed.n} ${plural(now.failed.n, 'search', 'searches')} failed`
      : 'Every question checked',
    `${pct(answers, now.checked.n)} of tracked`,
    ofAnswers(now.cited.n),
    ofAnswers(now.named.n),
    ofAnswers(now.first.n),
    ofAnswers(now.notVisible.n)
  ]
}

function opportunityOf(input: SectionInput): OpportunityView {
  const { metrics, ctx } = input
  const lists = {
    invisible: [] as string[],
    wrongpage: [] as string[],
    ugc: [] as string[],
    winning: [] as string[]
  }
  let rest = 0
  const answered = input.toIds(metrics.now.answered.ids)
  for (const id of answered) {
    const row = metrics.rows[id]
    if (row === undefined) continue
    const cited = isCitedRow(row)
    if (row.result === 'target' && row.named) lists.winning.push(id)
    else if (row.result === 'other') lists.wrongpage.push(id)
    else if (!cited && row.domains.some((domain) => UGC_HOST.test(domain))) lists.ugc.push(id)
    else if (!cited && !row.named) lists.invisible.push(id)
    else rest += 1
  }
  return {
    answers: q(input, 'now:answered', 'An AI answer showed', answered),
    bars: [
      {
        id: 'invisible',
        label: 'Invisible',
        sub: 'The answer neither cites nor names you.',
        value: q(
          input,
          'vis:opp:invisible',
          'Invisible: the answer neither cites nor names you',
          lists.invisible
        )
      },
      {
        id: 'wrongpage',
        label: 'Cited, but the wrong page',
        sub: 'Your site is cited, but not the Primary or Also OK page set for the question.',
        value: q(
          input,
          'vis:opp:wrongpage',
          'Cited, but not the page set for the question',
          lists.wrongpage
        )
      },
      {
        id: 'ugc',
        label: 'Reddit or YouTube beat you',
        sub: 'The answer cites Reddit or YouTube and none of your pages.',
        value: q(input, 'vis:opp:ugc', 'Reddit or YouTube cited, your pages not', lists.ugc)
      },
      {
        id: 'winning',
        label: 'Already winning',
        sub: `The right page is cited and ${ctx.brand} is named.`,
        value: q(
          input,
          'vis:opp:winning',
          `Already winning: right page cited and ${ctx.brand} named`,
          lists.winning
        )
      }
    ],
    rest
  }
}

function enginesIn(metrics: MetricsResult, ids: readonly string[]): EngineId[] {
  const seen = new Set<string>()
  for (const id of ids) for (const row of engineRowsOf(metrics, id)) seen.add(row.engine)
  return ENGINE_IDS.filter((engine) => seen.has(engine))
}

function enginesOf(input: SectionInput): EnginesView {
  const { metrics, ctx } = input
  const checked = input.toIds(metrics.now.checked.ids)
  const engines = enginesIn(metrics, checked)
  if (engines.length < 2) {
    return {
      rows: [],
      note:
        metrics.engine !== 'all' && metrics.offeredEngines.length >= 2
          ? 'Pick All engines to see every engine side by side.'
          : null
    }
  }
  const rows = engines.map((engine) => {
    const lists = {
      answered: [] as string[],
      cited: [] as string[],
      right: [] as string[],
      named: [] as string[]
    }
    for (const id of checked) {
      for (const row of engineRowsOf(metrics, id)) {
        if (row.engine !== engine) continue
        if (isAnswered(row)) lists.answered.push(id)
        if (isCitedRow(row)) lists.cited.push(id)
        if (row.result === 'target') lists.right.push(id)
        if (isNamedRow(row)) lists.named.push(id)
      }
    }
    const label = ENGINE_LABEL[engine]
    const key = `vis:eng:${engine}`
    return {
      engine,
      label,
      answered: q(input, `${key}:ans`, `${label}: an AI answer showed`, lists.answered),
      cited: q(input, `${key}:cited`, `${label}: cites your pages`, lists.cited),
      right: q(input, `${key}:right`, `${label}: cites the right page`, lists.right),
      named: q(input, `${key}:named`, `${label}: names ${ctx.brand}`, lists.named)
    }
  })
  return { rows, note: null }
}

function sinceOf(input: SectionInput, extras: VisibilityExtras): SinceView | null {
  const since = extras.since
  if (since === null || input.metrics.checks.length < 2) return null
  const known = new Set(input.questions.map((item) => item.id))
  const keep = (ids: readonly string[]): string[] => ids.filter((id) => known.has(id))
  const from = input.ctx.day(since.fromAt)
  return {
    fromLabel: from,
    gained: q(input, 'vis:since:gained', `Started citing you since ${from}`, keep(since.gained)),
    lost: q(input, 'vis:since:lost', `Stopped citing you since ${from}`, keep(since.lost)),
    newlyNamed: q(
      input,
      'vis:since:named',
      `${input.ctx.brand} newly named since ${from}`,
      keep(since.newlyNamed)
    ),
    noLongerNamed: q(
      input,
      'vis:since:unnamed',
      `${input.ctx.brand} no longer named since ${from}`,
      keep(since.noLongerNamed)
    )
  }
}

function targetsView(input: SectionInput, extras: VisibilityExtras): TargetsView {
  const { metrics, book } = input
  const checked = input.toIds(metrics.now.checked.ids)
  const hasData = Object.keys(extras.targets).length > 0
  const known = new Map(input.pages.map((page) => [pageKey(page.url), page.url]))
  const urlOf = (url: string): string => known.get(pageKey(url)) ?? url
  const targets = new Map<string, { url: string; primary: Set<string>; also: Set<string> }>()
  const withTarget: string[] = []
  for (const id of checked) {
    const row = metrics.rows[id]
    const list = row === undefined ? [] : (extras.targets[row.questionId] ?? [])
    if (list.length > 0) withTarget.push(id)
    list.forEach((url, index) => {
      const key = pageKey(url)
      const entry = targets.get(key) ?? { url: urlOf(url), primary: new Set(), also: new Set() }
      ;(index === 0 ? entry.primary : entry.also).add(id)
      targets.set(key, entry)
    })
  }
  const engines = enginesIn(metrics, checked)
  const byEngine = new Map<string, Map<EngineId, Set<string>>>()
  const total = new Map<string, Set<string>>()
  const citedUrl = new Map<string, string>()
  for (const id of checked) {
    for (const row of engineRowsOf(metrics, id)) {
      if (!isCitedRow(row) || row.citedUrl === null || row.engine === 'all') continue
      const key = pageKey(row.citedUrl)
      if (!citedUrl.has(key)) citedUrl.set(key, urlOf(row.citedUrl))
      const per = byEngine.get(key) ?? new Map<EngineId, Set<string>>()
      per.set(row.engine, (per.get(row.engine) ?? new Set()).add(id))
      byEngine.set(key, per)
      total.set(key, (total.get(key) ?? new Set()).add(id))
    }
  }
  const set = hasData
    ? {
        n: q(input, 'vis:targets:set', 'Questions with a target page', withTarget),
        of: checked.length
      }
    : null
  const rows: TargetPageRow[] = [...targets].map(([key, entry]) => {
    const path = pathOf(entry.url)
    const all = [...(total.get(key) ?? [])]
    return {
      url: entry.url,
      path,
      role:
        entry.primary.size > 0 && entry.also.size > 0
          ? 'Primary · Also OK'
          : entry.primary.size > 0
            ? 'Primary'
            : 'Also OK',
      questions: q(input, `vis:tp:${entry.url}:for`, `${path}: questions it is set for`, [
        ...entry.primary,
        ...entry.also
      ]),
      engines: engines.map((engine) =>
        q(input, `vis:tp:${entry.url}:${engine}`, `${path}: cited by ${ENGINE_LABEL[engine]}`, [
          ...(byEngine.get(key)?.get(engine) ?? [])
        ])
      ),
      total: q(input, `vis:tp:${entry.url}:all`, `${path}: questions citing it`, all),
      notCited: all.length === 0
    }
  })
  rows.sort(
    (a, b) => b.total.n - a.total.n || b.questions.n - a.questions.n || a.path.localeCompare(b.path)
  )
  const byId = new Map(input.questions.map((item) => [item.id, item]))
  const others: OtherPageRow[] = [...total]
    .filter(([key]) => !targets.has(key))
    .map(([key, ids]) => {
      const url = citedUrl.get(key) ?? key
      const path = pathOf(url)
      const list = [...ids]
      return {
        url,
        path,
        questions: q(
          input,
          `vis:op:${url}`,
          `${path}: questions citing it`,
          list,
          'Not a target page for these questions.'
        ),
        items: list.flatMap((id) => {
          const item = byId.get(id)
          return item === undefined ? [] : [item]
        })
      }
    })
    .sort((a, b) => b.questions.n - a.questions.n || a.path.localeCompare(b.path))
  const pages = (id: string, title: string, urls: readonly string[]): Num =>
    book.add(id, { title, kind: 'pages', ids: urls })
  const tiles: Tile[] =
    rows.length === 0
      ? []
      : [
          tileOf(
            'Target pages set up',
            pages(
              'vis:tp:all',
              'Target pages set up',
              rows.map((r) => r.url)
            )
          ),
          tileOf(
            'Cited',
            pages(
              'vis:tp:cited',
              'Target pages cited',
              rows.filter((r) => !r.notCited).map((r) => r.url)
            ),
            'ok'
          ),
          tileOf(
            'Not cited yet',
            pages(
              'vis:tp:never',
              'Target pages not cited yet',
              rows.filter((r) => r.notCited).map((r) => r.url)
            ),
            rows.some((r) => r.notCited) ? 'warn' : 'neutral'
          ),
          tileOf(
            'Other pages of yours cited',
            pages(
              'vis:tp:other',
              'Other pages of yours cited',
              others.map((r) => r.url)
            )
          )
        ]
  return {
    set,
    tiles,
    engines: engines.map((id) => ({ id, label: ENGINE_LABEL[id] })),
    rows,
    others,
    empty:
      checked.length === 0
        ? 'No questions checked here yet.'
        : !hasData
          ? 'No target pages set yet. Set a Primary page for your questions to see which of them AI answers cite.'
          : rows.length === 0
            ? 'None of these questions has a target page yet.'
            : null
  }
}

function tileOf(label: string, num: Num, tone?: Tile['tone']): Tile {
  return {
    label,
    value: num.n.toLocaleString('en-US'),
    drill: num.drill,
    ...(tone ? { tone } : {})
  }
}

function topicsExtra(input: VisibilityInput): TopicsExtra {
  const { metrics } = input
  const named = new Set(input.toIds(metrics.now.named.ids))
  const comparing = metrics.comparison !== null
  const noise = noiseOf(comparing ? (metrics.comparison?.compared.n ?? 0) : metrics.now.measured.n)
  const universe = {} as Record<ReviewLens, Tile[]>
  const rows = {} as Record<ReviewLens, Record<string, SegmentExtra>>
  for (const lens of REVIEW_LENSES) {
    const segments = input.topics.lenses[lens]
    const out: Record<string, SegmentExtra> = {}
    for (const [index, seg] of metrics.segments[lens].entries()) {
      const key = `seg:${lens}:${seg.value}`
      const ids = input.toIds(seg.questions.ids)
      const answered = q(
        input,
        `${key}:ans`,
        `${seg.value}: an AI answer showed`,
        input.toIds((seg.answered.after ?? seg.answered.now).ids)
      )
      const namedNum = q(
        input,
        `${key}:named`,
        `${seg.value}: ${input.ctx.brand} named`,
        ids.filter((id) => named.has(id))
      )
      const view = segments[index]
      const change = view?.change ?? null
      out[seg.value] = {
        answered,
        named: namedNum,
        bar: seg.questions.n > 0 ? Math.round(((view?.now.n ?? 0) / seg.questions.n) * 100) : 0,
        flag:
          seg.questions.n < SEGMENT_MINIMUM
            ? 'small'
            : comparing && change !== null && change !== 0 && Math.abs(change) < noise
              ? 'within'
              : null
      }
    }
    rows[lens] = out
    universe[lens] = universeTiles(lens, segments)
  }
  return { universe, rows, minimum: SEGMENT_MINIMUM }
}

function universeTiles(lens: ReviewLens, segments: TopicsView['lenses'][ReviewLens]): Tile[] {
  const set = segments.filter((seg) => seg.value !== 'Not set')
  if (set.length === 0) return []
  const word = LENS_LABELS[lens].toLowerCase()
  const largest = [...set].sort((a, b) => b.questions.n - a.questions.n)[0]!
  const judged = set
    .filter((seg) => seg.questions.n >= SEGMENT_MINIMUM && seg.shareNow !== null)
    .sort((a, b) => (b.shareNow ?? 0) - (a.shareNow ?? 0) || b.questions.n - a.questions.n)
  const best = judged[0]
  const weakest = judged.length > 1 ? judged.at(-1) : undefined
  const share = (rate: number | null): string =>
    rate === null ? '—' : `${Math.round(rate * 100)}%`
  const none = `needs a ${word} of ${SEGMENT_MINIMUM}+ questions`
  return [
    { label: LENS_PLURALS[lens], value: String(set.length), drill: null },
    {
      label: `Largest · ${largest.questions.n} ${plural(largest.questions.n, 'question')}`,
      value: largest.value,
      drill: largest.questions.drill
    },
    best === undefined
      ? { label: `Best (${none})`, value: '—', drill: null }
      : {
          label: `Best · ${share(best.shareNow)} of answers cite you`,
          value: best.value,
          drill: best.now.drill,
          tone: 'ok'
        },
    weakest === undefined
      ? { label: `Weakest (${none})`, value: '—', drill: null }
      : {
          label: `Weakest · ${share(weakest.shareNow)} of answers cite you`,
          value: weakest.value,
          drill: weakest.open.drill,
          tone: 'warn'
        }
  ]
}
