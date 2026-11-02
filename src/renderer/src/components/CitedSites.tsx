import type { JSX } from 'react'
import { UrlText } from '../ui'
import './citedSites.css'

const DOMAIN_LIKE = /^[a-z\d-]+(\.[a-z\d-]+)+$/i

/**
 * Sources cited instead, best first, for a narrow column: only the first one shows
 * (a domain with its icon, Copy and Open). The others stay in the tooltip and in the
 * text for screen readers, so the column reads as one calm name.
 */
export function CitedSites({
  names,
  className
}: {
  names: readonly string[]
  className?: string
}): JSX.Element {
  if (names.length === 0) return <span className="faint">—</span>
  const [first = '', ...rest] = names
  return (
    <span
      className={className ? `cited-sites ${className}` : 'cited-sites'}
      title={names.join(', ')}
    >
      {DOMAIN_LIKE.test(first) ? (
        <UrlText domain={first} variant="url" />
      ) : (
        <span className="cited-sites-name">{first}</span>
      )}
      {rest.length > 0 ? <span className="sr-only">, {rest.join(', ')}</span> : null}
    </span>
  )
}
