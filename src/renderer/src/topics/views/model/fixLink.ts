import { pageFixIdOf } from '@shared/page-fixes'
import type { TopicRowState } from '@shared/domain/topics'
import type { Search } from './types'

const STATE: Readonly<Record<Search['result'], TopicRowState>> = {
  not_cited: 'not_cited',
  other_page: 'other_page',
  target: 'right_page',
  no_overview: 'no_aio',
  not_checked: 'not_checked'
}

function fixIdOf(search: Search): string | null {
  return pageFixIdOf({
    state: STATE[search.result],
    sourceId: search.sourceId,
    targetUrl: search.targetUrl,
    citedOwnUrl: search.pageCited
  })
}

/** The page fixes these searches roll up to in Fixes, by the rule Fixes itself uses. */
export function pageFixCount(searches: readonly Search[]): number {
  const ids = new Set<string>()
  for (const search of searches) {
    const id = fixIdOf(search)
    if (id) ids.add(id)
  }
  return ids.size
}

/**
 * The page fixes "Get fix brief" opens for these searches (the page fix drawer, over the
 * screen it was pressed on), by the rule Fixes itself uses: the fix holding the most of
 * them first. Empty when none of them needs a page fix.
 */
export function pageFixIdsFor(picked: readonly Search[]): string[] {
  const counts = new Map<string, number>()
  for (const search of picked) {
    const id = fixIdOf(search)
    if (id) counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  return [...counts].sort((a, b) => b[1] - a[1]).map(([id]) => id)
}
