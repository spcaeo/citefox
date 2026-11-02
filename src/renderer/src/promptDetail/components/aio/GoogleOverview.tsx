import { useMemo, useState, type JSX } from 'react'
import type { AioOverview } from '@shared/aio-overview'
import type { BrandLens } from '@shared/brand-mentions'
import type { AioReference } from '@shared/domain'
import { OverviewBlocks } from './OverviewBlocks'
import { SourcesRail } from './SourcesRail'
import { CitationContext, sameRefs, sourceViews, type CitationContextValue } from './model'

/**
 * The overview laid out as Google shows it: the "AI Overview" label, the
 * blocks with chain-link citations, and the sources rail beside them.
 */
export function GoogleOverview({
  overview,
  references,
  lens = null
}: {
  overview: AioOverview
  /** The sample's scored sources, for the This page, Own page and Competitor chips. */
  references: readonly AioReference[]
  /** Brand names and the own site, marked in yellow in the text and the sources. */
  lens?: BrandLens | null
}): JSX.Element {
  const views = useMemo(
    () => sourceViews(overview.sources, references),
    [overview.sources, references]
  )
  const [active, setActive] = useState<readonly number[]>([])
  const context = useMemo<CitationContextValue>(
    () => ({
      sources: new Map(views.map((view) => [view.source.index, view])),
      active,
      onCite: (refs) => setActive((current) => (sameRefs(current, refs) ? [] : [...refs])),
      lens
    }),
    [views, active, lens]
  )
  return (
    <CitationContext.Provider value={context}>
      <div className={views.length > 0 ? 'aio-g' : 'aio-g aio-g-solo'}>
        <div className="aio-g-text">
          <p className="aio-g-head">
            <Sparkle />
            <span>AI Overview</span>
          </p>
          <OverviewBlocks blocks={overview.blocks} />
        </div>
        {views.length > 0 ? <SourcesRail views={views} active={active} lens={lens} /> : null}
      </div>
    </CitationContext.Provider>
  )
}

/** Google's four-point AI sparkle. */
export function Sparkle(): JSX.Element {
  return (
    <svg
      className="aio-sparkle"
      viewBox="0 0 24 24"
      width="20"
      height="20"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M12 2c.6 5.4 4.6 9.4 10 10-5.4.6-9.4 4.6-10 10-.6-5.4-4.6-9.4-10-10 5.4-.6 9.4-4.6 10-10z" />
    </svg>
  )
}
