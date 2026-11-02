import { ENGINE_IDS, type EngineId } from '../domain/engines'
import { isAnswered, isCitedRow } from './counts'
import type { MetricCheck, MetricResult, MetricRow, MetricSegments } from './types'

/**
 * "All engines", counted `once` (settings.ts): the rows of one question in one check, one
 * per engine, become a single `all` row. The rule, in plain words:
 * - cited when any engine's answer cites a page of yours (the target page wins over
 *   another page);
 * - answered when any engine shows an answer;
 * - failed only when every engine failed;
 * - your best (lowest) source position and its page; named when any answer names you;
 *   the other sites cited by any engine, each once.
 */

/** Best first: the merged row takes the best result any engine had. */
const RANK: Readonly<Record<MetricResult, number>> = {
  target: 0,
  other: 1,
  not_cited: 2,
  no_answer: 3,
  failed: 4
}

/** The id of the merged row of one question in one check. */
export function mergedId(row: Pick<MetricRow, 'questionId' | 'marketId' | 'checkId'>): string {
  return `all:${row.checkId}:${row.marketId}:${row.questionId}`
}

function groupKey(row: MetricRow): string {
  return `${row.sourceKind}|${row.sourceId}|${row.marketId}|${row.checkId}|${row.questionId}`
}

function mergedSegments(rows: readonly MetricRow[]): MetricSegments {
  const out = { ...rows[0]!.segments }
  for (const row of rows) {
    for (const key of Object.keys(out) as (keyof MetricSegments)[]) {
      if (out[key] === null && row.segments[key] !== null) out[key] = row.segments[key]
    }
  }
  return out
}

function mergeGroup(rows: readonly MetricRow[]): MetricRow {
  const first = rows[0]!
  const best = rows.reduce((top, row) => (RANK[row.result] < RANK[top.result] ? row : top))
  const cited = rows.filter(isCitedRow)
  const winner = cited
    .filter((row) => row.result === best.result)
    .reduce<MetricRow | null>(
      (top, row) =>
        top === null || (row.position ?? Infinity) < (top.position ?? Infinity) ? row : top,
      null
    )
  const positions = cited.flatMap((row) => (row.position === null ? [] : [row.position]))
  const ownUrls: string[] = []
  for (const row of cited) {
    for (const url of row.ownUrls ?? (row.citedUrl === null ? [] : [row.citedUrl])) {
      if (!ownUrls.includes(url)) ownUrls.push(url)
    }
  }
  const domains: string[] = []
  const sitePositions: Record<string, number> = {}
  for (const row of rows) {
    if (!isAnswered(row)) continue
    for (const domain of row.domains) if (!domains.includes(domain)) domains.push(domain)
    for (const [site, position] of Object.entries(row.sitePositions ?? {})) {
      const known = sitePositions[site]
      if (known === undefined || position < known) sitePositions[site] = position
    }
  }
  return {
    id: mergedId(first),
    questionId: first.questionId,
    text: rows.find((row) => row.text.length > 0)?.text ?? first.text,
    engine: 'all',
    marketId: first.marketId,
    sourceId: first.sourceId,
    sourceKind: first.sourceKind,
    checkId: first.checkId,
    checkedAt: rows.reduce((at, row) => (row.checkedAt > at ? row.checkedAt : at), ''),
    result: best.result,
    citedUrl: winner?.citedUrl ?? null,
    position: positions.length === 0 ? null : Math.min(...positions),
    ...(cited.length > 0 ? { ownUrls } : {}),
    domains,
    ...(Object.keys(sitePositions).length > 0 ? { sitePositions } : {}),
    named: rows.some((row) => isAnswered(row) && row.named),
    segments: mergedSegments(rows),
    parts: orderByEngine(rows).map((row) => row.id)
  }
}

function orderByEngine(rows: readonly MetricRow[]): MetricRow[] {
  const order = (row: MetricRow): number =>
    row.engine === 'all' ? -1 : ENGINE_IDS.indexOf(row.engine)
  return [...rows].sort((left, right) => order(left) - order(right))
}

/** One `all` row per question per check, in the order each question first appears. */
export function mergeEngines(rows: readonly MetricRow[]): MetricRow[] {
  const groups = new Map<string, MetricRow[]>()
  for (const row of rows) {
    const key = groupKey(row)
    const list = groups.get(key)
    if (list === undefined) groups.set(key, [row])
    else list.push(row)
  }
  return [...groups.values()].map(mergeGroup)
}

/** Engines with rows, in the app's engine order. */
export function enginesIn(rows: readonly MetricRow[]): EngineId[] {
  const seen = new Set<string>(rows.map((row) => row.engine))
  return ENGINE_IDS.filter((engine) => seen.has(engine))
}

/** Every check among the rows, oldest first. */
export function checksIn(rows: readonly MetricRow[]): MetricCheck[] {
  const byId = new Map<string, string>()
  for (const row of rows) {
    const known = byId.get(row.checkId)
    if (known === undefined || row.checkedAt > known) byId.set(row.checkId, row.checkedAt)
  }
  return [...byId]
    .map(([id, at]) => ({ id, at }))
    .sort((left, right) => left.at.localeCompare(right.at) || left.id.localeCompare(right.id))
}

/**
 * Pages and topics checked together finish a few minutes apart, so "the first check" is
 * every check that finished within {@link CHECK_SPAN_MS} of the earliest one: the moment
 * returned is the last of those. Null without checks.
 */
export const CHECK_SPAN_MS = 6 * 60 * 60 * 1000

export function firstCheckAt(checks: readonly MetricCheck[]): string | null {
  const first = checks[0]
  if (first === undefined) return null
  const limit = Date.parse(first.at) + CHECK_SPAN_MS
  let at = first.at
  for (const check of checks) if (Date.parse(check.at) <= limit && check.at > at) at = check.at
  return at
}
