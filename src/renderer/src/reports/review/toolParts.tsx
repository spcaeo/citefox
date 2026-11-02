import type { JSX } from 'react'
import { IconButton } from '../../ui'

/**
 * A copy tool as an icon (Docs/DESIGN-GUIDELINES.md §1): the copy icon (or link for a
 * link) with its name as the tooltip, a green tick and "… copied" for a moment after.
 */
export function CopyTool({
  label,
  copied,
  onClick,
  link = false,
  disabled = false
}: {
  /** "Copy all URLs", "Copy brief"…: the tooltip and the button's name. */
  label: string
  copied: boolean
  onClick: () => void
  link?: boolean
  disabled?: boolean
}): JSX.Element {
  return (
    <IconButton
      icon={copied ? 'check' : link ? 'link' : 'copy'}
      size="sm"
      tip
      label={copied ? 'Copied' : label}
      className={copied ? 'rv-copied' : undefined}
      onClick={onClick}
      disabled={disabled}
    />
  )
}
