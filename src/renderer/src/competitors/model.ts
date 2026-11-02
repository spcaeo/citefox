import {
  COMPETITOR_PERIODS,
  isCompetitorPeriod,
  type CitedSiteRow,
  type CompetitorPeriod,
  type CompetitorsOverview
} from '@shared/ipc'
import {
  isSiteKind,
  kindTable,
  SITE_KIND_LABELS,
  SITE_KINDS,
  type KindTableRow,
  type SiteKind
} from '@shared/report/site-kinds'
import type { GridSortKey } from '@shared/domain'
import type { SiteGroup } from '../sites/siteRows'
import { marketLabel } from '../shell/model'
import type { KpiTrend } from '../ui'

/** View helpers for the Competitors screen. Pure. */

/** The share's market scope: "all markets" unless one is picked. */
export function marketScope(data: Pick<CompetitorsOverview, 'markets' | 'marketId'>): string {
  const market = data.markets.find((item) => item.id === data.marketId)
  return market === undefined ? 'all markets' : marketLabel(market)
}

/**
 * Route keys: `period`, `product`, `market`, `view` (`new`: new sites only), `kind` (the kind
 * of site filter), `q` (the list's search), `sort` (its sort), `site` (the open row).
 */
export const COMPETITORS_QUERY = [
  'period',
  'product',
  'market',
  'view',
  'kind',
  'q',
  'sort',
  'site'
] as const

export const DEFAULT_PERIOD: CompetitorPeriod = 30

/** The route's `period`, or the default for a missing or unknown value. */
export function periodFrom(value: string | null): CompetitorPeriod {
  const number = value === null ? Number.NaN : Number(value)
  return isCompetitorPeriod(number) ? number : DEFAULT_PERIOD
}

export const PERIOD_OPTIONS = COMPETITOR_PERIODS.map((days) => ({
  value: String(days),
  label: `${days} days`
}))

/** "38%", "<1%" for a share above zero that rounds to 0, "0%", or "—" when unknown. */
export function percent(share: number | null): string {
  if (share === null) return '—'
  if (share > 0 && share < 0.005) return '<1%'
  return `${Math.round(share * 100)}%`
}

/**
 * A share change in percentage points, as a KPI trend. Undefined when there is nothing
 * to compare. A competitor gaining share is bad news, so `upIsGood: false` turns the tone.
 */
export function shareTrend(
  change: number | null,
  days: number,
  upIsGood = true
): KpiTrend | undefined {
  if (change === null) return undefined
  const text = pointsText(change)
  if (text === null) return { direction: 'flat', text: `No change in ${days} d`, tone: 'neutral' }
  const good = change > 0 === upIsGood
  return {
    direction: change > 0 ? 'up' : 'down',
    text: `${text} in ${days} d`,
    tone: good ? 'ok' : 'bad'
  }
}

/** "+3 pts", "−0.5 pts", or null when the change rounds to zero. */
export function pointsText(change: number): string | null {
  const points = change * 100
  const rounded = Math.abs(points) >= 10 ? Math.round(points) : Math.round(points * 10) / 10
  if (rounded === 0) return null
  return `${rounded > 0 ? '+' : '−'}${Math.abs(rounded)} pts`
}

/**
 * The list's one grouping is the site type of "Who else the AI answers cite"
 * (audit2 #9): its rows and the list's Filter ▾ "Site type" are the same kinds,
 * with the same counts. `view=new` keeps only the sites first cited in this period.
 */
export function onlyNewFrom(value: string | null): boolean {
  return value === 'new'
}

/** Who a row is (its Type), from the shared site rules: `sites/siteRows.ts`. */
export type SiteGroupOf = (row: CitedSiteRow) => SiteGroup

/** The sites first cited in this period, when asked. The project's own row stays, to compare with. */
export function newSites(rows: readonly CitedSiteRow[], onlyNew: boolean): CitedSiteRow[] {
  return onlyNew ? rows.filter((row) => row.kind === 'you' || row.isNew) : [...rows]
}

/** Sites of each type, yours not counted (the same counts as the site type table). */
export function kindCounts(rows: readonly CitedSiteRow[]): ReadonlyMap<KindKey, number> {
  const counts = new Map<KindKey, number>()
  for (const row of rows) {
    if (row.kind === 'you') continue
    const kind = kindKeyOf(row)
    counts.set(kind, (counts.get(kind) ?? 0) + 1)
  }
  return counts
}

