import { useId, type JSX, type ReactNode } from 'react'
import type { SectionHue } from '../shell/sidebarNav'
import { UiIcon } from '../ui/UiIcon'

/**
 * One folding sidebar group. The header is a real button with
 * `aria-expanded`; a folded group keeps its items in the DOM, hidden. When the
 * open screen is inside a folded group the header carries a dot, so the user
 * is never lost. In the icon rail there is no header to click: the group
 * shows its items under a thin rule. `hue` marks the label with the group's
 * colour and the open item with a bar in it (sidebar.css).
 */
export function SidebarGroup({
  label,
  count,
  open,
  onToggle,
  collapsed = false,
  holdsCurrent = false,
  hue,
  children
}: {
  label: string
  /** A count after the label (pinned pages, items in a folded group). */
  count?: number
  open: boolean
  onToggle: () => void
  collapsed?: boolean
  /** The open route is one of this group's items. */
  holdsCurrent?: boolean
  /** The group's colour (sidebarNav GROUP_HUE). */
  hue?: SectionHue
  children: ReactNode
}): JSX.Element {
  const bodyId = useId()
  if (collapsed) {
    return (
      <div className="side-group" data-hue={hue}>
        <div className="side-group-rule" aria-hidden="true" />
        {children}
      </div>
    )
  }
  const marked = !open && holdsCurrent
  return (
    <div className="side-group" data-hue={hue}>
      <button
        type="button"
        className="side-group-head"
        aria-expanded={open}
        aria-controls={bodyId}
        data-current={marked || undefined}
        onClick={onToggle}
      >
        <span className="side-group-label">{label}</span>
        {count !== undefined ? <span className="side-group-count">{count}</span> : null}
        {marked ? (
          <span className="side-group-dot" role="img" aria-label="open screen inside" />
        ) : null}
        <UiIcon name="chevron-down" size={12} className="side-group-chev" />
      </button>
      <div id={bodyId} className="side-group-body" hidden={!open}>
        {children}
      </div>
    </div>
  )
}
