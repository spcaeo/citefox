import { VERDICT_WAIT_DAYS } from '../../fix-verdict'
import { attributionOf } from '../../metrics/attribution'
import { isAnswered, isCitedRow } from '../../metrics/counts'
import type { MetricCount, MetricsResult } from '../../metrics/types'
import { clearMove, MIN_COMPARABLE, verdictStatus } from '../verdict'
import { percent, plural, signedTenths, tenthsText, type DrillBook } from './items'
import type {
  BarItem,
  BucketItem,
  Finding,
  Kpi,
  Num,
  PageItem,
  Part,
  ReportContext,
  SplitView,
  Step,
  Tone,
  VerdictView
} from './types'

/**
 * The Impact review's Verdict: a badge, a plain headline, findings in green (good) or
 * orange (a setback), before → now tiles, market vs your work, where citations come
 * from, how fast new pages get cited, and what we do next. Fixed rules on stored
 * counts, never an AI: every number is a drill.
 */

export interface VerdictInput {
  metrics: MetricsResult
  book: DrillBook
  toIds: (ids: readonly string[]) => string[]
  ctx: ReportContext
  pages: readonly PageItem[]
  fromLabel: string | null
  toLabel: string
}

const BADGES: Readonly<Record<string, { label: string; tone: Tone }>> = {
  strong: { label: 'Working, strong early results', tone: 'ok' },
  working: { label: 'Working, early signs', tone: 'ok' },
  mixed: { label: 'Mixed', tone: 'warn' },
  slipping: { label: 'Slipping', tone: 'bad' },
  flat: { label: 'Not moving yet', tone: 'neutral' },
  early: { label: 'Too early to tell', tone: 'neutral' },
  market: { label: 'Up, thanks to more AI answers', tone: 'neutral' }
}

export function questionsWord(n: number): string {
  return plural(n, 'question')
}

/** The Verdict's badge. It reads "your work", so a rise Google caused never oversells. */
export function badgeOf(metrics: MetricsResult): { label: string; tone: Tone } {
  const comparison = metrics.comparison
  if (comparison === null || metrics.checks.length < 2) return BADGES.early!
  const m = comparison.movement
  const changes = {
    gained: m.gained.n,
    kept: m.kept.n,
    lost: m.lost.n,
    never: m.never.n,
    unmatched: comparison.excluded.noBefore.n
  }
  const status = verdictStatus(changes)
  const work = comparison.decomposition.workTenths
  if ((status === 'strong' || status === 'working') && work <= 0) return BADGES.market!
  if (status === 'strong' && work < clearMove(comparison.compared.n) * 10) return BADGES.working!
  return BADGES[status] ?? BADGES.early!
}

function kpi(label: string, now: number, before: number | null, drill: string): Kpi {
  return {
    label,
    now: now.toLocaleString('en-US'),
    before: before === null ? null : before.toLocaleString('en-US'),
    trend: before === null ? null : now > before ? 'up' : now < before ? 'down' : 'flat',
    drill
  }
}

function rateKpi(
  label: string,
  now: number | null,
  before: number | null,
  drill: string,
  comparing: boolean
): Kpi {
  return {
    label,
    now: percent(now),
    before: comparing ? percent(before) : null,
    trend:
      !comparing || now === null || before === null
        ? null
        : now > before
          ? 'up'
          : now < before
            ? 'down'
            : 'flat',
    drill
  }
}

