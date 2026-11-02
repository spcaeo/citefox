import { createElement, useId, type JSX } from 'react'
import type { CompanySource, CompanySuggestion } from '@shared/ipc'
import { SiteIcon } from '../siteIcon/SiteIcon'
import { Badge, Chip, UiIcon, UrlText } from '../ui'
import { CompanyDomain } from './CompanyDomain'
import type { CheckCompanyDomain } from './domain'
import type { LowestMark } from './price'
import { sourceLabel } from './sourceLabel'

/**
 * One group of competitors (Direct, Partial overlap, or the flat list) as a
 * compact table: the company with its icon and domain, why a buyer could pick
 * it (and its sources), its starting price, and the Add button. The cheapest
 * price of the group shows in green with what was compared (owner feedback:
 * "the competitor's least price should show clearly in green"). In a narrow
 * card the columns fold into two lines per company.
 */
export function CompetitorGroup({
  title,
  hint,
  level,
  items,
  site,
  lowest,
  rowAction,
  onCheckDomain,
  onDomainSaved
}: {
  title: string
  hint?: string
  level: number
  items: readonly CompanySuggestion[]
  site: string
  /** The cheapest prices of this group, by suggestion id. */
  lowest: ReadonlyMap<string, LowestMark>
  rowAction: (item: CompanySuggestion) => JSX.Element | null
  onCheckDomain?: CheckCompanyDomain
  onDomainSaved: (id: string, domain: string) => void
}): JSX.Element {
  const id = useId()
  const tag = `h${Math.min(6, Math.max(3, level))}`
  return (
    <section
      className={level > 4 ? 'fill-group fill-subgroup' : 'fill-group'}
      aria-labelledby={`${id}-title`}
    >
      <div className="fill-group-head">
        {createElement(tag, { id: `${id}-title`, className: 'fill-group-title' }, title)}
        <Badge className="fill-group-count" label={`${items.length} found`}>
          {items.length}
        </Badge>
      </div>
      {hint ? <p className="fill-group-hint">{hint}</p> : null}
      <div className="fill-rivals-head" aria-hidden="true">
        <span>Competitor</span>
        <span>Why a buyer could pick it</span>
        <span>Starting price</span>
        <span />
      </div>
      <ul className="fill-items fill-rivals">
        {items.map((item) => (
          <li className="fill-rival" key={item.id}>
            <span className="fill-rival-name">
              <span className="fill-name">
                {item.domain ? <SiteIcon domain={item.domain} /> : null}
                <span className="fill-text">{item.name}</span>
              </span>
              <CompanyDomain
                item={item}
                showUnknown
                icon={false}
                {...(onCheckDomain ? { onCheck: onCheckDomain } : {})}
                onSaved={(domain) => onDomainSaved(item.id, domain)}
              />
            </span>
            <span className="fill-rival-why">
              <span className="fill-reason">{item.reason}</span>
              {item.evidence ? (
                <span className="fill-evidence">
                  <UrlText
                    url={item.evidence.path}
                    label={`${site}${item.evidence.path}`}
                    site={site}
                  />
                  <q className="fill-quote">{item.evidence.quote}</q>
                </span>
              ) : null}
              {(item.sources ?? []).length > 0 ? <Sources sources={item.sources ?? []} /> : null}
            </span>
            <span className="fill-rival-price">
              <PriceCell price={item.startingPrice ?? null} mark={lowest.get(item.id) ?? null} />
            </span>
            <span className="fill-rival-action">{rowAction(item)}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** The starting price: green with "Lowest per text" when cheapest, muted "Not listed" when absent. */
function PriceCell({
  price,
  mark
}: {
  price: string | null
  mark: LowestMark | null
}): JSX.Element {
  if (price === null || price.trim().length === 0) {
    return <span className="fill-price fill-price-none">Not listed</span>
  }
  if (mark === null) {
    return (
      <span className="fill-price num">
        <span className="sr-only">Starting price </span>
        {price}
      </span>
    )
  }
  return (
    <span className="fill-price fill-price-low" title={mark.tooltip}>
      <span className="fill-price-value num">
        <span className="sr-only">Starting price </span>
        {price}
      </span>
      <span className="fill-price-note">
        {mark.label}
        <span className="sr-only">. {mark.tooltip}</span>
      </span>
    </span>
  )
}

/** "Cheapest direct rivals: text.email $20/mo · SMSGlobal $0.019/text", above a product's table. */
export function CheapestLine({
  items,
  lowest,
  label
}: {
  items: readonly CompanySuggestion[]
  lowest: ReadonlyMap<string, LowestMark>
  label: string
}): JSX.Element | null {
  const cheapest = items.filter((item) => lowest.has(item.id) && item.startingPrice)
  if (cheapest.length === 0) return null
  return (
    <p className="fill-cheapest">
      <UiIcon name="trend-down" size={14} />
      <span>
        {label}:{' '}
        {cheapest.map((item, index) => (
          <span key={item.id}>
            {index > 0 ? ' · ' : null}
            <strong title={lowest.get(item.id)?.tooltip}>
              {item.name} {item.startingPrice}
            </strong>
          </span>
        ))}
      </span>
    </p>
  )
}

/** "Sources (n)": the pages Claude used, each with copy/open, a "biased" tag on marketing. */
export function Sources({ sources }: { sources: readonly CompanySource[] }): JSX.Element {
  return (
    <details className="fill-sources">
      <summary className="num">Sources ({sources.length})</summary>
      <ul>
        {sources.map((source) => (
          <li key={source.url}>
            <UrlText url={source.url} label={sourceLabel(source.url)} />
            {source.biased ? (
              <span
                className="fill-biased"
                title="Written by the business or a direct rival: treat it as marketing."
              >
                <Chip tone="warn" size="sm">
                  biased
                </Chip>
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </details>
  )
}
