import type { JSX, ReactNode } from 'react'
import {
  ScreenHeader,
  type HeaderMoreItem,
  type HeaderPrimary,
  type HeaderTool
} from '../components/Header'

/**
 * The one standard header for a section whose screen does not draw its own:
 * the title, an optional line under it, and its actions on the right (one
 * green `primary`, the rest under ⋯ `more`; Docs/HEADER.md). No in-page breadcrumb;
 * the top bar's is the only one. Screens that draw their own header (All
 * pages, Reports, Alerts, Structure…) are mounted bare, so every route shows
 * exactly one header.
 */
export function SectionFrame({
  title,
  subtitle,
  tools,
  actions,
  primary,
  more,
  moreLabel,
  children
}: {
  title: string
  subtitle?: ReactNode
  /** Tool icons, first at the header's right end. */
  tools?: readonly HeaderTool[]
  /** Older free-form actions; new screens pass `primary` and `more`. */
  actions?: ReactNode
  primary?: HeaderPrimary | ReactNode
  more?: readonly HeaderMoreItem[]
  moreLabel?: string
  children?: ReactNode
}): JSX.Element {
  return (
    <div className="section-frame">
      <ScreenHeader
        title={title}
        subtitle={
          subtitle === undefined ? undefined : <p className="section-subtitle">{subtitle}</p>
        }
        {...(tools ? { tools } : {})}
        actions={actions}
        primary={primary}
        {...(more ? { more } : {})}
        {...(moreLabel ? { moreLabel } : {})}
      />
      {children}
    </div>
  )
}
