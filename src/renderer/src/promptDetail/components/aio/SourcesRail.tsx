import { useEffect, useRef, useState, type JSX } from 'react'
import type { BrandLens } from '@shared/brand-mentions'
import { safeExternalUrl } from '../../../drill'
import { SiteIcon } from '../../../siteIcon/SiteIcon'
import { Chip, UrlText } from '../../../ui'
import { hostOf } from '../../../ui/urlTextModel'
import { KIND_TONE } from '../../constants'
import { sourceKind, sourceKindLabel } from '../../utils/model'
import { Marked } from './Marked'
import { SourceMark } from './SourceMark'
import { isOwnSource, type SourceView } from './model'

/** Cards shown before "Show all", as Google does. */
const RAIL_PREVIEW = 4

/**
 * Google's sources column beside the overview: site, title, snippet. CiteFox
 * adds the This page, Own page and Competitor chips from the scored sources, and
 * gives own-site cards a yellow accent with the brand and domain marked.
 */
export function SourcesRail({
  views,
  active,
  lens = null
}: {
  views: readonly SourceView[]
  /** References the last citation click marked. */
  active: readonly number[]
  lens?: BrandLens | null
}): JSX.Element {
  const [all, setAll] = useState(false)
  const listRef = useRef<HTMLUListElement>(null)
  const hiddenActive = views.slice(RAIL_PREVIEW).some((view) => active.includes(view.source.index))
  const expanded = all || hiddenActive || views.length <= RAIL_PREVIEW
  const shown = expanded ? views : views.slice(0, RAIL_PREVIEW)

  // Brings the first marked card into view after a citation click.
  useEffect(() => {
    const first = active[0]
    if (first === undefined) return
    const card = listRef.current?.querySelector(`[data-source-index="${first}"]`)
    card?.scrollIntoView?.({ block: 'nearest' })
  }, [active])

  return (
    <div className="aio-rail">
      <ul ref={listRef} className="aio-src-list" aria-label="Sources Google showed">
        {shown.map((view) => (
          <SourceCard
            key={view.source.index}
            view={view}
            active={active.includes(view.source.index)}
            lens={lens}
          />
        ))}
      </ul>
      {views.length > RAIL_PREVIEW && !hiddenActive ? (
        <button
          type="button"
          className="aio-rail-more"
          aria-expanded={expanded}
          onClick={() => setAll((value) => !value)}
        >
          {expanded ? 'Show fewer' : `Show all ${views.length}`}
        </button>
      ) : null}
    </div>
  )
}

function SourceCard({
  view,
  active,
  lens
}: {
  view: SourceView
  active: boolean
  lens: BrandLens | null
}): JSX.Element {
  const { source, name, reference } = view
  const href = safeExternalUrl(source.url)
  // Google shows the site's favicon here; main fetches it once (favicons:get).
  const host = href ? hostOf(href) : null
  const title = source.title ?? name
  const kind = reference ? sourceKind(reference) : 'other'
  const own = isOwnSource(view, lens)
  const className = ['aio-src', own ? 'is-own' : '', active ? 'is-active' : '']
    .filter(Boolean)
    .join(' ')
  return (
    <li
      className={className}
      data-source-index={source.index}
      aria-current={active ? 'true' : undefined}
    >
      <span className="aio-src-site">
        {host ? <SiteIcon domain={host} /> : <SourceMark name={name} />}
        <span className="aio-src-name">
          <Marked text={name} lens={lens} />
        </span>
        {href && host ? (
          <UrlText url={href} label={host} icon={false} className="aio-src-url" />
        ) : null}
        {reference && kind !== 'other' ? (
          <Chip size="sm" tone={KIND_TONE[kind]}>
            {sourceKindLabel(reference)}
          </Chip>
        ) : null}
      </span>
      {href ? (
        <a className="aio-src-title" href={href} target="_blank" rel="noopener noreferrer">
          <Marked text={title} lens={lens} />
          <span className="sr-only"> (opens in your browser)</span>
        </a>
      ) : (
        <span className="aio-src-title">
          <Marked text={title} lens={lens} />
        </span>
      )}
      {source.snippet ? (
        <span className="aio-src-snippet">
          <Marked text={source.snippet} lens={lens} />
        </span>
      ) : null}
    </li>
  )
}
