import type { MetricEngine, MetricPair, MetricRow, MetricScope, MetricWindow } from './types'

/**
 * Which rows count, and which row stands for each question at each end of the window.
 *
 * A question is the same question in the same market on the same engine. Its state at a
 * moment is read the way the screens read it (`engine/overview/timeline.ts`):
 * - a tracked page shows its newest check: only the rows of that check count, so a
 *   question dropped from the page's newer question set drops out;
 * - a topic keeps each question's newest result across its checks (batches check a few
 *   questions at a time).
 */

/** The identity of one question across checks. */
export function questionKey(row: Pick<MetricRow, 'questionId' | 'marketId' | 'engine'>): string {
  return `${row.questionId}|${row.marketId}|${row.engine}`
}

export function inScope(row: MetricRow, scope: MetricScope): boolean {
  if (scope.kind === 'project') return true
  if (scope.kind === 'topic') return row.sourceKind === 'topic' && row.sourceId === scope.id
  return row.sourceKind === 'page' && row.sourceId === scope.id
}

/** The rows of one scope, market and engine, in their given order. */
export function filterRows(
  rows: readonly MetricRow[],
  filter: { scope: MetricScope; marketId: string | null; engine: MetricEngine }
): MetricRow[] {
  return rows.filter(
    (row) =>
      inScope(row, filter.scope) &&
      (filter.marketId === null || row.marketId === filter.marketId) &&
      (filter.engine === 'all' || row.engine === filter.engine)
  )
}

export interface ResolvedWindow {
  /** Each question's row at the `to` end, in input order. */
  to: MetricRow[]
  /** One per `to` row; `from` null when the question has no row at the `from` end. */
  pairs: MetricPair[]
  /** Rows at the `from` end whose question has no row at the `to` end. */
  noAfter: MetricRow[]
}

/** The rows of one page or topic in one market on one engine. */
interface Stream {
  kind: 'page' | 'topic'
  rows: MetricRow[]
}

type Bound = { at: string; inclusive: boolean } | null

function before(row: MetricRow, bound: Bound): boolean {
  if (bound === null) return true
  return bound.inclusive ? row.checkedAt <= bound.at : row.checkedAt < bound.at
}

/** Newer check first on equal times by check id, so the order never depends on input order. */
function newer(left: MetricRow, right: MetricRow): boolean {
  if (left.checkedAt !== right.checkedAt) return left.checkedAt > right.checkedAt
  return left.checkId > right.checkId
}

/** The stream's state by question key, as of `bound`. */
function stateOf(stream: Stream, bound: Bound): Map<string, MetricRow> {
  const state = new Map<string, MetricRow>()
  if (stream.kind === 'page') {
    let latest: MetricRow | null = null
    for (const row of stream.rows) {
      if (before(row, bound) && (latest === null || newer(row, latest))) latest = row
    }
    if (latest === null) return state
    for (const row of stream.rows) {
      if (row.checkId === latest.checkId && before(row, bound)) state.set(questionKey(row), row)
    }
    return state
  }
  for (const row of stream.rows) {
    if (!before(row, bound)) continue
    const key = questionKey(row)
    const known = state.get(key)
    if (known === undefined || newer(row, known)) state.set(key, row)
  }
  return state
}

/** The newest check time among a state's rows. */
function latestAt(state: ReadonlyMap<string, MetricRow>): string | null {
  let at: string | null = null
  for (const row of state.values()) if (at === null || row.checkedAt > at) at = row.checkedAt
  return at
}

/** Each question's row at both ends of the window. Rows should already be filtered. */
export function resolveWindow(rows: readonly MetricRow[], window: MetricWindow): ResolvedWindow {
  const streams = new Map<string, Stream>()
  for (const row of rows) {
    const id = `${row.sourceKind}|${row.sourceId}|${row.marketId}|${row.engine}`
    const stream = streams.get(id) ?? { kind: row.sourceKind, rows: [] }
    stream.rows.push(row)
    streams.set(id, stream)
  }
  const toRows = new Map<string, MetricRow>()
  const fromRows = new Map<string, MetricRow>()
  const toBound: Bound = window.to === null ? null : { at: window.to, inclusive: true }
  for (const stream of streams.values()) {
    const end = stateOf(stream, toBound)
    for (const [key, row] of end) toRows.set(key, row)
    if (window.from === null) continue
    let fromBound: Bound
    if (window.from === 'previous') {
      const at = latestAt(end)
      if (at === null) continue
      fromBound = { at, inclusive: false }
    } else {
      fromBound = { at: window.from, inclusive: true }
    }
    for (const [key, row] of stateOf(stream, fromBound)) fromRows.set(key, row)
  }
  const toIds = new Set([...toRows.values()].map((row) => row.id))
  const to = rows.filter((row) => toIds.has(row.id))
  const pairs = to.map((row) => {
    const key = questionKey(row)
    return { key, from: fromRows.get(key) ?? null, to: row }
  })
  const noAfterIds = new Set(
    [...fromRows.entries()].filter(([key]) => !toRows.has(key)).map(([, row]) => row.id)
  )
  return { to, pairs, noAfter: rows.filter((row) => noAfterIds.has(row.id)) }
}
