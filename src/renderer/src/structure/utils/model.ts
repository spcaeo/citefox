import type {
  ClusterPageRow,
  ClusterRole,
  ClusterSummary,
  PageStatus,
  SitemapRecord,
  SitemapSyncReport
} from '@shared/domain'
import { pluralize } from '@shared/pluralize'
import { formatClock, formatDay } from '../../utils/dates'
import type { SortSpec } from '../../utils/sort'
import type {
  ClusterFilter,
  ClusterPageSort,
  ClusterSort,
  ClusterTracking,
  MarketChoice,
  RoleFilter,
  SitemapSort
} from '../types'

const ROLE_ORDER: Readonly<Record<ClusterRole, number>> = { pillar: 0, supporting: 1, orphan: 2 }

export function count(value: number): string {
  return value.toLocaleString('en-US')
}

/** "Oct 19, 09:00" in local time, or an em dash. */
export function dayTime(iso: string | null): string {
  if (!iso) return '—'
  return `${formatDay(iso, { year: false })}, ${formatClock(iso)}`
}

/** A sitemap `lastmod` may be a bare date; show it as written in the user's calendar. */
export function lastmodDay(value: string | null): string {
  if (!value) return '—'
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00Z` : value
  return formatDay(iso)
}

export function isTrackedStatus(status: PageStatus | null): boolean {
  return status === 'tracked' || status === 'setting_up' || status === 'paused'
}

/** Path and query of a page URL, like `/blog/10dlc-registration-guide/`. */
export function pagePath(url: string): string {
  try {
    const parsed = new URL(url)
    return `${parsed.pathname}${parsed.search}`
  } catch {
    return url
  }
}

/** The file part of a sitemap URL, like `post-sitemap.xml`. */
export function sitemapFile(url: string): string {
  try {
    const parsed = new URL(url)
    const parts = parsed.pathname.split('/').filter((part) => part.length > 0)
    return parts.at(-1) ?? parsed.host
  } catch {
    return url
  }
}

export function sitemapStatus(record: SitemapRecord): string {
  if (record.state === 'error') return record.error ?? 'Could not be read'
  if (!record.included) return record.lowValue ? 'Usually low-value' : 'Left out by you'
  if (record.state === 'pending') return 'Read on the next sync'
  if (record.kind === 'index') return `Lists ${pluralize(record.pageCount, 'sitemap')}`
  return `Read ${dayTime(record.lastReadAt)}`
}

export function sitemapUrlCount(record: SitemapRecord): string {
  if (record.kind === 'index') return 'index'
  if (record.state === 'pending') return '—'
  return count(record.pageCount)
}

export interface SitemapRow {
  record: SitemapRecord
  depth: number
}

function sitemapValue(record: SitemapRecord, key: SitemapSort['key']): string | number | null {
  switch (key) {
    case 'file':
      return sitemapFile(record.url).toLowerCase()
    case 'urls':
      return record.kind === 'index' ? null : record.pageCount
    case 'changed':
      return record.lastChangedAt
    case 'status':
      return sitemapStatus(record).toLowerCase()
  }
}

/** Multi-key sort; empty values last; ties keep the original order. */
export function multiSort<T, K extends string>(
  rows: readonly T[],
  sorts: readonly SortSpec<K>[],
  value: (row: T, key: K) => string | number | null
): T[] {
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      for (const sort of sorts) {
        const left = value(a.row, sort.key)
        const right = value(b.row, sort.key)
        if (left === null && right === null) continue
        if (left === null) return 1
        if (right === null) return -1
        const diff =
          typeof left === 'string' && typeof right === 'string'
            ? left.localeCompare(right)
            : Number(left) - Number(right)
        if (diff !== 0) return sort.dir === 'desc' ? -diff : diff
      }
      return a.index - b.index
    })
    .map((item) => item.row)
}

/** Index sitemaps first; the sitemaps an index lists sort below it, indented. */
export function orderSitemaps(
  records: readonly SitemapRecord[],
  sorts: readonly SitemapSort[]
): SitemapRow[] {
  const ids = new Set(records.map((record) => record.id))
  const top = records.filter((record) => record.parentId === null || !ids.has(record.parentId))
  const indexes = top.filter((record) => record.kind === 'index')
  const others = multiSort(
    top.filter((record) => record.kind !== 'index'),
    sorts,
    sitemapValue
  )
  const rows: SitemapRow[] = []
  for (const index of indexes) {
    rows.push({ record: index, depth: 0 })
    const children = records.filter((record) => record.parentId === index.id)
    for (const child of multiSort(children, sorts, sitemapValue)) {
      rows.push({ record: child, depth: 1 })
    }
  }
  for (const record of others) rows.push({ record, depth: 0 })
  return rows
}

/** "1,234 pages from 5 sitemaps": included page sitemaps that were read. */
export function sitemapTotal(records: readonly SitemapRecord[]): string {
  const read = records.filter(
    (record) => record.included && record.kind === 'urlset' && record.state === 'read'
  )
  const pages = read.reduce((sum, record) => sum + record.pageCount, 0)
  return `${pluralize(pages, 'page')} from ${pluralize(read.length, 'sitemap')}`
}

export function syncCounts(report: SitemapSyncReport): string {
  return `${count(report.newCount)} new · ${count(report.removedCount)} removed · ${count(report.changedCount)} changed`
}

export function clusterTracking(cluster: ClusterSummary): ClusterTracking {
  if (cluster.trackWhole) return 'whole'
  return cluster.trackedCount > 0 ? 'some' : 'none'
}

export const TRACKING_LABELS: Readonly<Record<ClusterTracking, string>> = {
  whole: 'Whole cluster',
  some: 'Some pages',
  none: 'No pages'
}

function clusterMatchesQuery(cluster: ClusterSummary, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (needle.length === 0) return true
  const haystack = [
    cluster.name,
    cluster.pillarTitle ?? '',
    cluster.pillarUrl ?? '',
    ...cluster.themes
  ]
    .join('\n')
    .toLowerCase()
  return haystack.includes(needle)
}

export function clusterMatches(
  cluster: ClusterSummary,
  query: string,
  filter: ClusterFilter,
  skip?: keyof ClusterFilter
): boolean {
  if (!clusterMatchesQuery(cluster, query)) return false
  if (skip !== 'tracking' && filter.tracking.length > 0) {
    if (!filter.tracking.includes(clusterTracking(cluster))) return false
  }
  if (skip !== 'madeBy' && filter.madeBy.length > 0) {
    if (!filter.madeBy.includes(cluster.madeBy)) return false
  }
  return true
}

export function filterClusters(
  clusters: readonly ClusterSummary[],
  query: string,
  filter: ClusterFilter
): ClusterSummary[] {
  return clusters.filter((cluster) => clusterMatches(cluster, query, filter))
}

export function sortClusters(
  clusters: readonly ClusterSummary[],
  sorts: readonly ClusterSort[]
): ClusterSummary[] {
  return multiSort(clusters, sorts, (cluster, key) => {
    switch (key) {
      case 'name':
        return cluster.name.toLowerCase()
      case 'pages':
        return cluster.pageCount
      case 'tracked':
        return cluster.trackedCount
      case 'score':
        return cluster.averageScore
    }
  })
}

export function roleCounts(pages: readonly ClusterPageRow[]): Record<ClusterRole, number> {
  const counts: Record<ClusterRole, number> = { pillar: 0, supporting: 0, orphan: 0 }
  for (const page of pages) counts[page.role] += 1
  return counts
}

export function sortClusterPages(
  pages: readonly ClusterPageRow[],
  role: RoleFilter,
  sorts: readonly ClusterPageSort[]
): ClusterPageRow[] {
  const shown = role === 'all' ? pages : pages.filter((page) => page.role === role)
  return multiSort(shown, sorts, (page, key) => {
    switch (key) {
      case 'page':
        return (page.title ?? pagePath(page.url)).toLowerCase()
      case 'role':
        return ROLE_ORDER[page.role]
      case 'score':
        return page.score
      case 'tracked':
        return isTrackedStatus(page.status) ? 0 : 1
    }
  })
}

export function scoreChangeLabel(change: number | null): string | null {
  if (change === null) return null
  if (change === 0) return 'No change'
  return change > 0 ? `+${change}` : String(change)
}

/** "🇺🇸 US · EN + 🇬🇧 UK · EN", falling back to a count for markets without a label. */
export function marketsLabel(ids: readonly string[], choices: readonly MarketChoice[]): string {
  if (ids.length === 0) return 'No markets'
  const labels = ids.map((id) => choices.find((choice) => choice.id === id)?.label ?? null)
  if (labels.every((label) => label !== null)) return labels.join(' + ')
  return pluralize(ids.length, 'market')
}

/** The `<select>` value for a silo's markets. */
export function siloMarketValue(marketIds: readonly string[] | null): string {
  return marketIds === null ? 'inherit' : marketIds.join(',')
}

export function parseSiloMarketValue(value: string): string[] | null {
  if (value === 'inherit') return null
  return value.split(',').filter((id) => id.length > 0)
}
