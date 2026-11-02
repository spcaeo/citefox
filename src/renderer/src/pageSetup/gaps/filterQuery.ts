import { useCallback, useMemo } from 'react'
import {
  isCoverageAction,
  isCoverageLevel,
  isCoveragePriority,
  isIntentStage,
  isPromptSource
} from '@shared/domain'
import { patchHashQuery, useHashQuery } from '../../utils/hashQuery'
import { formatList, parseList, readQueryValue } from '../../utils/queryState'
import type { GapFilterState } from '../gapsFilter'

/**
 * The coverage matrix filters on the URL, so a filtered list is a link and Back
 * undoes a filter: `gf.q` (search, rewritten in place), `gf.cov`, `gf.pri`,
 * `gf.stage`, `gf.src`, `gf.act` (comma lists, each change a new entry).
 */
export const GAP_FILTER_KEYS = ['gf.q', 'gf.cov', 'gf.pri', 'gf.stage', 'gf.src', 'gf.act'] as const

function currentHash(): string {
  return typeof window === 'undefined' ? '' : window.location.hash
}

/** The filters in `hash`; unknown values are dropped. */
export function parseGapFilter(hash: string): GapFilterState {
  const list = (key: string): string[] => parseList(readQueryValue(hash, key))
  return {
    query: readQueryValue(hash, 'gf.q') ?? '',
    coverage: list('gf.cov').filter(isCoverageLevel),
    priority: list('gf.pri').filter(isCoveragePriority),
    stage: list('gf.stage').filter(isIntentStage),
    source: list('gf.src').filter(isPromptSource),
    action: list('gf.act').filter(isCoverageAction)
  }
}

/** The URL values for `filter` (null removes an empty one). */
export function gapFilterQuery(filter: GapFilterState): Record<string, string | null> {
  return {
    'gf.q': filter.query || null,
    'gf.cov': formatList(filter.coverage),
    'gf.pri': formatList(filter.priority),
    'gf.stage': formatList(filter.stage),
    'gf.src': formatList(filter.source),
    'gf.act': formatList(filter.action)
  }
}

/** `hash` carrying the filters of the URL now (a tab or row link keeps them). */
export function withGapFilter(hash: string): string {
  return patchHashQuery(hash, gapFilterQuery(parseGapFilter(currentHash())))
}

/** The matrix filters, following Back and Forward. */
export function useGapFilter(): [GapFilterState, (next: GapFilterState) => void] {
  const [values, setValues] = useHashQuery(GAP_FILTER_KEYS)
  // `values` keeps its identity until a filter value changes.
  const filter = useMemo(() => parseGapFilter(`#?${queryOf(values)}`), [values])
  const set = useCallback(
    (next: GapFilterState) => {
      const before = parseGapFilter(currentHash())
      const onlyQuery = (Object.keys(next) as (keyof GapFilterState)[]).every(
        (key) => key === 'query' || String(next[key]) === String(before[key])
      )
      setValues(gapFilterQuery(next), { replace: onlyQuery })
    },
    [setValues]
  )
  return [filter, set]
}

function queryOf(values: Readonly<Record<string, string | null>>): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(values)) if (value) params.set(key, value)
  return params.toString()
}
