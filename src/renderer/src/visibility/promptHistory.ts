import type { PageResults, PromptCheckRow, ResultsHistory } from '@shared/domain'
import { formatMonthDay, statusLabel } from '../m3/model'
import { marketDelta } from './progress'

export interface PromptColumn {
  runId: string
  at: string
  label: string
}

export interface DerivedPromptRow {
  id: string
  n: number
  label: string
  full: string
  cells: readonly { runId: string; text: string }[]
}

/** Full checks only, oldest first, from `results:history`. */
export function promptColumns(history: ResultsHistory): PromptColumn[] {
  return history.points
    .filter((point) => !point.partial)
    .map((point) => ({
      runId: point.runId,
      at: point.finishedAt,
      label: formatMonthDay(point.finishedAt)
    }))
}

/** One cell per full check. Missing prompts stay an em dash, never a filled-in status. */
export function promptRows(
  columns: readonly PromptColumn[],
  runs: ReadonlyMap<string, PageResults>
): DerivedPromptRow[] {
  const meta = new Map<string, { n: number; label: string; full: string }>()
  for (const column of columns) {
    const results = runs.get(column.runId)
    if (!results) continue
    for (const prompt of results.prompts) {
      meta.set(prompt.promptId, {
        n: prompt.promptPosition,
        label: prompt.label,
        full: prompt.text
      })
    }
  }
  const rows = [...meta.entries()].map(([id, row]) => ({
    id,
    n: row.n,
    label: row.label,
    full: row.full,
    cells: columns.map((column) => {
      const prompt = runs.get(column.runId)?.prompts.find((item) => item.promptId === id)
      return { runId: column.runId, text: prompt ? cellText(prompt) : '—' }
    })
  }))
  rows.sort((left, right) => left.n - right.n)
  return rows
}

function cellText(row: PromptCheckRow): string {
  if (row.status === 'page_cited') {
    return row.position === null ? 'Page cited' : `Page cited · ${row.position}`
  }
  if (row.status === 'other_own_page') {
    return row.position === null ? 'Own page' : `Own page · ${row.position}`
  }
  if (row.status === 'brand_mentioned') return 'Brand'
  if (row.status === 'no_aio') return 'No overview'
  return statusLabel(row.status)
}

export interface LiveMarketRow {
  id: string
  name: string
  /** One per full check. `runId` is that check. */
  columns: readonly { runId: string; label: string; value: string }[]
  scores: readonly (number | null)[]
  delta: string
  aria: string
  checks: readonly { id: string; label: string; value: string }[]
}

/** One market's visibility scores from that market's `results:history` points. */
export function liveMarket(id: string, name: string, history: ResultsHistory): LiveMarketRow {
  const points = history.points.filter((point) => !point.partial)
  const checks = points.map((point) => ({
    id: point.runId,
    label: formatMonthDay(point.finishedAt),
    value: point.visibilityScore === null ? '—' : String(point.visibilityScore)
  }))
  const scores = points.map((point) => point.visibilityScore)
  const deltaN = marketDelta(scores)
  const delta = deltaN === null ? '—' : deltaN > 0 ? `+${deltaN}` : String(deltaN)
  const listed = scores.filter((score): score is number => score !== null)
  return {
    id,
    name,
    columns: checks.map(({ id: runId, label, value }) => ({ runId, label, value })),
    scores,
    delta,
    aria:
      listed.length === 0
        ? `${name}, no check in this market yet`
        : `${name} visibility: ${listed.join(', ')}`,
    checks
  }
}
