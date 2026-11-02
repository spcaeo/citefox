import { countOf, isCitedRow } from './counts'
import { pageKey } from './pages'
import type { MetricCount, MetricRow, MetricsResult } from './types'

/**
 * Did the published pages do it? (Docs/METRICS.md "Published pages", Impact review
 * Verdict). Every id is a `to` row's, so each number opens the questions as they stand now.
 *
 * - `published` / `rest`: questions citing a published page, and questions citing any
 *   other page of yours, at each end. A question citing both counts in both.
 * - `gained`: compared questions that started citing you; `gainedVia`: of those, the ones
 *   citing a published page now; `gainedOnly`: of those, the ones citing no other page of
 *   yours now (they cite you only because of a published page).
 *
 * Without a comparison (or with one check) the `before` sides are null and the gained sets
 * are empty.
 */
export interface Attribution {
  published: { before: MetricCount | null; after: MetricCount }
  rest: { before: MetricCount | null; after: MetricCount }
  gained: MetricCount
  gainedVia: MetricCount
  gainedOnly: MetricCount
}

/** Every page of yours a row cites; an All engines row reads its parts. */
export function ownUrlsOf(metrics: Pick<MetricsResult, 'rows'>, row: MetricRow): string[] {
  if (!isCitedRow(row)) return []
  const out = new Set<string>()
  const add = (item: MetricRow): void => {
    if (!isCitedRow(item)) return
    for (const url of item.ownUrls ?? (item.citedUrl === null ? [] : [item.citedUrl])) {
      out.add(url)
    }
  }
  add(row)
  for (const id of row.parts ?? []) {
    const part = metrics.rows[id]
    if (part !== undefined) add(part)
  }
  return [...out]
}

export function attributionOf(metrics: MetricsResult): Attribution {
  const published = new Set(metrics.pages.published.ids.map(pageKey))
  const split = (row: MetricRow | undefined): { pub: boolean; rest: boolean } => {
    if (row === undefined) return { pub: false, rest: false }
    const keys = ownUrlsOf(metrics, row).map(pageKey)
    return {
      pub: keys.some((key) => published.has(key)),
      rest: keys.some((key) => !published.has(key))
    }
  }
  const comparing = metrics.comparison !== null && metrics.checks.length >= 2
  const toIds = comparing ? (metrics.comparison?.compared.ids ?? []) : metrics.now.checked.ids
  const pubAfter: string[] = []
  const restAfter: string[] = []
  const pubBefore: string[] = []
  const restBefore: string[] = []
  const gained: string[] = []
  const via: string[] = []
  const only: string[] = []
  for (const id of toIds) {
    const now = split(metrics.rows[id])
    if (now.pub) pubAfter.push(id)
    if (now.rest) restAfter.push(id)
    if (!comparing) continue
    const fromId = metrics.fromOf[id]
    const fromRow = fromId === undefined ? undefined : metrics.rows[fromId]
    const then = split(fromRow)
    if (then.pub) pubBefore.push(id)
    if (then.rest) restBefore.push(id)
    const toRow = metrics.rows[id]
    if (toRow !== undefined && fromRow !== undefined && isCitedRow(toRow) && !isCitedRow(fromRow)) {
      gained.push(id)
      if (now.pub) {
        via.push(id)
        if (!now.rest) only.push(id)
      }
    }
  }
  return {
    published: { before: comparing ? countOf(pubBefore) : null, after: countOf(pubAfter) },
    rest: { before: comparing ? countOf(restBefore) : null, after: countOf(restAfter) },
    gained: countOf(gained),
    gainedVia: countOf(via),
    gainedOnly: countOf(only)
  }
}
