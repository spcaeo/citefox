import type { GridViewState, Market } from '@shared/domain'
import type { AllPageRow } from '@shared/ipc'
import type { GridPreset } from '../../grid'
import { marketLabel } from '../../shell/model'
import { isPagesView } from '../../shell/routes'
import { folderLabel } from './format'

/** Same as `AllPagesData.trackedPageCount`: set up, tracked, or paused. */
export const WORKING_STATUSES = ['setting_up', 'tracked', 'paused'] as const
/** Found pages that are not tracked: `foundPageCount − trackedPageCount`. */
export const NOT_WORKING_STATUSES = ['not_tracked', 'removed'] as const

/**
 * "Next check" facet: due by today (overdue included), within the next 7 days, later,
 * or not scheduled. "Due soon" is today plus the week.
 */
export type DueBucket = 'today' | 'week' | 'later' | 'none'

/** Days ahead "Due soon" covers. */
export const DUE_SOON_DAYS = 7

export function dueBucket(row: Pick<AllPageRow, 'nextCheckAt'>, now: Date): DueBucket {
  if (row.nextCheckAt === null) return 'none'
  const at = new Date(row.nextCheckAt)
  if (Number.isNaN(at.getTime())) return 'none'
  const endOfToday = new Date(now)
  endOfToday.setHours(23, 59, 59, 999)
  if (at.getTime() <= endOfToday.getTime()) return 'today'
  const endOfWeek = new Date(endOfToday)
  endOfWeek.setDate(endOfWeek.getDate() + DUE_SOON_DAYS)
  return at.getTime() <= endOfWeek.getTime() ? 'week' : 'later'
}

/** Views that `#/pages?preset=` names and that are not one of the grid's presets. */
const LINK_VIEWS: Readonly<Record<string, { label: string; state: Partial<GridViewState> }>> = {
  tracked: {
    label: 'Tracked, setting up or paused',
    state: { filters: { status: [...WORKING_STATUSES] }, sort: [{ key: 'score', dir: 'desc' }] }
  },
  untracked: {
    label: 'Found, not tracked',
    state: { filters: { status: [...NOT_WORKING_STATUSES] }, sort: [{ key: 'page', dir: 'asc' }] }
  },
  today: {
    label: 'Due today',
    state: { filters: { next: ['today'] }, sort: [{ key: 'next', dir: 'asc' }] }
  },
  unlogged: {
    label: 'Changed, not logged',
    state: { filters: { unlogged: ['yes'] }, sort: [{ key: 'unlogged', dir: 'desc' }] }
  },
  stale: {
    label: 'Not updated in 12 months',
    state: { filters: { updated: ['stale'] }, sort: [{ key: 'updated', dir: 'asc' }] }
  }
}

/** Strips slashes so `/blog/`, `blog/` and `blog` name the same folder. `/` is the top level. */
export function folderKey(value: string): string {
  return value.replace(/^\/+|\/+$/g, '')
}

/** The deep-link values that filter the grid, besides the preset. */
const FILTER_KEYS = ['folder', 'cluster', 'group', 'market'] as const

/**
 * The grid preset a link names: `preset`, or an old link's `view` that is not
 * a screen view (`#/pages?view=tracked` from before the Tree view).
 */
export function presetParam(params: Readonly<Record<string, string>> | undefined): string | null {
  if (!params) return null
  if (params.preset) return params.preset
  return params.view && !isPagesView(params.view) ? params.view : null
}

/**
 * The grid presets for a deep link (`pagesHash`). The linked view comes first,
 * so the grid opens on it, and "All pages" stays in the list to clear it.
 * `preset` is a preset id or `tracked` / `untracked` / `today`; `folder`,
 * `cluster` (id), `group` (id) and `market` (id) add filters.
 */
export function linkedPresets(
  presets: readonly GridPreset[],
  params: Readonly<Record<string, string>> | undefined,
  rows: readonly AllPageRow[],
  markets: ReadonlyMap<string, Market>
): readonly GridPreset[] {
  const linked = linkedPreset(presets, params, rows, markets)
  if (linked === null) return presets
  return [linked, ...presets.filter((preset) => preset.id !== linked.id)]
}

function linkedPreset(
  presets: readonly GridPreset[],
  params: Readonly<Record<string, string>> | undefined,
  rows: readonly AllPageRow[],
  markets: ReadonlyMap<string, Market>
): GridPreset | null {
  if (!params) return null
  const view = presetParam(params)
  // `tracked` and `untracked` count like the tiles (set up and paused pages are tracked),
  // so they win over the grid presets of the same name.
  const named = view === null ? undefined : LINK_VIEWS[view]
  const existing = view === null || named ? undefined : presets.find((preset) => preset.id === view)
  const labels: string[] = []
  const filters: Record<string, readonly string[]> = {}
  let sort: GridViewState['sort'] | undefined
  if (existing) {
    if (!hasExtra(params)) return existing
    labels.push(existing.label)
    Object.assign(filters, existing.state.filters ?? {})
    sort = existing.state.sort
  } else if (named) {
    labels.push(named.label)
    Object.assign(filters, named.state.filters ?? {})
    sort = named.state.sort
  }
  if (params.folder !== undefined) {
    const key = folderKey(params.folder)
    filters.folder = [key]
    labels.push(`Folder ${folderLabel(key)}`)
  }
  const cluster = params.cluster ? membershipName(rows, 'clusters', params.cluster) : null
  if (cluster !== null) {
    filters.cluster = [cluster]
    labels.push(`Cluster: ${cluster}`)
  }
  const group = params.group ? membershipName(rows, 'groups', params.group) : null
  if (group !== null) {
    filters.group = [group]
    labels.push(`Group: ${group}`)
  }
  if (params.market) {
    const market = markets.get(params.market)
    filters.markets = [params.market]
    labels.push(`Market ${market ? marketLabel(market) : params.market}`)
  }
  if (labels.length === 0) return null
  const linkKeys = [...(view === null ? [] : [`preset=${view}`])].concat(
    FILTER_KEYS.filter((key) => params[key] !== undefined).map((key) => `${key}=${params[key]}`)
  )
  return {
    id: `link:${linkKeys.join('&')}`,
    label: labels.join(' · '),
    state: { filters, ...(sort ? { sort } : {}) }
  }
}

function hasExtra(params: Readonly<Record<string, string>>): boolean {
  return FILTER_KEYS.some((key) => params[key] !== undefined)
}

/** The name a cluster or group id has in the rows (the grid filters memberships by name). */
function membershipName(
  rows: readonly AllPageRow[],
  field: 'clusters' | 'groups',
  id: string
): string | null {
  for (const row of rows) {
    const found = row[field]?.find((item) => item.id === id)
    if (found) return found.name
  }
  return null
}
