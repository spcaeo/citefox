import type { JSX, ReactNode } from 'react'
import { Panel } from '../../ui'

/** A widget's card: its name, its own controls on the right, and what it shows. */
export function WidgetCard({
  title,
  tools,
  children,
  className
}: {
  title: string
  tools?: ReactNode
  children: ReactNode
  className?: string
}): JSX.Element {
  return (
    <Panel
      title={title}
      padding={16}
      className={className ? `wb-panel ${className}` : 'wb-panel'}
      actions={tools}
    >
      {children}
    </Panel>
  )
}

/** Loading, a read that failed, or nothing to show yet: one quiet line. */
export function WidgetNote({
  loading = false,
  error = null,
  children
}: {
  loading?: boolean
  error?: string | null
  children?: ReactNode
}): JSX.Element {
  if (loading) {
    return (
      <p className="ov-note" role="status">
        Loading…
      </p>
    )
  }
  if (error !== null) return <p className="ov-note">Could not load this widget. {error}</p>
  return <p className="ov-note">{children}</p>
}
