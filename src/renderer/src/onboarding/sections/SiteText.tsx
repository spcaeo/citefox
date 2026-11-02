import type { JSX } from 'react'
import { DomainText, UrlText } from '../../ui'

/**
 * A page on the user's site in a row's second line: a path (`/pricing/`) or
 * an address on the site. Copy and Open build the full URL from the site's
 * own domain (UrlText). The site's root (`/`) reads "homepage". Nothing when
 * there is no address.
 */
export function SitePage({
  value,
  site
}: {
  value: string | null
  site: string
}): JSX.Element | null {
  const text = (value ?? '').trim()
  if (text.length === 0) return null
  if (text.startsWith('/')) {
    const home = text === '/'
    if (!site) return home ? <>homepage</> : <span className="osc-mono">{text}</span>
    return home ? (
      <UrlText path={text} siteBase={site} icon={false} label="homepage" plain />
    ) : (
      <UrlText path={text} siteBase={site} icon={false} />
    )
  }
  const href = /^https?:\/\//iu.test(text) ? text : `https://${text}`
  return <UrlText url={href} icon={false} />
}

/** A competitor's (or any) bare host with its icon, Copy and Open. */
export function HostText({ host }: { host: string | null }): JSX.Element | null {
  const text = (host ?? '').trim()
  if (text.length === 0) return null
  return <DomainText domain={text} className="osc-host" />
}
