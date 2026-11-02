import { ENGINE_IDS } from '../domain/engines'
import { cleanHost } from '../competitor-hosts'
import { countRows, isAnswered, isCitedRow, rateOf, type ComparedPair } from './counts'
import type {
  BeforeAfter,
  DomainRow,
  EngineRow,
  MetricRow,
  SegmentDimension,
  SegmentRow
} from './types'
import { SEGMENT_DIMENSIONS } from './types'

/** The label of a question with no value for a lens. */
export const SEGMENT_NOT_SET = 'Not set'

/** The rows a breakdown reads: every `to` row, and the compared pairs (null: no comparison). */
export interface BreakdownInput {
  to: readonly MetricRow[]
  compared: readonly ComparedPair[] | null
}

/** One predicate counted now, before and after. */
export function beforeAfter(
  input: BreakdownInput,
  predicate: (row: MetricRow) => boolean
): BeforeAfter {
  const compared = input.compared
  return {
    now: countRows(input.to, predicate),
    before:
      compared === null
        ? null
        : countRows(
            compared.map((pair) => pair.from),
            predicate
          ),
    after:
      compared === null
        ? null
        : countRows(
            compared.map((pair) => pair.to),
            predicate
          )
  }
}

/** The same input narrowed to rows (and pairs, by their `to` row) that match. */
export function narrow(input: BreakdownInput, match: (row: MetricRow) => boolean): BreakdownInput {
  return {
    to: input.to.filter(match),
    compared: input.compared === null ? null : input.compared.filter((pair) => match(pair.to))
  }
}

function changeOf(value: BeforeAfter): number | null {
  return value.before === null || value.after === null ? null : value.after.n - value.before.n
}

export function segmentValue(row: MetricRow, dimension: SegmentDimension): string {
  const value = row.segments[dimension]
  return value === null || value.trim().length === 0 ? SEGMENT_NOT_SET : value
}

/** Results by one lens. Most questions first, then by name; "Not set" last. */
export function segmentRows(input: BreakdownInput, dimension: SegmentDimension): SegmentRow[] {
  const values = new Set<string>()
  for (const row of input.to) values.add(segmentValue(row, dimension))
  for (const pair of input.compared ?? []) values.add(segmentValue(pair.to, dimension))
  const rows = [...values].map((value): SegmentRow => {
    const part = narrow(input, (row) => segmentValue(row, dimension) === value)
    const answered = beforeAfter(part, isAnswered)
    const cited = beforeAfter(part, isCitedRow)
    return {
      value,
      questions: countRows(part.to),
      answered,
      cited,
      open: countRows(part.to, (row) => isAnswered(row) && !isCitedRow(row)),
      rateNow: rateOf(cited.now.n, answered.now.n),
      rateBefore:
        cited.before === null || answered.before === null
          ? null
          : rateOf(cited.before.n, answered.before.n),
      rateAfter:
        cited.after === null || answered.after === null
          ? null
          : rateOf(cited.after.n, answered.after.n)
    }
  })
  return rows.sort(
    (left, right) =>
      Number(left.value === SEGMENT_NOT_SET) - Number(right.value === SEGMENT_NOT_SET) ||
      right.questions.n - left.questions.n ||
      left.value.localeCompare(right.value)
  )
}

export function allSegments(input: BreakdownInput): Record<SegmentDimension, SegmentRow[]> {
  const out = {} as Record<SegmentDimension, SegmentRow[]>
  for (const dimension of SEGMENT_DIMENSIONS) out[dimension] = segmentRows(input, dimension)
  return out
}

function citesDomain(row: MetricRow, domain: string): boolean {
  return isAnswered(row) && row.domains.some((item) => cleanHost(item) === domain)
}

/** A site's best source position in one answer; null when not known. */
function sitePosition(row: MetricRow, domain: string): number | null {
  const positions = row.sitePositions
  if (positions === undefined) return null
  let best: number | null = null
  for (const [key, value] of Object.entries(positions)) {
    if (cleanHost(key) !== domain || !Number.isFinite(value)) continue
    if (best === null || value < best) best = value
  }
  return best
}

