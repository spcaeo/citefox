import type { JSX, ReactNode } from 'react'

/**
 * One sidebar link. The label stays in the link for its accessible name; in
 * the collapsed rail it is visually hidden and `data-tip` shows it as a
 * tooltip. A link with no icon shows its first letter in the rail.
 */
export function SidebarItem({
  href,
  current,
  label,
  icon,
  score,
  scoreTip,
  tone = 'default',
  guide
}: {
  href: string
  current: boolean
  label: string
  icon?: ReactNode
  score?: string
  /** What the score means, for the tooltip ("22% target page cited"). Default: the score. */
  scoreTip?: string
  tone?: 'default' | 'add'
  /** A `data-guide` name, so a guide step can point at this item. */
  guide?: string
}): JSX.Element {
  const className = tone === 'add' ? 'nav-link add' : 'nav-link'
  return (
    <a
      className={className}
      href={href}
      aria-current={current ? 'page' : undefined}
      data-guide={guide}
      data-tip={score !== undefined ? `${label} · ${scoreTip ?? score}` : label}
    >
      {icon ?? (
        <span className="nav-initial" aria-hidden="true">
          {label.trim().charAt(0).toUpperCase()}
        </span>
      )}
      <span className="nav-text">{label}</span>
      {score !== undefined ? (
        <>
          {' '}
          <span className="nav-score">{score}</span>
        </>
      ) : null}
    </a>
  )
}
