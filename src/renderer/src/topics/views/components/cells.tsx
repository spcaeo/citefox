import type { JSX } from 'react'
import { CitedSites } from '../../../components/CitedSites'
import { ResultDot, UrlText, useResultWords } from '../../../ui'
import { pathOf, resultLabel, type Search, type SearchFilter, type Totals } from '../model'
import { liveText, pctText } from './text'

/** A search's result: its colour dot and the short word. Not checked has no dot. */
export function ResultCell({
  result,
  live
}: {
  result: Search['result']
  live?: Search['live']
}): JSX.Element {
  const words = useResultWords()
  return (
    <span className="tv-result" data-result={result}>
      {result === 'not_checked' ? null : <ResultDot result={result} />}
      {liveText(live ?? null) ?? resultLabel(result, words)}
    </span>
  )
}

/** The own page Google cited (copy and open), else the sites cited instead, else a dash. */
export function CitedCell({ search, site }: { search: Search; site: string | null }): JSX.Element {
  const words = useResultWords()
  if (search.pageCited) return <UrlText path={pathOf(search.pageCited)} site={site} icon={false} />
  if (search.result === 'no_overview') return <span className="tv-muted">{words.none}</span>
  const live = liveText(search.live ?? null)
  if (live) {
    return (
      <span className="tv-muted" title={search.liveWords}>
        {live}
      </span>
    )
  }
  if (search.citedInstead.length > 0) return <CitedSites names={search.citedInstead} />
  return <span className="tv-muted">—</span>
}

/** "Q12 ·" the search's number, quiet. */
export function RefCell({ search }: { search: Search }): JSX.Element {
  return <span className="tv-ref num">{search.ref}</span>
}

/** A count that opens its drill. Zero stays plain. */
export function CountLink({
  count,
  filter,
  drillHref,
  label,
  className
}: {
  count: number
  filter: SearchFilter
  drillHref: (filter: SearchFilter) => string
  /** The accessible name: "Problem · Not cited: open these 14 searches". */
  label: string
  className?: string
}): JSX.Element {
  if (count === 0) return <span className={['num', className ?? ''].join(' ')}>0</span>
  return (
    <a
      className={['tv-count num', className ?? ''].join(' ')}
      href={drillHref(filter)}
      aria-label={label}
      title={label}
    >
      {count.toLocaleString('en-US')}
    </a>
  )
}

/**
 * A total's "Target cited" share that opens the searches behind it (`result: target`
 * on top of the row's own filter). With none cited it stays plain, like a zero count.
 */
export function TargetPctLink({
  totals,
  filter,
  drillHref,
  label
}: {
  totals: Pick<Totals, 'targetPct' | 'counts'>
  filter: SearchFilter
  drillHref: (filter: SearchFilter) => string
  /** The row's name: "Problem", "All". */
  label: string
}): JSX.Element {
  const text = pctText(totals.targetPct)
  const count = totals.counts.target
  if (count === 0) return <span className="num">{text}</span>
  const name = `${label} · Target cited ${text}: open these ${count.toLocaleString('en-US')} ${count === 1 ? 'search' : 'searches'}`
  return (
    <a
      className="tv-count num"
      href={drillHref({ ...filter, result: 'target' })}
      aria-label={name}
      title={name}
    >
      {text}
    </a>
  )
}

/**
 * CiteFox AI's best page for a search with its fit ("/nagios-alerts/ · 94% fit"); the
 * reason on hover. "No page fits" when none does; a dash before matching.
 */
export function BestPageCell({
  search,
  site
}: {
  search: Search
  site: string | null
}): JSX.Element {
  const best = search.bestPage
  if (!best) return <span className="tv-muted">—</span>
  if (best.url === null)
    return (
      <span className="tv-muted" title={best.reason}>
        No page fits
      </span>
    )
  return (
    <span className="tv-best" title={best.reason}>
      <UrlText path={pathOf(best.url)} site={site} icon={false} />
      {best.fit === null ? null : <span className="tv-muted num"> · {best.fit}% fit</span>}
    </span>
  )
}