/** The average of known positions over the rows that match, one decimal; null: none known. */
function averagePosition(
  rows: readonly MetricRow[],
  match: (row: MetricRow) => boolean,
  positionOf: (row: MetricRow) => number | null
): number | null {
  let sum = 0
  let count = 0
  for (const row of rows) {
    if (!match(row)) continue
    const position = positionOf(row)
    if (position === null) continue
    sum += position
    count += 1
  }
  return count === 0 ? null : Math.round((sum / count) * 10) / 10
}

function positionOf(
  input: BreakdownInput,
  match: (row: MetricRow) => boolean,
  at: (row: MetricRow) => number | null
): DomainRow['position'] {
  const compared = input.compared
  return {
    now: averagePosition(input.to, match, at),
    before:
      compared === null
        ? null
        : averagePosition(
            compared.map((pair) => pair.from),
            match,
            at
          ),
    after:
      compared === null
        ? null
        : averagePosition(
            compared.map((pair) => pair.to),
            match,
            at
          )
  }
}

/**
 * Questions citing each site, you included (`own`, counted as cited questions). Most
 * cited now first; on a tie, you first, then by name.
 */
export function domainRows(input: BreakdownInput, ownDomain: string): DomainRow[] {
  const own = cleanHost(ownDomain)
  const domains = new Set<string>()
  const add = (row: MetricRow): void => {
    if (!isAnswered(row)) return
    for (const item of row.domains) {
      const domain = cleanHost(item)
      if (domain.length > 0 && domain !== own) domains.add(domain)
    }
  }
  input.to.forEach(add)
  for (const pair of input.compared ?? []) {
    add(pair.from)
    add(pair.to)
  }
  const rows: DomainRow[] = [...domains].map((domain) => {
    const cited = beforeAfter(input, (row) => citesDomain(row, domain))
    return {
      domain,
      own: false,
      cited,
      withYou: countRows(input.to, (row) => citesDomain(row, domain) && isCitedRow(row)),
      change: changeOf(cited),
      position: positionOf(
        input,
        (row) => citesDomain(row, domain),
        (row) => sitePosition(row, domain)
      )
    }
  })
  const ownCited = beforeAfter(input, isCitedRow)
  rows.push({
    domain: own,
    own: true,
    cited: ownCited,
    withYou: ownCited.now,
    change: changeOf(ownCited),
    position: positionOf(input, isCitedRow, (row) => row.position)
  })
  return rows.sort(
    (left, right) =>
      right.cited.now.n - left.cited.now.n ||
      Number(right.own) - Number(left.own) ||
      left.domain.localeCompare(right.domain)
  )
}

/** Sites that gained (most first) and lost (most first) between the two ends. */
export function domainMovers(rows: readonly DomainRow[]): {
  gained: DomainRow[]
  lost: DomainRow[]
} {
  const moved = rows.filter((row) => row.change !== null && row.change !== 0)
  return {
    gained: moved
      .filter((row) => (row.change ?? 0) > 0)
      .sort((a, b) => (b.change ?? 0) - (a.change ?? 0) || a.domain.localeCompare(b.domain)),
    lost: moved
      .filter((row) => (row.change ?? 0) < 0)
      .sort((a, b) => (a.change ?? 0) - (b.change ?? 0) || a.domain.localeCompare(b.domain))
  }
}

/** Answers and citations per engine, in the app's engine order; engines with no rows left out. */
export function engineRows(input: BreakdownInput): EngineRow[] {
  return ENGINE_IDS.flatMap((engine) => {
    const part = narrow(input, (row) => row.engine === engine)
    if (part.to.length === 0 && (part.compared ?? []).length === 0) return []
    return [
      { engine, answered: beforeAfter(part, isAnswered), cited: beforeAfter(part, isCitedRow) }
    ]
  })
}
