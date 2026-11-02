import { TOPIC_STAGE_LABEL, TOPIC_STAGES } from '@shared/domain'
import { shownResults, totalsOf } from './results'
import { filterSearches } from './searches'
import type { Grid, GridRow, Search, SearchFilter } from './types'

function row(
  id: string,
  label: string,
  searches: readonly Search[],
  filter: SearchFilter,
  results: Grid['results'],
  hint?: string
): GridRow {
  const totals = totalsOf(searches)
  return {
    id,
    label,
    ...(hint ? { hint } : {}),
    totals,
    filter,
    cells: results.map((result) => ({
      result,
      count: totals.counts[result],
      filter: { ...filter, result }
    }))
  }
}

/**
 * Stage × result counts: one row per stage with questions, "No stage" for questions
 * without one, "Keywords (no stage)", and the All row. Every row's cells add up to its
 * searches; every column adds up to the All row.
 */
export function stageGrid(searches: readonly Search[]): Grid {
  const results = shownResults(totalsOf(searches).counts)
  const questions = searches.filter((search) => search.kind === 'question')
  const rows: GridRow[] = []
  for (const stage of TOPIC_STAGES) {
    const mine = questions.filter((search) => search.stage === stage)
    if (mine.length > 0)
      rows.push(
        row(`stage:${stage}`, TOPIC_STAGE_LABEL[stage], mine, { stage, kind: 'question' }, results)
      )
  }
  const loose = questions.filter((search) => search.stage === null)
  if (loose.length > 0)
    rows.push(row('stage:none', 'No stage', loose, { stage: 'none', kind: 'question' }, results))
  const keywords = searches.filter((search) => search.kind === 'keyword')
  if (keywords.length > 0)
    rows.push(row('kw', 'Keywords', keywords, { kind: 'keyword' }, results, '(no stage)'))
  return { rows, all: row('all', 'All', searches, {}, results), results }
}

/**
 * Source × result counts for the Questions screen: one row per topic or page, in list
 * order, and the All row.
 */
export function sourceGrid(searches: readonly Search[]): Grid {
  const results = shownResults(totalsOf(searches).counts)
  const order: string[] = []
  const bySource = new Map<string, Search[]>()
  for (const search of searches) {
    const list = bySource.get(search.sourceId)
    if (list) list.push(search)
    else {
      bySource.set(search.sourceId, [search])
      order.push(search.sourceId)
    }
  }
  return {
    rows: order.map((sourceId) => {
      const mine = bySource.get(sourceId) ?? []
      return row(
        `source:${sourceId}`,
        mine[0]?.sourceName ?? sourceId,
        mine,
        { source: sourceId },
        results
      )
    }),
    all: row('all', 'All', searches, {}, results),
    results
  }
}

/** The best next move: the grid row with the most not-cited searches (ties: better odds). */
export interface NextMove {
  label: string
  /** The drill: that row's not-cited searches. */
  filter: SearchFilter
  count: number
  /** Average win odds of those searches. Null when none has odds. */
  winAvg: number | null
}

export function bestNextMove(grid: Grid, searches: readonly Search[]): NextMove | null {
  let best: NextMove | null = null
  for (const item of grid.rows) {
    const filter: SearchFilter = { ...item.filter, result: 'not_cited' }
    const mine = filterSearches(searches, filter)
    if (mine.length === 0) continue
    const winAvg = totalsOf(mine).winAvg
    if (
      best === null ||
      mine.length > best.count ||
      (mine.length === best.count && (winAvg ?? 0) > (best.winAvg ?? 0))
    )
      best = { label: item.label, filter, count: mine.length, winAvg }
  }
  return best
}
