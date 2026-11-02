import type { JSX } from 'react'
import type { CompanySuggestion } from '@shared/ipc'
import { UrlText } from '../ui'
import { CompanyDomain } from './CompanyDomain'
import { Sources } from './CompetitorRows'
import type { CheckCompanyDomain } from './domain'

/**
 * One company row for what buyers switch from and integrations: name and domain, the
 * reason, and the page that shows it. Competitors use the price table (CompetitorRows).
 */
export function CompanyRow({
  item,
  site,
  showUnknownDomain,
  onCheckDomain,
  onDomainSaved,
  action
}: {
  item: CompanySuggestion
  /** The business's own domain: evidence paths open on it. */
  site: string
  showUnknownDomain: boolean
  onCheckDomain?: CheckCompanyDomain
  onDomainSaved: (domain: string) => void
  action: JSX.Element | null
}): JSX.Element {
  const sources = item.sources ?? []
  return (
    <li className="fill-item">
      <span className="fill-copy">
        <span className="fill-name">
          <span className="fill-text">{item.name}</span>
          <CompanyDomain
            item={item}
            showUnknown={showUnknownDomain}
            {...(onCheckDomain ? { onCheck: onCheckDomain } : {})}
            onSaved={onDomainSaved}
          />
        </span>
        <span className="fill-reason">{item.reason}</span>
        {item.startingPrice ? (
          <span className="fill-price num">From {item.startingPrice}</span>
        ) : null}
        {item.evidence ? (
          <span className="fill-evidence">
            <UrlText url={item.evidence.path} label={`${site}${item.evidence.path}`} site={site} />
            <q className="fill-quote">{item.evidence.quote}</q>
          </span>
        ) : null}
        {sources.length > 0 ? <Sources sources={sources} /> : null}
      </span>
      {action}
    </li>
  )
}