/** The list's sort as the route keeps it: `citations.desc`, several joined by commas. */
export function sortFrom(value: string | null): GridSortKey[] {
  if (value === null) return []
  const keys: GridSortKey[] = []
  for (const part of value.split(',')) {
    const [key, dir] = part.split('.')
    if (key && /^[a-z]+$/.test(key) && (dir === 'asc' || dir === 'desc')) keys.push({ key, dir })
  }
  return keys
}

/** The route's `sort` for a list sort; null for the default (most citations first). */
export function sortParam(sort: readonly GridSortKey[]): string | null {
  const text = sort.map((item) => `${item.key}.${item.dir}`).join(',')
  return text === '' || text === DEFAULT_SORT_PARAM ? null : text
}

export const DEFAULT_SORT: readonly GridSortKey[] = [{ key: 'citations', dir: 'desc' }]
const DEFAULT_SORT_PARAM = 'citations.desc'

/** The saved competitor with the largest share, or null when none is cited. */
export function topCompetitor(rows: readonly CitedSiteRow[]): CitedSiteRow | null {
  let best: CitedSiteRow | null = null
  for (const row of rows) {
    if (row.kind !== 'competitor' || row.citations === 0) continue
    if (best === null || row.citations > best.citations) best = row
  }
  return best
}

export function kindLabel(row: CitedSiteRow): string {
  if (row.kind === 'you') return 'You'
  if (row.kind === 'other') return 'Not a saved competitor'
  if (row.tier === 'direct') return 'Direct competitor'
  if (row.tier === 'partial') return 'Partial competitor'
  return 'Competitor'
}

/** The widest share in the list, so the bars use the space (the leader fills its track). */
export function barScale(rows: readonly CitedSiteRow[]): number {
  return rows.reduce((top, row) => Math.max(top, row.share ?? 0), 0)
}

/** The full address for a host, for the copy and open icons. */
export function siteUrl(domain: string): string {
  return `https://${domain}/`
}

/**
 * A site type in "Who else the AI answers cite", or `pending`: the sites no list
 * and no AI has sorted yet ("Not sorted yet").
 */
export type KindKey = SiteKind | 'pending'

export const PENDING_LABEL = 'Not sorted yet'

/** A row's site type, `pending` while nothing has sorted its domain. */
export function kindKeyOf(row: CitedSiteRow): KindKey {
  return row.siteKindPending === true ? 'pending' : (row.siteKind ?? 'other')
}

export function kindKeyLabel(kind: KindKey): string {
  return kind === 'pending' ? PENDING_LABEL : SITE_KIND_LABELS[kind]
}

/** The route's `kind`, or null for every type. */
export function kindFrom(value: string | null): KindKey | null {
  return value === 'pending' || isSiteKind(value) ? value : null
}

/** The site type filter: every type, then one option per type. */
export const KIND_OPTIONS: readonly { value: KindKey | ''; label: string }[] = [
  { value: '', label: 'Every site type' },
  ...SITE_KINDS.map((kind) => ({ value: kind, label: SITE_KIND_LABELS[kind] })),
  { value: 'pending', label: PENDING_LABEL }
]

/** Rows of one site type. The project's own row stays, to compare with. */
export function filterByKind(rows: readonly CitedSiteRow[], kind: KindKey | null): CitedSiteRow[] {
  if (kind === null) return [...rows]
  return rows.filter((row) => row.kind === 'you' || kindKeyOf(row) === kind)
}

export interface KindRow extends Omit<KindTableRow, 'kind'> {
  kind: KindKey
}

/**
 * "Who else the AI answers cite": the cited sites other than yours by type, with their
 * citations as of the period start (`startCitations`) and now. The sites not sorted
 * yet come last, as their own row.
 */
export function kindRows(rows: readonly CitedSiteRow[]): KindRow[] {
  const others = rows.filter((row) => row.kind !== 'you')
  const site = (row: CitedSiteRow): { kind: SiteKind; before: number | null; now: number } => ({
    kind: row.siteKind ?? 'other',
    before: row.startCitations,
    now: row.citations
  })
  const sorted: KindRow[] = kindTable(others.filter((row) => !row.siteKindPending).map(site))
  const pending = kindTable(others.filter((row) => row.siteKindPending === true).map(site)).map(
    (row): KindRow => ({ ...row, kind: 'pending', label: PENDING_LABEL })
  )
  return [...sorted, ...pending]
}

/** "+3", "−2" or "0". */
export function countChange(change: number): string {
  if (change === 0) return '0'
  return `${change > 0 ? '+' : '−'}${Math.abs(change)}`
}
