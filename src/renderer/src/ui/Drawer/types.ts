import type { ReactNode, RefObject } from 'react'
import type { ButtonVariant } from '../classes'
import type { ToolKind } from '../toolKinds'
import type { UiIconName } from '../UiIcon'

/** One breadcrumb. With `href` it is a link; `onSelect` runs instead of following it. */
export interface DrawerCrumb {
  label: string
  href?: string
  onSelect?: () => void
  /** Full text for the tooltip when the label is shortened. Default: the label. */
  title?: string
}

/** A footer button. */
export interface DrawerAction {
  /** Verb + object: "Save target", "Add and check now". */
  label: string
  onClick: () => void
  busy?: boolean
  disabled?: boolean
  icon?: UiIconName
  iconEnd?: UiIconName
  /** Accessible name when it must say more than the label. */
  ariaLabel?: string
  /** Defaults: primary `primary`, secondary `secondary`, danger `danger`. */
  variant?: ButtonVariant
  testId?: string
  /** `data-guide`, for the first-run guide's pointer. */
  guide?: string
}

/**
 * A tool icon in the title row, left of ✕ (Copy link, CSV…): icon only, its
 * name as tooltip and accessible name (Docs/DESIGN-GUIDELINES.md §2).
 */
export interface DrawerTool {
  id: string
  /** The standard tool (ui/Tools): its one icon and default name. */
  kind: ToolKind
  /** A more exact name, such as "Export CSV of these 7 pages". Default: the kind's name. */
  label?: string
  onClick: () => void
  disabled?: boolean
}

/**
 * The sticky footer. Left: what will happen and what it costs ("7 new
 * questions · checking now uses 14 searches · 196 left"). Right: Cancel, at
 * most one secondary, one primary. A read-only drawer gives no primary and
 * gets a single Close button in the same place.
 */
export interface DrawerFooterSpec {
  summary?: ReactNode
  /** Cancel's label, or false to leave it out. Default "Cancel" ("Close" with no primary). */
  cancel?: string | false
  secondary?: DrawerAction
  primary?: DrawerAction
  /** A destructive action at the far left (opens a Confirm, or acts with an undo). */
  danger?: DrawerAction
}

/** The words of the unsaved-changes question. */
export interface DrawerGuardCopy {
  title: string
  body: ReactNode
  keepLabel: string
  discardLabel: string
}

/** "Step 2 of 3" next to the title. */
export interface DrawerStep {
  current: number
  total: number
}

export interface DrawerProps {
  /** The drawer's kind (`data-drawer`), and the key Expert options are remembered under. */
  id: string
  /** The task, such as "Add questions". The heading, the last crumb and "Close {title}". */
  title: string
  /** Rich heading content (a count in tabular figures). Default: `title`. */
  heading?: ReactNode
  /**
   * The whole trail before the title. Unset: the router's trail for this
   * drawer (project › section › entity, and the drawer under a stacked one),
   * then `trail`.
   */
  crumbs?: readonly DrawerCrumb[]
  /** Crumbs between the router's trail and the title (the entity, such as a topic). */
  trail?: readonly DrawerCrumb[]
  /** One line under the title: scope and a plain-words purpose. */
  subtitle?: ReactNode
  step?: DrawerStep
  /** Short status text left of ✕, such as "Saved as a draft · nothing is searched yet". */
  status?: ReactNode
  /** Tool icons at the top right, before ✕ (Copy link, CSV). */
  tools?: readonly DrawerTool[]
  /** A row under the subtitle: a Stepper or Tabs. */
  headerExtra?: ReactNode
  footer?: DrawerFooterSpec
  /** Unsaved changes: ✕, Esc, the scrim, a crumb and Back ask "Discard changes?" first. */
  dirty?: boolean
  guard?: Partial<DrawerGuardCopy>
  /** While true nothing closes the drawer (a save in flight). */
  closeDisabled?: boolean
  /** Marks the drawer busy for assistive tech. */
  busy?: boolean
  /** The greyed real layout instead of the body while the data loads. */
  loading?: boolean
  /** Shown instead of the body when the whole drawer failed to load. */
  error?: { message: string; onRetry?: () => void }
  /** Close this drawer (the router's close, or a parent's state). */
  onClose: () => void
  /** Where focus goes on open. Default: `[data-autofocus]`, else the first field, else the title. */
  initialFocus?: RefObject<HTMLElement | null>
  /**
   * With no `initialFocus`: `auto` (default) is `[data-autofocus]`, else the
   * first field, else the title; `close` is ✕, for a read-only list that is
   * mostly opened to glance at and close.
   */
  focusOnOpen?: 'auto' | 'close'
  /** When this changes, focus moves to the initial element again (a new step). */
  focusKey?: unknown
  /** Stack depth. Default: the router's (0 for a drawer of its own). */
  depth?: number
  testId?: string
  className?: string
  /** Extra `data-*` attributes on the dialog, such as the drill id tests look for. */
  attributes?: Readonly<Record<`data-${string}`, string>>
  children?: ReactNode
}