export function buildVerdict(input: VerdictInput): VerdictView {
  const { metrics, book, toIds, ctx, pages, fromLabel, toLabel } = input
  const comparison = metrics.comparison
  const q = (id: string, title: string, count: MetricCount, sub?: string): Num =>
    book.add(id, {
      title,
      kind: 'questions',
      ids: toIds(count.ids),
      ...(sub ? { sub } : {})
    })
  const p = (id: string, title: string, urls: readonly string[]): Num =>
    book.add(id, { title, kind: 'pages', ids: urls })
  const at = (label: string | null): string => (label === null ? '' : `, ${label}`)
  const after = comparison?.after ?? metrics.now
  const before = comparison?.before ?? null
  const citeA = q('cite:a', `Questions citing your pages${at(toLabel)}`, after.cited)
  const citeB =
    before === null
      ? null
      : q('cite:b', `Questions citing your pages${at(fromLabel)}`, before.cited)
  const namedA = q('named:a', `${ctx.brand} named in the answer${at(toLabel)}`, after.named)
  const namedB =
    before === null
      ? null
      : q('named:b', `${ctx.brand} named in the answer${at(fromLabel)}`, before.named)
  const published = pages.filter((page) => page.published)
  const att = published.length > 0 ? attributionOf(metrics) : null
  const pubA =
    att === null
      ? null
      : q('pubcite:a', `Questions citing your published pages${at(toLabel)}`, att.published.after)
  const pubB =
    att === null || att.published.before === null
      ? null
      : q(
          'pubcite:b',
          `Questions citing your published pages${at(fromLabel)}`,
          att.published.before
        )
  const ansA = q('ans:a', `Questions with an AI answer${at(toLabel)}`, after.answered)
  const ansB =
    before === null
      ? null
      : q('ans:b', `Questions with an AI answer${at(fromLabel)}`, before.answered)
  const pos1A = q('pos1:a', `${ctx.brand} is the number-one source${at(toLabel)}`, after.first)
  const pos1B =
    before === null
      ? null
      : q('pos1:b', `${ctx.brand} is the number-one source${at(fromLabel)}`, before.first)
  const kpis: Kpi[] = [
    ...(pubA === null
      ? []
      : [kpi('Citing your published pages', pubA.n, pubB?.n ?? null, pubA.drill)]),
    kpi('Questions citing your site', citeA.n, citeB?.n ?? null, citeA.drill),
    kpi('Questions with an AI answer', ansA.n, ansB?.n ?? null, ansA.drill),
    rateKpi(
      'Your share of AI answers',
      after.rate,
      before?.rate ?? null,
      citeA.drill,
      before !== null
    ),
    kpi('Number-one source', pos1A.n, pos1B?.n ?? null, pos1A.drill),
    kpi('Brand named', namedA.n, namedB?.n ?? null, namedA.drill),
    positionKpi(metrics, after.cited.ids, before?.cited.ids ?? null, citeA.drill)
  ]

  const notIndexed = published.filter((page) => page.indexed === false)
  const tooNew = published.filter((page) => page.status === 'toonew')
  const lostPages = published.filter((page) => page.status === 'lost')
  const notIdxNum = p(
    'pages:notindexed',
    'Not indexed yet',
    notIndexed.map((x) => x.url)
  )
  const tooNewNum = p(
    'pages:toonew',
    `Too new to judge (under ${VERDICT_WAIT_DAYS} days)`,
    tooNew.map((x) => x.url)
  )

  let split: SplitView | null = null
  const findings: Finding[] = []
  let headline: Part[]
  if (
    comparison === null ||
    citeB === null ||
    ansB === null ||
    pos1B === null ||
    metrics.checks.length < 2
  ) {
    headline = [
      `Only one check so far: `,
      citeA,
      ` ${questionsWord(citeA.n)} cite your pages. Pick an earlier check in From to see what changed.`
    ]
  } else {
    const d = comparison.decomposition
    const m = comparison.movement
    const newAnswers = q(
      'ans:new',
      'Questions that got an AI answer for the first time',
      m.newAnswers,
      'This is the market part of the change.'
    )
    const marketNum = q(
      'split:market',
      'Answers that appeared or went away (the market)',
      { n: d.marketIds.length, ids: d.marketIds },
      'Questions whose AI answer appeared or went away between the two checks.'
    )
    const workNum = q(
      'split:work',
      'Questions you gained or lost (your work)',
      { n: d.workIds.length, ids: d.workIds },
      'Questions that started or stopped citing your pages.'
    )
    split = {
      totalTenths: d.total * 10,
      marketTenths: d.marketTenths,
      workTenths: d.workTenths,
      marketDrill: marketNum.drill,
      workDrill: workNum.drill,
      newAnswers,
      rateBefore: d.rateBefore,
      rateAfter: d.rateAfter
    }
    const gained = q('gained', 'Started citing you', m.gained)
    const kept = q('kept', 'Kept citing you', m.kept)
    const lost = q('lost', 'Stopped citing you', m.lost)
    const went: Part[] = [`Questions citing your pages went from `, citeB, ' to ', citeA]
    if (d.total > 0) {
      const mostly = d.workTenths >= d.total * 6
      headline =
        d.workTenths <= 0
          ? [...went, `, but that rise came from Google showing more AI answers, not from you.`]
          : mostly
            ? [...went, `, and most of that rise is your own work.`]
            : [
                ...went,
                `. About ${tenthsText(d.workTenths)} of it is your own work; the rest came from more AI answers.`
              ]
    } else if (d.total < 0) {
      headline = [
        ...went,
        d.workTenths >= 0
          ? `. Google showed fewer AI answers; your share of answers held.`
          : `. You won a smaller share of the AI answers.`
      ]
    } else {
      headline = [`Questions citing your pages stayed at `, citeA, '.']
    }
    if (comparison.compared.n >= MIN_COMPARABLE && d.total !== 0) {
      const own = d.workTenths > 0 && d.workTenths >= Math.abs(d.marketTenths)
      findings.push({
        tone: own || d.total < 0 ? (d.workTenths >= 0 ? 'ok' : 'warn') : 'warn',
        lead:
          d.workTenths > 0 && own
            ? "It's your work, not luck."
            : d.workTenths > 0
              ? 'Part luck, part your work.'
              : d.total > 0
                ? 'The rise came from the market.'
                : 'You won fewer answers.',
        parts: [
          'Google showed an AI answer on ',
          ansB,
          ' → ',
          ansA,
          ` questions. That explains about ${tenthsText(d.marketTenths)} of the ${signedTenths(d.total * 10)}. The other ${signedTenths(d.workTenths)} came from your pages ${d.workTenths >= 0 ? 'winning more' : 'winning fewer'} answers.`
        ]
      })
    }
    findings.push({
      tone: m.gained.n === 0 && m.lost.n === 0 ? 'neutral' : m.gained.n >= m.lost.n ? 'ok' : 'warn',
      lead:
        m.gained.n > m.lost.n
          ? 'More questions cite you.'
          : m.gained.n < m.lost.n
            ? 'Fewer questions cite you.'
            : m.gained.n === 0
              ? 'No question moved.'
              : 'Citations moved around.',
      parts: [gained, ' started citing you, ', kept, ' kept citing you, ', lost, ' stopped.']
    })
    if (pos1A.n !== pos1B.n) {
      findings.push({
        tone: pos1A.n > pos1B.n ? 'ok' : 'warn',
        lead:
          pos1A.n > pos1B.n
            ? "You're the top source more often."
            : "You're the top source less often.",
        parts: [`${ctx.brand} is the number-one source on `, pos1A, ' questions, from ', pos1B, '.']
      })
    }
  }

  const speed = speedOf(metrics, book, toIds)
  const older = metrics.pages.speed.filter((bucket) => bucket.id === '8-13' || bucket.id === '14+')
  const olderPages = older.flatMap((bucket) => bucket.pages.ids)
  const olderCited = older.flatMap((bucket) => bucket.citedPages.ids)
  if (olderPages.length > 0) {
    const all = p('pages:older', 'Pages live 8 days or more', olderPages)
    const cited = p('pages:older-cited', 'Pages live 8 days or more, cited already', olderCited)
    findings.push({
      tone: cited.n * 2 >= all.n ? 'ok' : 'warn',
      lead:
        cited.n * 2 >= all.n
          ? 'Pages get cited within about two weeks.'
          : 'Pages are slow to get cited.',
      parts: [cited, ' of ', all, ' pages live 8 days or more are cited already.']
    })
  }
  if (lostPages.length > 0 || notIndexed.length > 0) {
    const parts: Part[] = []
    for (const page of lostPages.slice(0, 2)) {
      const lostNum = lostQuestionsNum(metrics, book, toIds, page)
      const movedNum = movedToOwnNum(metrics, book, page, lostNum)
      parts.push(`${page.path} lost `, lostNum, ` ${questionsWord(lostNum.n)}`)
      parts.push(...(movedNum.n > 0 ? ['; ', movedNum, ' moved to your other pages. '] : ['. ']))
    }
    if (notIndexed.length > 0) {
      parts.push(notIdxNum, ` ${plural(notIdxNum.n, 'page is', 'pages are')} not in Google yet.`)
    }
    findings.push({
      tone: 'warn',
      lead: lostPages.length + (notIndexed.length > 0 ? 1 : 0) > 1 ? 'Setbacks.' : 'One setback.',
      parts
    })
  }

  return {
    badge: badgeOf(metrics),
    headline,
    findings: findings.slice(0, 5),
    kpis,
    split,
    groups: groupsOf(metrics, book, toIds, fromLabel, toLabel),
    speed,
    next: nextSteps({ ...input, notIdxNum, tooNewNum, tooNew, lostPages })
  }
}

