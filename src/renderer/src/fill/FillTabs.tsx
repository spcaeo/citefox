import { useId, type JSX } from 'react'
import type { FillFromWebsiteResult } from '@shared/ipc'
import { Button, TabPanel, Tabs, UrlText, type TabItem } from '../ui'
import { patchHashQuery, useHashQuery } from '../utils/hashQuery'
import { CompanyGroups } from './CompanyGroups'
import { buyerTypes, fillTabFrom, FILL_TABS, type BuyerType, type FillTab } from './tabs'
import type { FillActions } from './types'

const QUERY_KEY = 'fill'

/**
 * Competitors · Buyers · Switching from · Integrations · Brand & market (owner
 * feedback: the suggestions were "same and flat" and it was unclear where
 * competitors end). Every panel stays mounted (hidden when not open), so what
 * was added in one tab still shows as added after a visit to another.
 */
export function FillTabs({
  result,
  onAddBrand,
  onAddCompetitor,
  onUseSwitchingFrom,
  onNoteIntegrations,
  onUseMarket,
  onCheckDomain,
  picked
}: FillActions & { result: FillFromWebsiteResult }): JSX.Element {
  const panelId = useId()
  const [query, setQuery] = useHashQuery([QUERY_KEY])
  const tab = fillTabFrom(query[QUERY_KEY])
  const products = result.products ?? []
  const buyers = buyerTypes(products)
  const market = result.suggestedMarket
  const counts: Record<FillTab, number> = {
    competitors: result.competitors.length,
    buyers: buyers.length,
    switching: result.switchingFrom.length,
    integrations: result.integrations.length,
    brand: result.brands.length + (market ? 1 : 0)
  }
  const labels: Record<FillTab, string> = {
    competitors: 'Competitors',
    buyers: 'Buyers',
    switching: 'Switching from',
    integrations: 'Integrations',
    brand: 'Brand & market'
  }
  const hash = typeof window === 'undefined' ? '#/' : window.location.hash
  const tabs: TabItem<FillTab>[] = FILL_TABS.map((id) => ({
    id,
    label: labels[id],
    count: counts[id],
    href: patchHashQuery(hash, { [QUERY_KEY]: id === 'competitors' ? null : id })
  }))
  const groups = {
    site: result.domain,
    competitors: result.competitors,
    switchingFrom: result.switchingFrom,
    integrations: result.integrations,
    onUseSwitchingFrom,
    onNoteIntegrations,
    ...(onCheckDomain ? { onCheckDomain } : {}),
    ...(picked ? { picked } : {})
  }

  return (
    <div className="fill-tabs">
      <Tabs
        label="Suggestion groups"
        size="sm"
        tabs={tabs}
        value={tab}
        panelId={panelId}
        className="fill-tabstrip"
        onChange={(id) => setQuery({ [QUERY_KEY]: id === 'competitors' ? null : id })}
      />
      <TabPanel panelId={panelId} id="competitors" hidden={tab !== 'competitors'}>
        {counts.competitors === 0 && products.length === 0 ? (
          <p className="fill-empty">No competitors were found.</p>
        ) : (
          <CompanyGroups
            {...groups}
            only="competitors"
            onAddCompetitor={onAddCompetitor}
            {...(result.products ? { products: result.products } : {})}
          />
        )}
      </TabPanel>
      <TabPanel panelId={panelId} id="buyers" hidden={tab !== 'buyers'}>
        <BuyersPanel site={result.domain} buyers={buyers} />
      </TabPanel>
      <TabPanel panelId={panelId} id="switching" hidden={tab !== 'switching'}>
        {counts.switching === 0 ? (
          <p className="fill-empty">Nothing buyers switch from was found on the pages read.</p>
        ) : (
          <CompanyGroups {...groups} only="switching" />
        )}
      </TabPanel>
      <TabPanel panelId={panelId} id="integrations" hidden={tab !== 'integrations'}>
        {counts.integrations === 0 ? (
          <p className="fill-empty">No integrations were found on the pages read.</p>
        ) : (
          <CompanyGroups {...groups} only="integrations" />
        )}
      </TabPanel>
      <TabPanel panelId={panelId} id="brand" hidden={tab !== 'brand'}>
        <ul className="fill-items">
          {result.brands.map((brand) => (
            <li className="fill-item" key={brand.id}>
              <span className="fill-copy">
                <span className="fill-label">Brand name</span>
                <span className="fill-text">{brand.name}</span>
                <span className="fill-reason">{brand.reason}</span>
              </span>
              <Button size="sm" icon="plus" onClick={() => onAddBrand(brand.name)}>
                Add brand
              </Button>
            </li>
          ))}
          {market ? (
            <li className="fill-item">
              <span className="fill-copy">
                <span className="fill-label">Default market</span>
                <span className="fill-text">
                  {market.country} · {market.language}
                </span>
                <span className="fill-reason">
                  {market.reason} This is not applied until you use it.
                </span>
              </span>
              <Button size="sm" onClick={() => onUseMarket(market)}>
                Use this market
              </Button>
            </li>
          ) : null}
        </ul>
        {market ? null : (
          <p className="fill-hint">No default market was suggested. Choose one below.</p>
        )}
      </TabPanel>
    </div>
  )
}

/** Who buys, one card per buyer type, with the page it was read from. Not competitors. */
function BuyersPanel({
  site,
  buyers
}: {
  site: string
  buyers: readonly BuyerType[]
}): JSX.Element {
  if (buyers.length === 0) {
    return <p className="fill-empty">No buyer types were found on the pages read.</p>
  }
  return (
    <div className="fill-buyers-wrap">
      <p className="fill-group-hint">
        Who buys, read from your pages: roles, company sizes and industries. They are not
        competitors; buyer questions are written from their situations.
      </p>
      <ul className="fill-buyers" aria-label="Buyer types">
        {buyers.map((buyer) => (
          <li className="fill-buyer" key={buyer.id}>
            <span className="fill-text">{buyer.who}</span>
            <span className="fill-reason">{buyer.need}</span>
            <span className="fill-buyer-from">
              <span className="fill-label">For {buyer.product}</span>
              {buyer.evidencePath ? (
                <UrlText
                  url={buyer.evidencePath}
                  label={`${site}${buyer.evidencePath}`}
                  site={site}
                />
              ) : null}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
