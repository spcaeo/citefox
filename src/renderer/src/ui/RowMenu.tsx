import type { JSX } from 'react'
import { IconButton } from './IconButton'
import { MenuButton, type MenuItem } from './Menu'

export interface RowMenuProps {
  /** Accessible name of the button and its menu, such as "Actions for Q6". */
  label: string
  items: readonly MenuItem[]
  /** Menu width in pixels. Default 232. */
  width?: number
  onOpenChange?: (open: boolean) => void
}

/**
 * The right-hand `⋯` row menu (Theme.dc.html list grid). Every row action lives
 * here; rows never show action buttons of their own. The button stays faint
 * until the row is hovered or focused (see `.ui-row-menu` in controls.css).
 */
export function RowMenu({ label, items, width, onOpenChange }: RowMenuProps): JSX.Element {
  return (
    <MenuButton
      label={label}
      items={items}
      {...(width !== undefined ? { width } : {})}
      {...(onOpenChange ? { onOpenChange } : {})}
      trigger={({ ref, ...props }) => (
        <IconButton
          ref={ref}
          icon="dots"
          label={label}
          size="sm"
          className="ui-row-menu"
          {...props}
        />
      )}
    />
  )
}