/** Questions that cited this page at the From end and do not now. */
/** Of the questions a page lost: the ones another page of yours is cited on now. */
export function movedToOwnNum(
  metrics: MetricsResult,
  book: DrillBook,
  page: PageItem,
  lost: Num
): Num {
  const ids = (book.drills[lost.drill]?.ids ?? []).filter((id) => {
    const row = metrics.rows[id]
    return row !== undefined && isAnswered(row) && isCitedRow(row)
  })
  return book.add(`lost:${page.url}:own`, {
    title: `${page.path}: now cite another page of yours`,
    kind: 'questions',
    ids
  })
}

/** Average source position over the questions citing you (lower is better), one decimal. */
function positionKpi(
  metrics: MetricsResult,
  afterIds: readonly string[],
  beforeIds: readonly string[] | null,
  drill: string
): Kpi {
  const avg = (ids: readonly string[]): number | null => {
    const values = ids.flatMap((id) => {
      const position = metrics.rows[id]?.position
      return typeof position === 'number' ? [position] : []
    })
    return values.length === 0 ? null : values.reduce((sum, v) => sum + v, 0) / values.length
  }
  const now = avg(afterIds)
  const before = beforeIds === null ? null : avg(beforeIds)
  const text = (value: number | null): string => (value === null ? '—' : value.toFixed(1))
  const a = now === null ? null : Math.round(now * 10)
  const b = before === null ? null : Math.round(before * 10)
  return {
    label: 'Average position',
    now: text(now),
    before: beforeIds === null ? null : text(before),
    trend: a === null || b === null ? null : a > b ? 'up' : a < b ? 'down' : 'flat',
    drill,
    lowerIsBetter: true
  }
}

