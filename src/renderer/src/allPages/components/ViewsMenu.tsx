import type { JSX } from 'react'
import type { SavedGridView } from '@shared/domain'
import { Button, MenuButton, type MenuItem } from '../../ui'

/**
 * The list's view options in one short menu: filters, grouping and columns,
 * Export CSV, and saved views (FR-21.2). The open saved view carries a check.
 */
export function ViewsMenu({
  savedViews,
  savedName,
  canSave,
  filterCount,
  onFilters,
  onExport,
  onColumns,
  onSave,
  onOpenSaved,
  onUpdateSaved,
  onDeleteSaved
}: {
  savedViews: readonly SavedGridView[]
  /** The open saved view's name, or null on a built-in view. */
  savedName: string | null
  canSave: boolean
  /** Column filters that are on. */
  filterCount: number
  onFilters: () => void
  /** Null when Export CSV is not available. */
  onExport: (() => void) | null
  onColumns: () => void
  onSave: () => void
  onOpenSaved: (id: string) => void
  onUpdateSaved: () => void
  onDeleteSaved: () => void
}): JSX.Element {
  const items: MenuItem[] = [
    {
      id: 'filters',
      label: filterCount > 0 ? `Filters… (${filterCount} on)` : 'Filters…',
      icon: 'sliders',
      onSelect: onFilters
    },
    { id: 'columns', label: 'Group and columns…', icon: 'layers', onSelect: onColumns },
    ...(onExport
      ? [{ id: 'export', label: 'Export CSV', icon: 'download', onSelect: onExport } as MenuItem]
      : []),
    ...savedViews.map((view): MenuItem => ({
      id: `saved:${view.id}`,
      label: `Open view “${view.name}”`,
      icon: view.name === savedName ? 'check' : 'eye',
      onSelect: () => onOpenSaved(view.id)
    })),
    ...(canSave
      ? [{ id: 'save', label: 'Save this view…', icon: 'plus', onSelect: onSave } as MenuItem]
      : []),
    ...(savedName
      ? [
          {
            id: 'update',
            label: `Update “${savedName}”`,
            icon: 'refresh',
            onSelect: onUpdateSaved
          } as MenuItem,
          {
            id: 'delete',
            label: `Delete “${savedName}”`,
            icon: 'trash',
            tone: 'danger',
            onSelect: onDeleteSaved
          } as MenuItem
        ]
      : [])
  ]
  return (
    <MenuButton
      label="View options"
      items={items}
      width={264}
      trigger={({ ref, ...props }) => (
        <Button ref={ref} size="sm" icon="layers" iconEnd="chevron-down" {...props}>
          {savedName ?? 'Views'}
        </Button>
      )}
    />
  )
}
