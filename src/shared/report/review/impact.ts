import { ENGINE_LABEL } from '../../domain/engines'
import { attributionOf } from '../../metrics/attribution'
import { pageKey } from '../../metrics/pages'
import type { MetricCount } from '../../metrics/types'
import type { AgencyInput } from './agency'
import { impactAsks } from './impact-asks'
import type { DaysRow, ImpactView, KindRow, PageStat } from './impact-types'
import { plural } from './items'
import { scheduleLine } from './needs'
import type { CompetitorsView, Finding, LostView, Num, Part, RoundView, SiteItem } from './types'

/**
 * The Impact review's extra parts (impact-types.ts): the intro at the top of Verdict,
 * the proofs that the published pages did it, the top sites, the published-page tables
 * and the method checks. The client asks (Not indexed, Next round, Lost ground) are in
 * impact-asks.ts. Fixed rules on stored counts; every number registers its drill.
 */

export interface ImpactInput extends AgencyInput {
  /** The checks the two ends stand for (ISO), as build.ts resolved them. */
  fromAt: string | null
  toAt: string | null
  competitors: CompetitorsView
  lostGround: LostView
  round: RoundView
}

/** Top sites shown on Verdict. */
const TOP_SITES = 8

export function impactView(input: ImpactInput): ImpactView {
  const { metrics, book, ctx, fromLabel, toLabel } = input
  const published = input.pages.filter((page) => page.published)
  const twoChecks = metrics.checks.length >= 2 && metrics.comparison !== null
  const q = (id: string, title: string, count: MetricCount | readonly string[]): Num =>
    book.add(id, {
      title,
      kind: 'questions',
      ids: input.toIds(Array.isArray(count) ? count : (count as MetricCount).ids)
    })
  const p = (id: string, title: string, urls: readonly string[]): Num =>
    book.add(id, { title, kind: 'pages', ids: urls })

  const checked = q('now:checked', 'Every question checked', metrics.now.checked)
  const citedNow = q(
    'cite:a',
    `Questions citing your pages, ${toLabel}`,
    metrics.comparison?.after.cited ?? metrics.now.cited
  )
  const pubNum = p(
    'pages:all',
    'Pages published',
    published.map((page) => page.url)
  )
  const att = attributionOf(metrics)
  const pubA = q(
    'pubcite:a',
    `Questions citing your published pages, ${toLabel}`,
    att.published.after
  )
  const pubB =
    att.published.before === null
      ? null
      : q(
          'pubcite:b',
          `Questions citing your published pages, ${fromLabel ?? ''}`,
          att.published.before
        )
  const restA = q(
    'restcite:a',
    `Questions citing the rest of your site, ${toLabel}`,
    att.rest.after
  )
  const restB =
    att.rest.before === null
      ? null
      : q(
          'restcite:b',
          `Questions citing the rest of your site, ${fromLabel ?? ''}`,
          att.rest.before
        )

  // The intro: one lead line, the at-a-glance list and the header's meta line.
  let lead: Part[]
  if (published.length === 0) {
    lead = [
      `${ctx.brand} is cited on `,
      citedNow,
      ` of `,
      checked,
      ` questions on ${toLabel}. No published pages are logged yet, so this review cannot show what your work did.`
    ]
  } else if (!twoChecks) {
    lead = [
      pubNum,
      ` ${plural(pubNum.n, 'page')} published; `,
      citedNow,
      ` questions cite your site on ${toLabel}. A second check shows what the pages did.`
    ]
  } else if (pubB !== null && pubB.n === pubA.n) {
    lead = [
      `The `,
      pubNum,
      ` ${plural(pubNum.n, 'page')} you published are cited on `,
      pubA,
      ` questions on ${toLabel}, the same as on ${fromLabel}.`
    ]
  } else {
    lead = [
      `Between ${fromLabel} and ${toLabel}, the `,
      pubNum,
      ` ${plural(pubNum.n, 'page')} you published went from `,
      pubB ?? '—',
      ' to ',
      pubA,
      ` questions citing them.`
    ]
  }
  const measured =
    twoChecks && fromLabel !== null ? `${fromLabel} and ${toLabel}` : `${toLabel} (one check)`
  const engines =
    metrics.engine === 'all'
      ? metrics.offeredEngines.map((engine) => ENGINE_LABEL[engine]).join(', ') || ctx.engineLabel
      : ctx.engineLabel
  const intro = {
    lead,
    glance: [
      { label: 'Measured', value: [measured] },
      { label: 'Questions', value: [checked] },
      { label: 'Pages published', value: [pubNum] },
      { label: 'Where', value: [ctx.marketLabel] },
      { label: 'Measured with', value: [engines] }
    ],
    meta: `${checked.n} ${plural(checked.n, 'question')} · ${pubNum.n} ${plural(pubNum.n, 'page')} published · measured ${twoChecks && fromLabel !== null ? `${fromLabel} and ${toLabel}` : toLabel}`
  }

  // The proofs: our pages vs the rest of the site, where the gains came from, your rank.
  const proofs: Finding[] = []
  if (twoChecks && published.length > 0 && pubB !== null && restB !== null) {
    const pubMove = pubA.n - pubB.n
    const restMove = restA.n - restB.n
    proofs.push({
      tone: pubMove > 0 && pubMove >= restMove ? 'ok' : pubMove < 0 ? 'warn' : 'neutral',
      lead:
        pubMove > 0 && pubMove >= restMove
          ? 'Your published pages did the lifting.'
          : pubMove > 0
            ? 'The rest of your site moved more.'
            : pubMove < 0
              ? 'Your published pages lost ground.'
              : 'No change through your published pages yet.',
      parts: [
        'Questions citing your published pages went ',
        pubB,
        ' → ',
        pubA,
        '; the rest of your site went ',
        restB,
        ' → ',
        restA,
        '.'
      ]
    })
  }
  if (twoChecks && published.length > 0 && att.gained.n > 0) {
    const gained = q('gained', 'Started citing you', att.gained)
    const via = q('gained:via', 'Gained through your published pages', att.gainedVia)
    const only = q('gained:only', 'Cite you only because of a published page', att.gainedOnly)
    proofs.push({
      tone: via.n * 2 >= gained.n ? 'ok' : 'neutral',
      lead:
        via.n * 2 >= gained.n
          ? 'Most new citations came through them.'
          : 'Most new citations came from your other pages.',
      parts: [
        'Of ',
        gained,
        ` ${plural(gained.n, 'question')} gained, `,
        via,
        ' came through your published pages; ',
        only,
        ` cite you only because of them.`
      ]
    })
  }
  const rank = rankFinding(input.competitors, ctx.domain)
  if (rank !== null) proofs.push(rank)

  return {
    intro,
    proofs,
    topSites: topSites(input.competitors),
    kinds: kindRows(input),
    days: dayRows(input),
    pageStats: pageStats(input),
    method: methodLines(input, published),
    pageDates: input.extras.pageDates ?? {},
    nextCheck: scheduleLine(input.extras, ctx),
    // Filled by build.ts once the report's pages and questions are known.
    stories: {},
    ...impactAsks(input)
  }
}

