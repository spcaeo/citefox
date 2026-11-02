import type { JSX, ReactNode } from 'react'
import type { Market } from '@shared/domain'
import type { OverviewPeriod } from '@shared/ipc'
import { marketLabel } from '../../shell/model'
import { Dropdown, SegmentedControl } from '../../ui'
import { PERIOD_OPTIONS } from '../model'

/**
 * Title, one-line subtitle and the screen's one primary action; under them the filter
 * toolbar: the engine filter (in the same spot as every list's toolbar), the market
 * picker (with two or more markets) and the period picker.
 */
export function OverviewHeader({
  period,
  onPeriod,
  markets = [],
  marketId = null,
  onMarket,
  action,
  filters
}: {
  period: OverviewPeriod
  onPeriod: (period: OverviewPeriod) => void
  markets?: readonly Market[]
  /** Null: each page and topic in its default market. */
  marketId?: string | null
  onMarket?: (marketId: string | null) => void
  /** The primary action: Check now, or Add questions before there are any. */
  action?: ReactNode
  /** The engine filter, first in the toolbar. */
  filters?: ReactNode
}): JSX.Element {
  return (
    <header className="ov-head">
      <div className="ov-head-top">
        <div className="ov-head-text">
          <h1>Summary</h1>
          <p>How AI answers cite you, and who they cite instead.</p>
        </div>
        {action ? <div className="ov-head-actions">{action}</div> : null}
      </div>
      <div className="ov-head-tools" role="group" aria-label="Summary filters">
        {filters}
        {markets.length >= 2 && onMarket ? (
          // Not a <label>: a press on a choice inside one would also press the button.
          <span className="ui-head-field">
            <span className="ui-head-field-label" aria-hidden="true">
              Market
            </span>
            <Dropdown
              aria-label="Market"
              size="sm"
              value={marketId ?? ''}
              onChange={(value) => onMarket(value || null)}
              options={[
                { value: '', label: 'Each page’s market' },
                ...markets.map((market) => ({ value: market.id, label: marketLabel(market) }))
              ]}
            />
          </span>
        ) : null}
        <SegmentedControl
          label="Period"
          options={PERIOD_OPTIONS}
          value={period}
          onChange={onPeriod}
        />
      </div>
    </header>
  )
}
