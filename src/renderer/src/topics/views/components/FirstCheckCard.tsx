import type { JSX } from 'react'
import { Button, LinkButton, useResultWords } from '../../../ui'
import { compareSearches, pathOf, totalsOf, type Search } from '../model'

/**
 * The calm card after a first check that cites nothing yet (board FirstCheck): it is
 * normal, here are three steps, and "Start with Q<n>" opens the search with the best
 * win odds.
 */
export function FirstCheckCard({
  searches,
  targetUrl,
  nextCheck,
  pageFixes,
  fixesHref,
  onStart
}: {
  searches: readonly Search[]
  targetUrl: string | null
  /** "Nov 12" or similar; null when no check is scheduled. */
  nextCheck: string | null
  pageFixes: number
  fixesHref: string
  onStart: (search: Search) => void
}): JSX.Element {
  const words = useResultWords()
  const totals = totalsOf(searches)
  const best = searches.filter((search) => search.result === 'not_cited').sort(compareSearches)[0]
  const page = targetUrl ? pathOf(targetUrl) : 'the target page'
  const answered = words.engine
    ? `${words.engine} answered ${totals.withAio} of them`
    : `Google showed an AI Overview for ${totals.withAio} of them`
  return (
    <section className="ui-panel tv-first" aria-labelledby="tv-first-h">
      <h2 id="tv-first-h" className="tv-first-title">
        Not cited anywhere yet. That&apos;s normal for a first check.
      </h2>
      <p className="tv-first-body">
        All {totals.searches} searches were checked and nothing went wrong. {answered}, and none of
        the {totals.withAio} cite your site yet. Most new sites start here. This is your starting
        line, and every check from now on shows what changed.
      </p>
      <ol className="tv-first-steps">
        {best ? (
          <li>
            <b>Start with {best.ref}</b>
            {best.winOdds === null
              ? `: ${words.engine ?? 'Google'} answers it${words.engine ? '' : ' with an AI Overview'} and your page is not in it.`
              : `: it has the best win odds (${best.winOdds}).`}
          </li>
        ) : null}
        <li>Get the fix brief and update {page}.</li>
        <li>
          Mark it changed. The next check{nextCheck ? ` (${nextCheck})` : ''} tells you if it
          worked.
        </li>
      </ol>
      <div className="tv-first-actions">
        {best ? (
          <Button variant="primary" onClick={() => onStart(best)}>
            Start with {best.ref}
          </Button>
        ) : null}
        <LinkButton href={fixesHref} variant="ghost">
          or open Fixes ({pageFixes} {pageFixes === 1 ? 'page fix' : 'page fixes'})
        </LinkButton>
      </div>
    </section>
  )
}
