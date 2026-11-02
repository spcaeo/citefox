import type { GridMembership } from '@shared/domain'
import type { GridColumn, GridGroupOption, MembershipValue } from './types'

export const NO_VALUE = '—'
export const NONE_KEY = ''

/**
 * A membership column, such as Cluster or Group (FR-19.5, FR-19.7). The rows
 * supply memberships by data. Null means the project has none yet, and the cell
 * reads "—"; an empty list reads "(None)" in filters and groups.
 */
export function membershipColumn<Row>(options: {
  id: string
  label: string
  width: number
  get: (row: Row) => MembershipValue
  hiddenByDefault?: boolean
  note?: string
}): GridColumn<Row> {
  const names = (row: Row): readonly string[] =>
    (options.get(row) ?? []).map((item: GridMembership) => item.name)
  return {
    id: options.id,
    label: options.label,
    width: options.width,
    ...(options.hiddenByDefault !== undefined ? { hiddenByDefault: options.hiddenByDefault } : {}),
    ...(options.note !== undefined ? { note: options.note } : {}),
    sort: (row) => names(row)[0] ?? null,
    defaultDir: 'asc',
    filter: {
      kind: 'facet',
      values: (row) => {
        const value = options.get(row)
        if (value === null) return []
        return value.length === 0 ? [NONE_KEY] : value.map((item) => item.name)
      },
      label: (value) => (value === NONE_KEY ? '(None)' : value)
    },
    render: (row) => {
      const list = names(row)
      return list.length === 0 ? <span className="faint">{NO_VALUE}</span> : list.join(', ')
    },
    csv: (row) => names(row).join(' | ') || null
  }
}

/** Group or tree by a membership: the first membership, or "(None)". */
export function membershipGroup<Row>(options: {
  id: string
  label: string
  get: (row: Row) => MembershipValue
}): GridGroupOption<Row> {
  return {
    id: options.id,
    label: options.label,
    key: (row) => {
      const first = options.get(row)?.[0]
      return first ? { key: first.id, label: first.name } : { key: NONE_KEY, label: '(None)' }
    }
  }
}
