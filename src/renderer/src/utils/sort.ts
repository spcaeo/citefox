export type SortDir = 'asc' | 'desc'

export interface SortSpec<K extends string> {
  key: K
  dir: SortDir
}

/**
 * Header click on a sortable grid. A plain click sorts by that column alone
 * and cycles ascending, descending, off. Shift (`additive`) adds the column
 * as a further sort, or cycles it in place.
 */
export function cycleSort<K extends string>(
  current: readonly SortSpec<K>[],
  key: K,
  additive: boolean
): SortSpec<K>[] {
  const index = current.findIndex((item) => item.key === key)
  const dir = index < 0 ? null : (current[index]?.dir ?? null)
  const nextDir = dir === null ? 'asc' : dir === 'asc' ? 'desc' : null
  if (additive) {
    const next = current.slice()
    if (index < 0) next.push({ key, dir: 'asc' })
    else if (nextDir) next[index] = { key, dir: nextDir }
    else next.splice(index, 1)
    return next
  }
  if (index >= 0 && current.length > 1) {
    const currentDir = current[index]?.dir === 'desc' ? 'desc' : 'asc'
    return [{ key, dir: currentDir === 'asc' ? 'desc' : 'asc' }]
  }
  return nextDir ? [{ key, dir: nextDir }] : []
}
