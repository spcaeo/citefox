import type { SortSpec } from '../utils/sort'
import type { PageStatus, PageSummary } from '@shared/domain'

export const PAGE_SORT_KEYS = [
  'title',
  'folder',
  'score',
  'status',
  'intervalDays',
  'promptCount'
] as const

export type PageSortKey = (typeof PAGE_SORT_KEYS)[number]
export type { SortDir } from '../utils/sort'

export type SortKey = SortSpec<PageSortKey>

export interface PageFilter {
  statuses: readonly PageStatus[]
  folders: readonly string[]
}

export const EMPTY_PAGE_FILTER: PageFilter = { statuses: [], folders: [] }

export interface RowWindow {
  start: number
  end: number
  paddingTop: number
  paddingBottom: number
}

export function filterPageRows(pages: readonly PageSummary[], filter: PageFilter): PageSummary[] {
  return pages.filter((page) => pageMatches(page, filter))
}

export function pageMatches(page: PageSummary, filter: PageFilter): boolean {
  if (filter.statuses.length > 0 && !filter.statuses.includes(page.status)) return false
  if (filter.folders.length > 0 && !filter.folders.includes(page.folder ?? '')) return false
  return true
}

/** Counts for one facet after every other facet has been applied. */
export function facetCount(
  pages: readonly PageSummary[],
  filter: PageFilter,
  facet: 'status' | 'folder',
  value: string
): number {
  const without: PageFilter =
    facet === 'status' ? { ...filter, statuses: [] } : { ...filter, folders: [] }
  return pages.filter((page) => {
    if (!pageMatches(page, without)) return false
    if (facet === 'status') return page.status === value
    return (page.folder ?? '') === value
  }).length
}

export function sortPages(pages: readonly PageSummary[], sorts: readonly SortKey[]): PageSummary[] {
  const indexed = pages.map((page, index) => ({ page, index }))
  indexed.sort((a, b) => {
    for (const sort of sorts) {
      const compared = compareValues(sortValue(a.page, sort.key), sortValue(b.page, sort.key))
      if (compared !== 0) return sort.dir === 'desc' ? -compared : compared
    }
    return a.index - b.index
  })
  return indexed.map((item) => item.page)
}

export { cycleSort } from '../utils/sort'

export function rowWindow(
  count: number,
  scrollTop: number,
  viewport: number,
  rowHeight: number,
  overscan: number
): RowWindow {
  if (count <= 0 || rowHeight <= 0 || viewport <= 0) {
    return { start: 0, end: 0, paddingTop: 0, paddingBottom: 0 }
  }
  const visible = Math.ceil(viewport / rowHeight)
  // Rows can be taller than `rowHeight` (wrapped text), so the real scroll can pass the
  // estimated end. Clamp to the last screenful: an empty window shrinks the content, the
  // browser pulls the scroll back, the rows return, and the list flickers in a loop.
  const rawStart = Math.min(
    Math.max(0, Math.floor(scrollTop / rowHeight)),
    Math.max(0, count - visible)
  )
  const start = Math.max(0, rawStart - overscan)
  const end = Math.min(count, rawStart + visible + overscan)
  return {
    start,
    end,
    paddingTop: start * rowHeight,
    paddingBottom: Math.max(0, count - end) * rowHeight
  }
}

export function nextRowIndex(current: number, count: number, key: string): number | null {
  if (count <= 0) return null
  if (key === 'ArrowDown') return (current + 1) % count
  if (key === 'ArrowUp') return (current - 1 + count) % count
  if (key === 'Home') return 0
  if (key === 'End') return count - 1
  return null
}

function sortValue(page: PageSummary, key: PageSortKey): string | number | null {
  switch (key) {
    case 'title':
      return (page.label ?? page.title ?? page.url ?? '').toLowerCase()
    case 'folder':
      return page.folder?.toLowerCase() ?? null
    case 'score':
      return page.score
    case 'status':
      return page.status
    case 'intervalDays':
      return page.intervalDays
    case 'promptCount':
      return page.promptCount
  }
}

function compareValues(a: string | number | null, b: string | number | null): number {
  if (a === null && b === null) return 0
  if (a === null) return 1
  if (b === null) return -1
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return String(a).localeCompare(String(b))
}

export interface TreeNode {
  id: string
  label: string
  count: number
  pages: readonly PageSummary[]
}

export type FlatTreeItem =
  | { kind: 'folder'; id: string; label: string; count: number }
  | { kind: 'page'; id: string; page: PageSummary }

/** Folder headers followed by every page in that folder, so a count matches the rows under it. */
export function flattenFolderTree(nodes: readonly TreeNode[]): FlatTreeItem[] {
  const rows: FlatTreeItem[] = []
  for (const node of nodes) {
    rows.push({ kind: 'folder', id: `folder:${node.id}`, label: node.label, count: node.count })
    for (const page of node.pages) rows.push({ kind: 'page', id: page.id, page })
  }
  return rows
}

export function folderTree(pages: readonly PageSummary[]): TreeNode[] {
  const groups = new Map<string, PageSummary[]>()
  for (const page of pages) {
    const key = page.folder ?? ''
    const list = groups.get(key)
    if (list) list.push(page)
    else groups.set(key, [page])
  }
  return [...groups.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([folder, group]) => ({
      id: folder.length > 0 ? folder : 'none',
      label: folder.length > 0 ? folder : '(No folder)',
      count: group.length,
      pages: group
    }))
}
