import type { JSX } from 'react'
import { BusyMark, formatElapsed, useNow, type BusyState } from '../../ui'
import {
  competitorsSoFar,
  searchesNeedAttention,
  siteNamedOnly,
  type ProductSearch,
  type ReadLive
} from './readLive'
import './read-live.css'

/**
 * Step 3's competitor searches, one line per product (waiting its turn, searching with its
 * time, ✓ how many found, or ⚠ didn't finish with "Try again"), then the competitors found
 * so far and the rivals the site names that no search has listed yet. Step 6 shows the
 * same lines while a search is still open.
 */
export function SearchLines({
  live,
  now,
  onRetry,
  showFound = true
}: {
  live: ReadLive
  /** Epoch ms, for the running searches' times. */
  now: number
  onRetry: (productId: string) => void
  /** False: the product lines only (step 6 lists the competitors itself). */
  showFound?: boolean
}): JSX.Element {
  const found = competitorsSoFar(live)
  const named = siteNamedOnly(live)
  return (
    <div className="obs-live">
      <ul className="obs-searches" aria-label="Competitor searches, one per product">
        {live.searches.map((search) => (
          <li key={search.id} className={`obs-search obs-search-${search.state}`}>
            <BusyMark state={MARK[search.state]} size="sm" label={MARK_LABEL[search.state]} />
            <span className="obs-search-name">{search.name}</span>
            <span className="obs-search-state">
              {searchText(search, now)}
              {search.state === 'failed' ? (
                <button
                  type="button"
                  className="obs-link"
                  aria-label={`Try again: ${search.name}`}
                  onClick={() => onRetry(search.id)}
                >
                  Try again
                </button>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
      {showFound && found.length > 0 ? (
        <div className="obs-found">
          <p className="obs-found-title">Competitors so far ({found.length})</p>
          <ul className="obs-names" aria-label="Competitors found so far">
            {found.map((row) => (
              <li key={row.id}>{row.name}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {showFound && named.length > 0 ? (
        <p className="obs-named">
          {found.length > 0
            ? 'Your site also compares itself with'
            : 'Your site compares itself with'}
          : {named.join(', ')}
        </p>
      ) : null}
    </div>
  )
}

const MARK: Record<ProductSearch['state'], BusyState> = {
  waiting: 'waiting',
  running: 'running',
  done: 'done',
  failed: 'warning'
}

const MARK_LABEL: Record<ProductSearch['state'], string> = {
  waiting: 'Waiting',
  running: 'Searching',
  done: 'Done',
  failed: 'Did not finish'
}

function searchText(search: ProductSearch, now: number): string {
  const time = search.startedAt === null ? '' : ` · ${formatElapsed(now - search.startedAt)}`
  switch (search.state) {
    case 'waiting':
      return 'Waiting its turn'
    case 'running':
      return `${search.retried ? 'Trying again' : 'Searching the web'}${time}`
    case 'done':
      return search.competitors.length === 0
        ? 'No competitors found'
        : `${search.competitors.length} found`
    case 'failed':
      return `Didn’t finish. ${search.note ?? ''}`.trim()
  }
}

/**
 * The competitor searches still open or not finished after step 3 moved on (step 3's
 * done view and step 6): the product lines with "Try again". Nothing when all are done.
 */
export function OpenSearches({
  live,
  onRetry
}: {
  live: ReadLive
  onRetry: (productId: string) => void
}): JSX.Element | null {
  const open = live.searches.some(
    (search) => search.state === 'running' || search.state === 'waiting'
  )
  const now = useNow(open)
  if (!searchesNeedAttention(live)) return null
  return (
    <section className="obs-open-searches" aria-label="Competitor searches">
      <p>
        {open
          ? 'Still searching the web for competitors. What they find is added to the list when it comes in.'
          : 'A competitor search didn’t finish. Try it again, or go on with what was found.'}
      </p>
      <SearchLines live={live} now={now} onRetry={onRetry} showFound={false} />
    </section>
  )
}
