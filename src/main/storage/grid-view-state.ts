import {
  GRID_STATE_JSON_MAX,
  GRID_WIDTH_MAX,
  GRID_WIDTH_MIN,
  isGridDensity,
  isGridPageSize,
  isGridViewMode,
  type GridRange,
  type GridSortKey,
  type GridViewState
} from '@shared/domain'

const KEY = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/
const MAX_KEYS = 64
const MAX_VALUES = 500
const MAX_VALUE_LENGTH = 300
const MAX_SEARCH = 300
const MAX_SORTS = 8

/**
 * FR-21.2. Checks a saved view's state field by field and returns a clean copy,
 * or null when any part is the wrong shape. Unknown fields are not kept.
 */
export function normalizeGridViewState(value: unknown): GridViewState | null {
  const record = plain(value)
  if (record === null) return null
  const search = record.search
  if (typeof search !== 'string' || search.length > MAX_SEARCH) return null
  const filters = readFilters(record.filters)
  const ranges = readRanges(record.ranges)
  const sort = readSort(record.sort)
  const hidden = readKeyList(record.hidden)
  const widths = readWidths(record.widths)
  const density = record.density
  const view = record.view
  const pageSize = record.pageSize
  if (filters === null || ranges === null || sort === null || hidden === null || widths === null) {
    return null
  }
  if (typeof density !== 'string' || !isGridDensity(density)) return null
  if (typeof view !== 'string' || !isGridViewMode(view)) return null
  if (!isGridPageSize(pageSize)) return null
  const groupBy = readNullableKey(record.groupBy)
  const treeBy = readNullableKey(record.treeBy)
  if (groupBy === undefined || treeBy === undefined) return null
  const state: GridViewState = {
    search,
    filters,
    ranges,
    sort,
    hidden,
    widths,
    density,
    view,
    groupBy,
    treeBy,
    pageSize
  }
  if (JSON.stringify(state).length > GRID_STATE_JSON_MAX) return null
  return state
}

function plain(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function entries(value: unknown): [string, unknown][] | null {
  const record = plain(value)
  if (record === null) return null
  const list = Object.entries(record)
  if (list.length > MAX_KEYS) return null
  if (list.some(([key]) => !KEY.test(key))) return null
  return list
}

function readFilters(value: unknown): Record<string, readonly string[]> | null {
  const list = entries(value)
  if (list === null) return null
  const result: Record<string, readonly string[]> = {}
  for (const [key, raw] of list) {
    if (!Array.isArray(raw) || raw.length > MAX_VALUES) return null
    const values: string[] = []
    for (const item of raw) {
      if (typeof item !== 'string' || item.length > MAX_VALUE_LENGTH) return null
      if (!values.includes(item)) values.push(item)
    }
    if (values.length > 0) result[key] = values
  }
  return result
}

function readRanges(value: unknown): Record<string, GridRange> | null {
  const list = entries(value)
  if (list === null) return null
  const result: Record<string, GridRange> = {}
  for (const [key, raw] of list) {
    const range = plain(raw)
    if (range === null) return null
    const min = readBound(range.min)
    const below = readBound(range.below)
    if (min === undefined || below === undefined) return null
    if (min !== null || below !== null) result[key] = { min, below }
  }
  return result
}

function readBound(value: unknown): number | null | undefined {
  if (value === null) return null
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return value
}

function readSort(value: unknown): GridSortKey[] | null {
  if (!Array.isArray(value) || value.length > MAX_SORTS) return null
  const result: GridSortKey[] = []
  for (const raw of value) {
    const item = plain(raw)
    if (item === null) return null
    const key = item.key
    const dir = item.dir
    if (typeof key !== 'string' || !KEY.test(key)) return null
    if (dir !== 'asc' && dir !== 'desc') return null
    if (result.some((existing) => existing.key === key)) return null
    result.push({ key, dir })
  }
  return result
}

function readKeyList(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > MAX_KEYS) return null
  const result: string[] = []
  for (const item of value) {
    if (typeof item !== 'string' || !KEY.test(item)) return null
    if (!result.includes(item)) result.push(item)
  }
  return result
}

function readWidths(value: unknown): Record<string, number> | null {
  const list = entries(value)
  if (list === null) return null
  const result: Record<string, number> = {}
  for (const [key, raw] of list) {
    if (typeof raw !== 'number' || !Number.isFinite(raw)) return null
    result[key] = Math.min(GRID_WIDTH_MAX, Math.max(GRID_WIDTH_MIN, Math.round(raw)))
  }
  return result
}

function readNullableKey(value: unknown): string | null | undefined {
  if (value === null) return null
  if (typeof value !== 'string' || !KEY.test(value)) return undefined
  return value
}