export function lostQuestionsNum(
  metrics: MetricsResult,
  book: DrillBook,
  toIds: (ids: readonly string[]) => string[],
  page: PageItem
): Num {
  const row = metrics.pages.rows.find((item) => item.url === page.url)
  const before = new Set(toIds(row?.cited.before?.ids ?? []))
  const after = new Set(row?.cited.after?.ids ?? [])
  const ids = [...before].filter((id) => !after.has(id))
  return book.add(`lost:${page.url}`, {
    title: `${page.path}: questions it no longer wins`,
    kind: 'questions',
    ids
  })
}

const GROUP_LABELS = { new: 'New pages', rewrite: 'Rewritten pages', other: 'Other pages' }

function groupsOf(
  metrics: MetricsResult,
  book: DrillBook,
  toIds: (ids: readonly string[]) => string[],
  fromLabel: string | null,
  toLabel: string
): BarItem[] {
  return metrics.pages.groups.flatMap((group) => {
    const label = GROUP_LABELS[group.kind]
    const nowCount = group.cited.after ?? group.cited.now
    const now = book.add(`grp:${group.kind}:a`, {
      title: `${label}, ${toLabel}`,
      kind: 'questions',
      ids: nowCount.ids
    })
    const before =
      group.cited.before === null
        ? null
        : book.add(`grp:${group.kind}:b`, {
            title: `${label}, ${fromLabel ?? ''}`,
            kind: 'questions',
            ids: toIds(group.cited.before.ids)
          })
    if (now.n === 0 && (before?.n ?? 0) === 0) return []
    return [
      {
        label,
        before: before?.n ?? 0,
        now: now.n,
        beforeDrill: before?.drill ?? null,
        nowDrill: now.drill,
        tone: 'target' as const
      }
    ]
  })
}