function siteNum(site: SiteItem): Num {
  return { n: site.now, drill: site.nowDrill }
}

/** "#n of all cited sites; next competitor X has N." From the ranked sites now. */
function rankFinding(competitors: CompetitorsView, domain: string): Finding | null {
  const all = [...competitors.all].sort(
    (a, b) => b.now - a.now || Number(b.own) - Number(a.own) || a.domain.localeCompare(b.domain)
  )
  const at = all.findIndex((site) => site.own)
  const own = all[at]
  if (own === undefined || own.now === 0 || all.length < 2) return null
  const rank = at + 1
  if (rank === 1) {
    const next = all[1]!
    return {
      tone: 'ok',
      lead: "You're the most cited site.",
      parts: [
        `${domain} is cited on `,
        siteNum(own),
        ` questions, more than any other of the ${all.length} cited sites. The next, ${next.domain}, has `,
        siteNum(next),
        '.'
      ]
    }
  }
  const ahead = all[at - 1]!
  return {
    tone: rank <= 3 ? 'neutral' : 'warn',
    lead: `You're #${rank} of all ${all.length} cited sites.`,
    parts: [
      `${domain} is cited on `,
      siteNum(own),
      ` questions. The site just ahead, ${ahead.domain}, has `,
      siteNum(ahead),
      '.'
    ]
  }
}

function topSites(competitors: CompetitorsView): SiteItem[] {
  const top = competitors.ranked.slice(0, TOP_SITES)
  const own = competitors.ranked.find((site) => site.own)
  if (own !== undefined && own.now > 0 && !top.includes(own)) {
    top[top.length - 1] = own
  }
  return top.filter((site) => site.now > 0 || (site.before ?? 0) > 0)
}

/** Questions (to-row ids) where your best source is #1. */
function firsts(input: ImpactInput, ids: readonly string[]): string[] {
  return ids.filter((id) => input.metrics.rows[id]?.position === 1)
}

