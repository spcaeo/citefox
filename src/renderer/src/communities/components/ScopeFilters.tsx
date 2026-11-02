import type { JSX, ReactNode } from 'react'
import type { CommunityScope } from '@shared/domain'
import { SegmentedControl } from '../../ui'
import type { MarketChoice } from '../types'
import { useScopeToolbar } from '../utils/scopeToolbar'

/**
 * The screen's two filters, in the toolbar of the open section's first grid:
 * this page or the whole project, and the page header's market or all
 * markets. The header owns the market itself; this only widens it.
 */
export function ScopeFilters({
  scope,
  onScope,
  choice,
  onChoice,
  hasMarket,
  loading
}: {
  scope: CommunityScope
  onScope: (scope: CommunityScope) => void
  choice: MarketChoice
  onChoice: (choice: MarketChoice) => void
  /** False when the header has no market: every market is all there is. */
  hasMarket: boolean
  loading: boolean
}): JSX.Element {
  return (
    <>
      <SegmentedControl
        label="Scope"
        size="sm"
        options={[
          { value: 'page', label: 'This page' },
          { value: 'project', label: 'Whole project' }
        ]}
        value={scope}
        onChange={onScope}
      />
      {hasMarket ? (
        <SegmentedControl
          label="Markets"
          size="sm"
          options={[
            { value: 'header', label: 'This market' },
            { value: 'all', label: 'All markets' }
          ]}
          value={choice}
          onChange={onChoice}
        />
      ) : null}
      {loading ? (
        <span role="status" className="cm-note">
          Loading communities…
        </span>
      ) : null}
    </>
  )
}

/** The filters above an empty list, which has no toolbar of its own. */
export function EmptyWithFilters({ children }: { children: ReactNode }): JSX.Element {
  const filters = useScopeToolbar()
  return (
    <>
      {filters ? <div className="cm-filters">{filters}</div> : null}
      {children}
    </>
  )
}
