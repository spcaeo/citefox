import type { JSX, ReactNode } from 'react'
import { DrillButton, type DrillRequest } from '../drill'
import { Chip, UrlText } from '../ui'
import { shownName, siteBrand, siteUrl, type SiteCellData } from './siteRows'
import './sites.css'

/** The site's name; a site known only by its host shows the domain, as plain text. */
export function SiteNameCell({
  site,
  drill = null,
  drillLabel
}: {
  site: SiteCellData
  drill?: DrillRequest | null
  drillLabel?: string
}): JSX.Element {
  const text = shownName(site)
  const nameClass = site.own ? 'site-name site-name-own' : 'site-name'
  const name: ReactNode = drill ? (
    <DrillButton
      drill={drill}
      untracked
      className={`site-name-btn ${nameClass}`}
      label={drillLabel}
    >
      {text}
    </DrillButton>
  ) : (
    <span className={nameClass}>{text}</span>
  )
  return (
    <span className="site-cell-row site-name-cell">
      {name}
      {site.isNew ? (
        <Chip size="sm" tone="warn">
          New
        </Chip>
      ) : null}
    </span>
  )
}

/**
 * The site's website with Copy and Open, on every row. Muted when the name column
 * already shows the same domain.
 */
export function SiteWebsiteCell({ site }: { site: SiteCellData }): JSX.Element | null {
  if (!site.domain) return null
  const same = siteBrand(site.domain, site.name) === null
  return (
    <UrlText
      url={siteUrl(site.domain)}
      label={site.domain}
      icon={false}
      className={same ? 'site-website site-website-same' : 'site-website'}
    />
  )
}
