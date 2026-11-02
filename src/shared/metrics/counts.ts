import type {
  Comparison,
  Decomposition,
  Excluded,
  MetricCount,
  MetricPair,
  MetricRow,
  Movement,
  SideCounts
} from './types'

/** The one rule for what each result means; every count below reads these. */
export function isMeasured(row: Pick<MetricRow, 'result'>): boolean {
  return row.result !== 'failed'
}

export function isAnswered(row: Pick<MetricRow, 'result'>): boolean {
  return row.result === 'target' || row.result === 'other' || row.result === 'not_cited'
}

export function isCitedRow(row: Pick<MetricRow, 'result'>): boolean {
  return row.result === 'target' || row.result === 'other'
}

export function isNamedRow(row: Pick<MetricRow, 'result' | 'named'>): boolean {
  return isAnswered(row) && row.named
}

/** An answer showed that neither cites nor names you. */
export function isNotVisible(row: Pick<MetricRow, 'result' | 'named'>): boolean {
  return isAnswered(row) && !isCitedRow(row) && !row.named
}

export function isFirstSource(row: Pick<MetricRow, 'result' | 'position'>): boolean {
  return isCitedRow(row) && row.position === 1
}

/** A count from ids, each id once, in first-seen order. */
export function countOf(ids: Iterable<string>): MetricCount {
  const seen = new Set<string>()
  const list: string[] = []
  for (const id of ids) {
    if (seen.has(id)) continue
    seen.add(id)
    list.push(id)
  }
  return { n: list.length, ids: list }
}

export function countRows(
  rows: readonly MetricRow[],
  predicate: (row: MetricRow) => boolean = () => true
): MetricCount {
  return countOf(rows.filter(predicate).map((row) => row.id))
}

/** part ÷ whole, null when whole is 0. */
export function rateOf(part: number, whole: number): number | null {
  return whole === 0 ? null : part / whole
}

export function sideCounts(rows: readonly MetricRow[]): SideCounts {
  const answered = countRows(rows, isAnswered)
  const cited = countRows(rows, isCitedRow)
  return {
    checked: countRows(rows),
    measured: countRows(rows, isMeasured),
    failed: countRows(rows, (row) => !isMeasured(row)),
    answered,
    noAnswer: countRows(rows, (row) => row.result === 'no_answer'),
    cited,
    target: countRows(rows, (row) => row.result === 'target'),
    other: countRows(rows, (row) => row.result === 'other'),
    notCited: countRows(rows, (row) => row.result === 'not_cited'),
    named: countRows(rows, isNamedRow),
    notVisible: countRows(rows, isNotVisible),
    first: countRows(rows, isFirstSource),
    rate: rateOf(cited.n, answered.n)
  }
}

/** A pair measured at both ends: the only pairs a before → after number counts. */
export interface ComparedPair extends MetricPair {
  from: MetricRow
}

export function isCompared(pair: MetricPair): pair is ComparedPair {
  return pair.from !== null && isMeasured(pair.from) && isMeasured(pair.to)
}

export type Change = 'gained' | 'kept' | 'lost' | 'never'

export function changeOf(pair: ComparedPair): Change {
  const before = isCitedRow(pair.from)
  const after = isCitedRow(pair.to)
  if (after) return before ? 'kept' : 'gained'
  return before ? 'lost' : 'never'
}

/** How each compared question moved. Ids are the `to` rows'. */
export function movementOf(pairs: readonly ComparedPair[]): Movement {
  const ids = (predicate: (pair: ComparedPair) => boolean): MetricCount =>
    countOf(pairs.filter(predicate).map((pair) => pair.to.id))
  const never = (pair: ComparedPair): boolean => changeOf(pair) === 'never'
  return {
    gained: ids((pair) => changeOf(pair) === 'gained'),
    kept: ids((pair) => changeOf(pair) === 'kept'),
    lost: ids((pair) => changeOf(pair) === 'lost'),
    notCited: ids((pair) => never(pair) && isAnswered(pair.to)),
    noAnswer: ids((pair) => never(pair) && !isAnswered(pair.to)),
    never: ids(never),
    newAnswers: ids((pair) => !isAnswered(pair.from) && isAnswered(pair.to)),
    goneAnswers: ids((pair) => isAnswered(pair.from) && !isAnswered(pair.to)),
    namedBefore: ids((pair) => isNamedRow(pair.from)),
    namedAfter: ids((pair) => isNamedRow(pair.to))
  }
}

/**
 * Market vs your work. `market` = (answers after − answers before) × your rate before:
 * what the change would have been had you kept winning the same share of answers.
 * `work` = the rest. Rounded to tenths, `work` taking what `market` leaves, so the two
 * add up exactly. Without answers before, the rate is unknown and `market` is 0.
 */
export function decompose(
  before: SideCounts,
  after: SideCounts,
  movement: Movement
): Decomposition {
  const total = after.cited.n - before.cited.n
  const rateBefore = before.rate
  const raw = rateBefore === null ? 0 : (after.answered.n - before.answered.n) * rateBefore
  const marketTenths = Math.round(raw * 10) || 0
  const workTenths = total * 10 - marketTenths
  return {
    total,
    market: marketTenths / 10,
    work: workTenths / 10,
    marketTenths,
    workTenths,
    rateBefore,
    rateAfter: after.rate,
    marketIds: [...movement.newAnswers.ids, ...movement.goneAnswers.ids],
    workIds: [...movement.gained.ids, ...movement.lost.ids]
  }
}

export function excludedOf(pairs: readonly MetricPair[], noAfter: readonly MetricRow[]): Excluded {
  return {
    noBefore: countOf(pairs.filter((pair) => pair.from === null).map((pair) => pair.to.id)),
    noAfter: countRows(noAfter),
    failed: countOf(
      pairs.filter((pair) => pair.from !== null && !isCompared(pair)).map((pair) => pair.to.id)
    )
  }
}

/** Every before → after number of one window. */
export function compare(pairs: readonly MetricPair[], noAfter: readonly MetricRow[]): Comparison {
  const compared = pairs.filter(isCompared)
  const before = sideCounts(compared.map((pair) => pair.from))
  const after = sideCounts(compared.map((pair) => pair.to))
  const movement = movementOf(compared)
  return {
    compared: countOf(compared.map((pair) => pair.to.id)),
    before,
    after,
    movement,
    decomposition: decompose(before, after, movement),
    excluded: excludedOf(pairs, noAfter)
  }
}
