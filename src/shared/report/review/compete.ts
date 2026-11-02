import { cleanHost } from '../../competitor-hosts'
import { isCitedRow } from '../../metrics/counts'
import type { DomainRow, MetricRow } from '../../metrics/types'
import { builtInSiteKind, kindTable, SITE_KIND_LABELS, type SiteKind } from '../site-kinds'
import type { CompetitionView, SiteKindRow, ShareOfVoice, SiteRow } from './compete-types'
import type { ReportExtras } from './extras'
import { plural } from './items'
import type { SectionInput } from './sections'
import type { CompetitorsView, Num, SiteItem, Tile } from './types'

/**
 * The Competitors tab of every ready report (Docs/REPORT-SPEC.md "Competitors"). Every
 * count reads the same questions as the ranking: the questions compared at both ends
 * when comparing, else every question of the check. So a site's "with you" and "gap"
 * add up to its "now", and the share of voice adds up to the answers shown.
 */

export interface CompeteInput extends SectionInput {
  extras: Pick<ReportExtras, 'siteKinds'>
}

/** A cited site's kind: CiteFox's sort first, then the built-in list, else neutral. */
export function siteKindFor(
  domain: string,
  kinds: Readonly<Record<string, SiteKind>> = {}
): SiteKind {
  return kinds[domain] ?? kinds[cleanHost(domain)] ?? builtInSiteKind(domain) ?? 'other'
}

export function competitionView(
  input: CompeteInput,
  competitors: CompetitorsView
): CompetitionView {
  const { metrics, book } = input
  const kinds = input.extras.siteKinds ?? {}
  const comparing = metrics.comparison !== null
  const domainRows = new Map(metrics.domains.map((row) => [row.domain, row]))
  const ids = (num: Num): readonly string[] => book.drills[num.drill]?.ids ?? []
  const rowOf = (id: string): MetricRow | undefined => metrics.rows[id]

  const ordered = [...competitors.all].sort(
    (a, b) => b.now - a.now || Number(b.own) - Number(a.own) || a.domain.localeCompare(b.domain)
  )
  const sites: SiteRow[] = ordered.map((site, index) =>
    siteRow(input, site, index + 1, domainRows.get(site.domain), kinds, comparing, ids, rowOf)
  )
  const own = sites.find((site) => site.own) ?? null
  const rivals = sites.filter((site) => !site.own && site.now.n > 0)
  const rival = rivals[0] ?? null

  const gapIds = new Set<string>()
  for (const site of rivals) for (const id of site.gap === null ? [] : ids(site.gap)) gapIds.add(id)
  const gap = book.add('cmp:gap', {
    title: 'Answers that cite other sites but not you',
    kind: 'questions',
    ids: [...gapIds],
    sub: 'Each one is a question you could win.'
  })

  const tiles: Tile[] =
    rival === null
      ? []
      : [
          { label: 'Other sites cited', value: rivals.length.toLocaleString('en-US'), drill: null },
          {
            label: 'Your reach',
            value: (own?.now.n ?? 0).toLocaleString('en-US'),
            drill: own === null || own.now.n === 0 ? null : own.now.drill,
            tone: 'ok'
          },
          {
            label: `Most-cited rival, ${rival.now.n} ${plural(rival.now.n, 'question')}`,
            value: rival.domain,
            drill: rival.now.drill
          },
          {
            label: 'Their lead, in questions',
            value: signed(rival.now.n - (own?.now.n ?? 0)),
            drill: null,
            tone: rival.now.n > (own?.now.n ?? 0) ? 'warn' : 'neutral'
          },
          {
            label: 'Gap questions',
            value: gap.n.toLocaleString('en-US'),
            drill: gap.n === 0 ? null : gap.drill,
            tone: gap.n > 0 ? 'warn' : 'neutral'
          }
        ]

  const others = sites.filter((site) => !site.own && site.kind !== null)
  const kindRows: SiteKindRow[] = kindTable(
    others.map((site) => ({
      kind: site.kind as SiteKind,
      before: site.before === null ? (comparing ? 0 : null) : site.before.n,
      now: site.now.n
    }))
  ).map((row) => {
    const union = new Set<string>()
    for (const site of others) {
      if (site.kind === row.kind) for (const id of ids(site.now)) union.add(id)
    }
    return {
      ...row,
      questions: book.add(`kind:${row.kind}`, {
        title: `Questions citing ${row.label.toLowerCase()} sites, ${input.toLabel}`,
        kind: 'questions',
        ids: [...union]
      })
    }
  })

  return {
    tiles,
    kinds: kindRows,
    sites,
    sov: shareOfVoice(input, kinds),
    namedCompetitors: others.filter((site) => site.kind === 'competitors' && site.now.n > 0).length
  }
}