function speedOf(
  metrics: MetricsResult,
  book: DrillBook,
  toIds: (ids: readonly string[]) => string[]
): BucketItem[] {
  if (metrics.pages.published.n === 0) return []
  return metrics.pages.speed.map((bucket) => {
    const num = book.add(`bucket:${bucket.id}`, {
      title: `Questions citing pages live ${bucket.label}`,
      kind: 'questions',
      ids: toIds(bucket.questions.ids),
      sub: `${bucket.pages.n} ${plural(bucket.pages.n, 'page')} in this group, ${bucket.citedPages.n} cited now.`
    })
    return {
      label: bucket.label,
      sub: `${bucket.citedPages.n} of ${bucket.pages.n} ${plural(bucket.pages.n, 'page')} cited`,
      value: num.n,
      drill: num.drill
    }
  })
}

function nextSteps(
  input: VerdictInput & {
    notIdxNum: Num
    tooNewNum: Num
    tooNew: readonly PageItem[]
    lostPages: readonly PageItem[]
  }
): Step[] {
  const { metrics, book, toIds, ctx, notIdxNum, tooNewNum, tooNew, lostPages, pages } = input
  const steps: Step[] = []
  for (const page of lostPages.slice(0, 2)) {
    const lost = lostQuestionsNum(metrics, book, toIds, page)
    steps.push({
      lead: `Recover ${page.path}.`,
      tab: 'lost',
      parts: [
        'Put back what the change dropped, then check again. ',
        lost,
        ' questions to win back.'
      ]
    })
  }
  if (notIdxNum.n > 0) {
    steps.push({
      lead: `Get ${notIdxNum.n} ${plural(notIdxNum.n, 'page')} into Google.`,
      tab: 'notindexed',
      parts: [
        notIdxNum,
        notIdxNum.n === 1
          ? ' page is not indexed. Send it for indexing and link to it from your busiest pages.'
          : ' pages are not indexed. Send them for indexing and link to them from your busiest pages.'
      ]
    })
  }
  if (tooNew.length > 0) {
    const youngest = Math.min(...tooNew.map((page) => page.daysLive ?? 0))
    const toAt = latestAt(metrics)
    const when =
      toAt === null
        ? 'in two weeks'
        : `on ${ctx.day(new Date(Date.parse(toAt) + Math.max(1, VERDICT_WAIT_DAYS - youngest) * 86_400_000).toISOString())}`
    steps.push({
      lead: `Check again ${when}.`,
      tab: 'next',
      parts: [
        'By then ',
        tooNewNum,
        ` ${plural(tooNewNum.n, 'page')} will be 14 days old and can be judged.`
      ]
    })
  }
  const stale = pages.filter((page) => page.published && page.status === 'notyet')
  if (stale.length > 0) {
    const num = book.add('pages:notyet', {
      title: `Live ${VERDICT_WAIT_DAYS}+ days, not cited`,
      kind: 'pages',
      ids: stale.map((page) => page.url)
    })
    steps.push({
      lead: 'Rework pages that are not cited after 14 days.',
      tab: 'published',
      parts: [
        num,
        ` ${plural(num.n, 'page has', 'pages have')} been live 14+ days without a citation.`
      ]
    })
  }
  const open = [...metrics.segments.topic]
    .filter((row) => row.open.n > 0 && row.value !== 'Not set')
    .sort((a, b) => b.open.n - a.open.n)[0]
  if (open !== undefined) {
    const num = book.add(`seg:topic:${open.value}:open`, {
      title: `${open.value}: answer shown, not citing you`,
      kind: 'questions',
      ids: open.open.ids
    })
    steps.push({
      lead: `Go after ${open.value}.`,
      tab: 'topics',
      parts: [num, ` ${questionsWord(num.n)} in it show an AI answer that doesn't cite you.`]
    })
  }
  return steps
}

function latestAt(metrics: MetricsResult): string | null {
  return metrics.window.to ?? metrics.checks.at(-1)?.at ?? null
}
