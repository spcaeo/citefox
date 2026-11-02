import type { JSX, ReactNode } from 'react'
import { UiIcon, type UiIconName } from './UiIcon'

export interface EmptyStateProps {
  /** Icon in the 40px tile. Default `inbox`. */
  icon?: UiIconName
  /** One short line, such as "No AI Overview yet". */
  title: string
  /** One helper line, such as "CiteFox checks these again on Nov 2." */
  body?: ReactNode
  /** One action, usually a small secondary Button ("Clear search", "Check now"). */
  action?: ReactNode
  /** Less padding, for small panels. */
  compact?: boolean
  /** Heading level of the title. Default 3. */
  level?: 2 | 3 | 4
}

/** An empty list or panel (Theme.dc.html list grid empty states). Centred, one action at most. */
export function EmptyState({
  icon = 'inbox',
  title,
  body,
  action,
  compact = false,
  level = 3
}: EmptyStateProps): JSX.Element {
  const Heading = `h${level}` as 'h2' | 'h3' | 'h4'
  return (
    <div className={compact ? 'ui-empty ui-empty-compact' : 'ui-empty'}>
      <span className="ui-empty-icon">
        <UiIcon name={icon} size={20} />
      </span>
      <Heading className="ui-empty-title">{title}</Heading>
      {body ? <p className="ui-empty-body">{body}</p> : null}
      {action ? <div className="ui-empty-action">{action}</div> : null}
    </div>
  )
}