function siteRow(
  input: CompeteInput,
  site: SiteItem,
  rank: number,
  row: DomainRow | undefined,
  kinds: Readonly<Record<string, SiteKind>>,
  comparing: boolean,
  ids: (num: Num) => readonly string[],
  rowOf: (id: string) => MetricRow | undefined
): SiteRow {
  const now: Num = { n: site.now, drill: site.nowDrill }
  const before: Num | null =
    site.beforeDrill === null ? null : { n: site.before ?? 0, drill: site.beforeDrill }
  const position = row?.position ?? { now: null, before: null, after: null }
  const base = {
    rank,
    domain: site.domain,
    own: site.own,
    before,
    now,
    change: before === null ? null : now.n - before.n,
    positionBefore: position.before,
    positionNow: comparing ? position.after : position.now
  }
  if (site.own) return { ...base, kind: null, kindLabel: 'You', withYou: null, gap: null }
  const kind = siteKindFor(site.domain, kinds)
  const list = ids(now)
  const cited = list.filter((id) => {
    const metric = rowOf(id)
    return metric !== undefined && isCitedRow(metric)
  })
  const citedSet = new Set(cited)
  const withYou = input.book.add(`dom:${site.domain}:with`, {
    title: `${site.domain} and you in the same answer, ${input.toLabel}`,
    kind: 'questions',
    ids: cited
  })
  const gap = input.book.add(`dom:${site.domain}:gap`, {
    title: `Answers citing ${site.domain} but not you, ${input.toLabel}`,
    kind: 'questions',
    ids: list.filter((id) => !citedSet.has(id))
  })
  return { ...base, kind, kindLabel: SITE_KIND_LABELS[kind], withYou, gap }
}

function signed(value: number): string {
  if (value > 0) return `+${value}`
  if (value < 0) return `−${Math.abs(value)}`
  return '0'
}

/**
 * Share of voice (the Full report's rule, src/main/export/model/competition.ts): each
 * answer shown goes to you when it cites you, else to a named competitor when it cites
 * one, else to other sites, else to "no site cited".
 */
function shareOfVoice(
  input: CompeteInput,
  kinds: Readonly<Record<string, SiteKind>>
): ShareOfVoice | null {
  const { metrics, book } = input
  const side = metrics.comparison?.after ?? metrics.now
  if (side.answered.n === 0) return null
  const you: string[] = []
  const competitor: string[] = []
  const others: string[] = []
  const none: string[] = []
  for (const id of side.answered.ids) {
    const row = metrics.rows[id]
    if (row === undefined) continue
    if (isCitedRow(row)) you.push(id)
    else if (row.domains.length === 0) none.push(id)
    else if (row.domains.some((domain) => siteKindFor(cleanHost(domain), kinds) === 'competitors'))
      competitor.push(id)
    else others.push(id)
  }
  const day = input.toLabel
  return {
    total: book.add('sov:all', {
      title: `Every AI answer shown, ${day}`,
      kind: 'questions',
      ids: [...side.answered.ids]
    }),
    you: book.add('sov:you', {
      title: `Answers citing your pages, ${day}`,
      kind: 'questions',
      ids: you
    }),
    competitor: book.add('sov:competitor', {
      title: `Answers citing a named competitor, not you, ${day}`,
      kind: 'questions',
      ids: competitor
    }),
    others: book.add('sov:others', {
      title: `Answers citing other sites only, ${day}`,
      kind: 'questions',
      ids: others
    }),
    none: book.add('sov:none', {
      title: `Answers citing no site, ${day}`,
      kind: 'questions',
      ids: none
    })
  }
}
