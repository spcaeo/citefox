import { ENGINE_SHORT_LABEL, type EngineId } from '@shared/domain'
import type { MetricsResult } from '@shared/ipc'
import type { MetricRow, MetricResult } from '@shared/metrics'
import type { WidgetEngine } from '@shared/summary-board'
import type { DrillItem, DrillScope, DrillTarget, ItemDrill } from '../../drill'
import type { VisibilityOverview } from '@shared/ipc'

/**
 * Drills over the shared metrics rows: every widget number opens exactly the rows it
 * counts (`MetricCount.ids`), so the drawer total equals the number. Pure.
 */

export const RESULT_WORD: Readonly<Record<MetricResult, string>> = {
  target: 'Cited, right page',
  other: 'Cited, another page',
  not_cited: 'Not cited',
  no_answer: 'No AI answer',
  failed: 'Not checked'
}

/**
 * The engine words for a title: "on ChatGPT", or "on any engine" (under All a question
 * is cited when any engine cites you).
 */
export function engineWords(engine: WidgetEngine): string {
  return engine === 'all' ? 'on any engine' : `on ${ENGINE_SHORT_LABEL[engine]}`
}

/** The prompt id at the end of a row id (`<engine>:<run>:<prompt>`). */
export function promptIdOf(row: Pick<MetricRow, 'id'>): string | null {
  const parts = row.id.split(':')
  return parts.length >= 3 ? (parts.slice(2).join(':') ?? null) : null
}

/** Where a metrics row opens: its question on a page, or its topic. */
export function rowTarget(row: MetricRow): DrillTarget | null {
  if (row.sourceKind === 'topic') {
    return { kind: 'topic', topicId: row.sourceId, marketId: row.marketId }
  }
  const promptId = promptIdOf(row)
  if (promptId === null) return null
  return { kind: 'prompt', pageId: row.sourceId, promptId, marketId: row.marketId }
}

function engineOf(row: MetricRow): string {
  return row.engine === 'all' ? 'Every engine' : ENGINE_SHORT_LABEL[row.engine as EngineId]
}

function rowItem(row: MetricRow): DrillItem {
  return {
    id: row.id,
    primary: row.text || 'Question',
    target: rowTarget(row),
    cells: { engine: engineOf(row), result: RESULT_WORD[row.result] },
    group: row.result === 'target' || row.result === 'other' ? 'cited' : 'not'
  }
}

/** Every row a `rows` record names, in the order given (unknown ids are left out). */
export function rowsOf(result: Pick<MetricsResult, 'rows'>, ids: readonly string[]): MetricRow[] {
  const out: MetricRow[] = []
  const seen = new Set<string>()
  for (const id of ids) {
    const row = result.rows[id]
    if (row === undefined || seen.has(id)) continue
    seen.add(id)
    out.push(row)
  }
  return out
}

export function widgetScope(data: VisibilityOverview, marketLabel: string): DrillScope {
  return {
    pageId: null,
    marketId: data.marketId,
    runId: null,
    marketLabel,
    checkDateLabel: 'Latest checks',
    brand: data.brand,
    domain: data.domain
  }
}

/** The questions behind a metrics count. */
export function metricRowsDrill(
  rows: readonly MetricRow[],
  copy: { id: string; title: string; description: string; insight?: string | null },
  scope: DrillScope
): ItemDrill {
  return {
    kind: 'items',
    id: copy.id,
    title: copy.title,
    description: copy.description,
    insight: copy.insight ?? null,
    noun: ['question', 'questions'],
    primaryLabel: 'Question',
    columns: [
      { id: 'engine', label: 'Engine', width: 'minmax(96px, 0.4fr)' },
      { id: 'result', label: 'Result', width: 'minmax(132px, 0.5fr)' }
    ],
    items: rows.map(rowItem),
    note: 'Select a question to open it.',
    scope
  }
}
