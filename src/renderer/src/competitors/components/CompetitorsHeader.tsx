import type { JSX } from 'react'
import type { CompetitorPeriod, CompetitorProductOption } from '@shared/ipc'
import type { Market } from '@shared/domain'
import { HeaderField } from '../../components/Header'
import { marketLabel } from '../../shell/model'
import { SegmentedControl } from '../../ui'
import { PERIOD_OPTIONS } from '../model'

/** The line under the Competitors title, as Summary has one under its own. */
export const COMPETITORS_SUBTITLE = 'Who AI answers cite for your questions.'

/**
 * The scope controls in the header row, on the right before Add competitor and ⋯
 * (the Summary layout): product when there are products, market with two or more,
 * then the period.
 */
export function CompetitorsScope({
  period,
  productId,
  marketId,
  products,
  markets,
  onPeriod,
  onProduct,
  onMarket
}: {
  period: CompetitorPeriod
  productId: string | null
  marketId: string | null
  products: readonly CompetitorProductOption[]
  markets: readonly Market[]
  onPeriod: (period: string) => void
  onProduct: (productId: string | null) => void
  onMarket: (marketId: string | null) => void
}): JSX.Element {
  return (
    <>
      {products.length > 0 ? (
        <HeaderField label="Product">
          <select
            className="select"
            value={productId ?? ''}
            onChange={(event) => onProduct(event.target.value || null)}
          >
            <option value="">All products</option>
            {products.map((product) => (
              <option key={product.id} value={product.id}>
                {product.name}
              </option>
            ))}
          </select>
        </HeaderField>
      ) : null}
      {markets.length > 1 ? (
        <HeaderField label="Market">
          <select
            className="select"
            value={marketId ?? ''}
            onChange={(event) => onMarket(event.target.value || null)}
          >
            <option value="">All markets</option>
            {markets.map((market) => (
              <option key={market.id} value={market.id}>
                {marketLabel(market)}
              </option>
            ))}
          </select>
        </HeaderField>
      ) : null}
      <SegmentedControl
        label="Period"
        options={PERIOD_OPTIONS}
        value={String(period)}
        onChange={onPeriod}
      />
    </>
  )
}
