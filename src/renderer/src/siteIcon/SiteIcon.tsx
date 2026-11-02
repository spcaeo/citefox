import { useCallback, useState, useSyncExternalStore, type JSX, type ReactNode } from 'react'
import { iconFor, iconKey, subscribeIcon } from './loader'
import { siteTone } from './tone'
import './siteIcon.css'

/** A domain a letter stands for; anything else (no dot, an address with no letters) gets a globe. */
function letterOf(key: string): string | null {
  if (!key.includes('.')) return null
  const letter = key.match(/[a-z0-9]/u)?.[0]
  return letter === undefined ? null : letter.toUpperCase()
}

/**
 * A site's icon next to its domain: a letter tile in the site's own stable
 * colour at once, swapped for the favicon when main has it (`favicons:get`,
 * fetched once per domain and cached in the background). Decorative: the
 * domain text beside it is the accessible name. Never blocks rendering and
 * never loads a remote URL (the CSP allows `data:`).
 */
export function SiteIcon({
  domain,
  size = 16,
  spaced = false
}: {
  domain: string
  /** Pixels. 16 in tables and lists, 20 in roomier rows. */
  size?: 16 | 20
  /** A gap after the icon, for text that is not in a flex row with its own gap. */
  spaced?: boolean
}): JSX.Element {
  const key = iconKey(domain)
  const subscribe = useCallback((listener: () => void) => subscribeIcon(key, listener), [key])
  const icon = useSyncExternalStore(
    subscribe,
    () => iconFor(key),
    () => undefined
  )
  const [broken, setBroken] = useState<string | null>(null)
  const letter = letterOf(key)
  const style = { width: size, height: size }
  const extra = `${size === 20 ? ' site-icon-20' : ''}${spaced ? ' site-icon-spaced' : ''}`
  if (typeof icon === 'string' && broken !== icon) {
    return (
      <img
        className={`site-icon site-icon-img${extra}`}
        src={icon}
        alt=""
        aria-hidden="true"
        width={size}
        height={size}
        style={style}
        data-site-icon={key}
        onError={() => setBroken(icon)}
      />
    )
  }
  const state = icon === undefined ? 'loading' : 'none'
  if (letter === null) {
    return (
      <span
        className={`site-icon site-icon-globe${extra}`}
        aria-hidden="true"
        style={style}
        data-site-icon={key}
        data-site-icon-state={state}
      >
        <svg
          viewBox="0 0 24 24"
          width={size - 6}
          height={size - 6}
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          focusable="false"
        >
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18" />
        </svg>
      </span>
    )
  }
  return (
    <span
      className={`site-icon site-icon-letter site-icon-tone-${siteTone(key)}${extra}`}
      aria-hidden="true"
      style={style}
      data-site-icon={key}
      data-site-icon-state={state}
      // Drawn by CSS, so the row's text (and its copy, search and tests) stays the domain.
      data-letter={letter}
    />
  )
}

/** The icon and its label on one line: `<SiteLabel domain="a.com">a.com</SiteLabel>`. */
export function SiteLabel({
  domain,
  children,
  className
}: {
  domain: string
  children?: ReactNode
  className?: string
}): JSX.Element {
  return (
    <span className={className ? `site-label ${className}` : 'site-label'}>
      <SiteIcon domain={domain} />
      <span className="site-label-text">{children ?? domain}</span>
    </span>
  )
}
