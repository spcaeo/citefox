import type { Market, ProjectSchedule, ProjectScoreSummary, ProjectUsageRow } from '@shared/domain'
import type { ProjectDetail } from '@shared/ipc'
import { marketLabel } from '../../../shell/model'
import { projectKind, projectStatusWord } from '../../listModel'

/** Everything one row of the Projects table or one card reads (FR-10.5). */
export interface ProjectRow {
  project: ProjectDetail
  score: ProjectScoreSummary | undefined
  schedule: ProjectSchedule | undefined
  usage: ProjectUsageRow | undefined
}

export const PROJECT_SORT_KEYS = [
  'name',
  'domain',
  'kind',
  'tracked',
  'score',
  'change',
  'markets',
  'next',
  'searches',
  'status'
] as const

export type ProjectColumn = (typeof PROJECT_SORT_KEYS)[number]

export interface ProjectSort {
  key: ProjectColumn
  dir: 'asc' | 'desc'
}

export const PROJECT_COLUMN_LABELS: Readonly<Record<ProjectColumn, string>> = {
  name: 'Project',
  domain: 'Domain',
  kind: 'Kind',
  tracked: 'Tracked',
  score: 'Avg score',
  change: 'Change',
  markets: 'Markets',
  next: 'Schedule',
  searches: 'Searches used / cap',
  status: 'Status'
}

/** Every market of the project, default first; the profile's default when the list is absent. */
export function projectMarkets(
  project: Pick<ProjectDetail, 'markets' | 'defaultMarket'>
): Market[] {
  if (project.markets !== undefined && project.markets.length > 0) return [...project.markets]
  return project.defaultMarket ? [project.defaultMarket] : []
}

export function projectMarketLabels(
  project: Pick<ProjectDetail, 'markets' | 'defaultMarket'>
): string[] {
  return projectMarkets(project).map((market) => marketLabel(market))
}

/** Searches this month: the score summary, or the usage report before scores load. */
export function rowSearches(row: ProjectRow): { used: number; cap: number | null } {
  // Scores are the numbers Results shows (NFR-14); the usage report is the same key_usage
  // source and fills in before scores load.
  if (row.score) return { used: row.score.searchesUsed, cap: row.score.searchCap }
  return { used: row.usage?.searches ?? 0, cap: row.usage?.cap ?? null }
}

/**
 * Null-last comparison: a project with no score, change, or next check sorts after
 * every project that has one, in both directions.
 */
function compareNullable(a: number | string | null, b: number | string | null): number | null {
  if (a === null && b === null) return 0
  if (a === null) return null
  if (b === null) return null
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return String(a).localeCompare(String(b))
}

/** The value a column sorts by. Null sorts last in either direction. */
export function projectSortValue(row: ProjectRow, key: ProjectColumn): number | string | null {
  const project = row.project
  switch (key) {
    case 'name':
      return project.name.toLowerCase()
    case 'domain':
      return project.domain
    case 'kind':
      return projectKind(project)
    case 'tracked':
      return project.trackedPageCount
    case 'score':
      return row.score?.averageScore ?? null
    case 'change':
      return row.score?.change ?? null
    case 'markets':
      return projectMarkets(project).length
    case 'next':
      return row.schedule?.nextCheckAt ?? row.score?.nextCheckAt ?? null
    case 'searches':
      return rowSearches(row).used
    case 'status':
      return projectStatusWord(project.status)
  }
}

/**
 * Sorts by each key in turn (Shift-click adds a second key). Missing values go last.
 * Ties keep the list order, so sorting never reshuffles equal rows.
 */
export function sortProjectRows(
  rows: readonly ProjectRow[],
  sorts: readonly ProjectSort[]
): ProjectRow[] {
  const indexed = rows.map((row, index) => ({ row, index }))
  indexed.sort((a, b) => {
    for (const sort of sorts) {
      const left = projectSortValue(a.row, sort.key)
      const right = projectSortValue(b.row, sort.key)
      const compared = compareNullable(left, right)
      if (compared === null) return left === null ? 1 : -1
      if (compared !== 0) return sort.dir === 'desc' ? -compared : compared
    }
    return a.index - b.index
  })
  return indexed.map((item) => item.row)
}

/**
 * Header click: the same key flips direction, another key replaces the sort.
 * Shift adds the key as the next sort, or flips it when it is already there.
 */
export function nextSorts(
  current: readonly ProjectSort[],
  key: ProjectColumn,
  additive: boolean
): ProjectSort[] {
  const existing = current.find((sort) => sort.key === key)
  const flipped: ProjectSort = {
    key,
    dir: existing ? (existing.dir === 'asc' ? 'desc' : 'asc') : 'asc'
  }
  if (!additive) return [flipped]
  if (existing) return current.map((sort) => (sort.key === key ? flipped : sort))
  return [...current, flipped]
}

export function ariaSort(
  sorts: readonly ProjectSort[],
  key: ProjectColumn
): 'ascending' | 'descending' | 'none' {
  const found = sorts.find((sort) => sort.key === key)
  if (!found) return 'none'
  return found.dir === 'asc' ? 'ascending' : 'descending'
}

/** Accessible name of a header sort button. */
export function sortButtonLabel(sorts: readonly ProjectSort[], key: ProjectColumn): string {
  const state = ariaSort(sorts, key)
  const label = PROJECT_COLUMN_LABELS[key]
  if (state === 'none') return `Sort by ${label}`
  return `${label}, sorted ${state}. Click to reverse; Shift-click adds a second sort`
}
