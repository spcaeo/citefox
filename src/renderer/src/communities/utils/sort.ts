import type { SortSpec } from '../../utils/sort'

export type SortValue = string | number | null

/**
 * Multi-key sort for the source tables. Empty values always sort last, strings
 * compare case-insensitively, and ties keep the original order.
 */
export function sortRows<T, K extends string>(
  rows: readonly T[],
  specs: readonly SortSpec<K>[],
  value: (row: T, key: K) => SortValue
): T[] {
  const indexed = rows.map((row, index) => ({ row, index }))
  indexed.sort((left, right) => {
    for (const spec of specs) {
      const a = value(left.row, spec.key)
      const b = value(right.row, spec.key)
      if (a === null && b === null) continue
      if (a === null) return 1
      if (b === null) return -1
      const compared =
        typeof a === 'string' || typeof b === 'string'
          ? String(a).localeCompare(String(b), 'en', { sensitivity: 'base' })
          : a - b
      if (compared !== 0) return spec.dir === 'desc' ? -compared : compared
    }
    return left.index - right.index
  })
  return indexed.map((item) => item.row)
}
