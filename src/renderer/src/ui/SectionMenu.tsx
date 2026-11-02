import type { JSX } from 'react'
import { IconButton } from './IconButton'
import { MenuButton, type MenuItem } from './Menu'

export interface SectionMenuProps {
  /** Accessible name and tooltip, such as "More actions for Questions". */
  label: string
  items: readonly MenuItem[]
  /** Menu width in pixels. Default 232. */
  width?: number
}

/**
 * The ⋯ at the right of a section or card head (Docs/HEADER.md): when a head
 * has more than one action, they all live here, or one text link stays
 * beside it. Unlike a row's ⋯ it is always visible.
 */
export function SectionMenu({ label, items, width }: SectionMenuProps): JSX.Element {
  return (
    <MenuButton
      label={label}
      items={items}
      {...(width !== undefined ? { width } : {})}
      trigger={({ ref, ...props }) => (
        <IconButton
          ref={ref}
          icon="dots"
          label={label}
          size="sm"
          tip
          className="ui-section-menu"
          {...props}
        />
      )}
    />
  )
}
