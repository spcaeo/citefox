import type { CSSProperties, JSX, ReactNode } from 'react'
import { safeExternalUrl, useDrill, type DrillRequest } from '../../drill'
import { UrlText } from '../../ui'
import { displayUrl } from '../utils/model'
import './drillBits.css'

/**
 * A cited source's address with Copy and Open in a new tab (ui `UrlText`). An
 * address that is not a safe web link shows as plain text.
 */
export function SourceUrl({ url, className }: { url: string; className?: string }): JSX.Element {
  const label = displayUrl(url)
  if (!safeExternalUrl(url)) return <span className={className}>{label}</span>
  return <UrlText url={url} label={label} {...(className ? { className } : {})} />
}

/**
 * A chart mark (a bar segment, a donut arc's twin) that opens a drill on
 * click. Keyboard and screen-reader users reach the same drill through the
 * labelled count next to the chart, so the mark is not a tab stop and is
 * hidden from the accessibility tree.
 */
export function MarkButton({
  drill,
  className,
  style,
  title,
  children
}: {
  drill: DrillRequest
  className?: string
  style?: CSSProperties
  /** Hover text, such as "18 positive claims". */
  title?: string
  children?: ReactNode
}): JSX.Element {
  const { open } = useDrill()
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-hidden="true"
      className={className ? `mark-btn ${className}` : 'mark-btn'}
      style={style}
      title={title}
      onClick={() => open(drill)}
    >
      {children}
    </button>
  )
}