function kindRows(input: ImpactInput): KindRow[] {
  const { metrics, book, toIds, fromLabel, toLabel } = input
  const out: KindRow[] = []
  for (const kind of ['new', 'rewrite'] as const) {
    const label = kind === 'new' ? 'New pages' : 'Rewrites'
    const pages = input.pages.filter((page) => page.published && page.kind === kind)
    if (pages.length === 0) continue
    const group = metrics.pages.groups.find((item) => item.kind === kind)
    const groupLabel = kind === 'new' ? 'New pages' : 'Rewritten pages'
    const nowIds = (group?.cited.after ?? group?.cited.now)?.ids ?? []
    const now = book.add(`grp:${kind}:a`, {
      title: `${groupLabel}, ${toLabel}`,
      kind: 'questions',
      ids: nowIds
    })
    const before =
      group?.cited.before === null || group === undefined
        ? null
        : book.add(`grp:${kind}:b`, {
            title: `${groupLabel}, ${fromLabel ?? ''}`,
            kind: 'questions',
            ids: toIds(group.cited.before.ids)
          })
    out.push({
      label,
      pages: book.add(kind === 'new' ? 'pages:new' : 'pages:rewrite', {
        title: label,
        kind: 'pages',
        ids: pages.map((page) => page.url)
      }),
      cited: book.add(`kind:${kind}:cited`, {
        title: `${label} cited now`,
        kind: 'pages',
        ids: pages.filter((page) => page.now > 0).map((page) => page.url)
      }),
      before,
      now,
      first: book.add(`kind:${kind}:first`, {
        title: `${label}: you are the number-one source`,
        kind: 'questions',
        ids: firsts(input, nowIds)
      })
    })
  }
  return out
}

function dayRows(input: ImpactInput): DaysRow[] {
  const { metrics, book, toIds } = input
  if (metrics.pages.published.n === 0) return []
  const byUrl = new Map(input.pages.map((page) => [page.url, page]))
  return metrics.pages.speed
    .filter((bucket) => bucket.pages.n > 0)
    .map((bucket) => {
      const questionIds = toIds(bucket.questions.ids)
      return {
        label: bucket.label,
        pages: book.add(`days:${bucket.id}:pages`, {
          title: `Pages live ${bucket.label}`,
          kind: 'pages',
          ids: bucket.pages.ids
        }),
        cited: book.add(`days:${bucket.id}:cited`, {
          title: `Pages live ${bucket.label}, cited now`,
          kind: 'pages',
          ids: bucket.citedPages.ids
        }),
        questions: book.add(`bucket:${bucket.id}`, {
          title: `Questions citing pages live ${bucket.label}`,
          kind: 'questions',
          ids: questionIds,
          sub: `${bucket.pages.n} ${plural(bucket.pages.n, 'page')} in this group, ${bucket.citedPages.n} cited now.`
        }),
        first: book.add(`days:${bucket.id}:first`, {
          title: `Pages live ${bucket.label}: you are the number-one source`,
          kind: 'questions',
          ids: firsts(input, questionIds)
        }),
        notIndexed: book.add(`days:${bucket.id}:noidx`, {
          title: `Pages live ${bucket.label}, not indexed`,
          kind: 'pages',
          ids: bucket.pages.ids.filter((url) => byUrl.get(url)?.indexed === false)
        })
      }
    })
}

function pageStats(input: ImpactInput): Record<string, PageStat> {
  const out: Record<string, PageStat> = {}
  for (const row of input.metrics.pages.rows) {
    const key = pageKey(row.url)
    const positions = (row.cited.after ?? row.cited.now).ids.flatMap((id) => {
      const metric = input.metrics.rows[id]
      return metric?.citedUrl !== null &&
        metric?.citedUrl !== undefined &&
        pageKey(metric.citedUrl) === key &&
        typeof metric.position === 'number'
        ? [metric.position]
        : []
    })
    out[row.url] = {
      first: positions.filter((value) => value === 1).length,
      avg:
        positions.length === 0
          ? null
          : Math.round((positions.reduce((sum, value) => sum + value, 0) / positions.length) * 10) /
            10
    }
  }
  return out
}

function methodLines(
  input: ImpactInput,
  published: readonly { liveSince: string | null }[]
): ImpactView['method'] {
  const { ctx, fromAt, fromLabel } = input
  const lives = published.flatMap((page) => (page.liveSince === null ? [] : [page.liveSince]))
  const firstLive = lives.length === 0 ? null : lives.reduce((min, at) => (at < min ? at : min))
  const twoChecks = input.metrics.checks.length >= 2 && input.metrics.comparison !== null
  let cleanBefore: ImpactView['method']['cleanBefore'] = null
  if (twoChecks && firstLive !== null && fromAt !== null && fromLabel !== null) {
    const ok = fromAt < firstLive
    cleanBefore = {
      ok,
      line: ok
        ? `A clean before: the From check (${fromLabel}) ran before the first fix went live (${ctx.day(firstLive)}), so the "before" numbers hold none of this work.`
        : `Not a clean before: the first fix went live on ${ctx.day(firstLive)}, before the From check (${fromLabel}). Some of the work is already in the "before" numbers, so the change shown is smaller than the real one. Pick an earlier From check if there is one.`
    }
  }
  return {
    cleanBefore,
    lines: [
      `"Named" means the answer's text mentions ${ctx.brand} by name, with or without a link. An answer can name you without citing a page of yours, and cite you without naming you.`,
      'Published pages come from your publishing records: each fix logged in CiteFox (Fixes, Log a fix) with its page, whether it is a new page or a rewrite, and its go-live date. The Google index state is the latest index check of each page.'
    ]
  }
}
