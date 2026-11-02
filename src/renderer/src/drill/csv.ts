import type { PromptCheckRow } from '@shared/domain'
import type { GridCsvRequest } from '@shared/ipc'
import { csvFileName } from '../grid/model/labels'
import { aioLabel, stageLabel, statusLabel } from '../m3/model'
import type { DrillItem, DrillRequest, TopicDrill, TopicDrillRow } from './types'

/** File name base: the screen's name plus the drill id, such as `results-bucket-winning`. */
export function drillCsvName(drill: DrillRequest, now: Date): string {
  return csvFileName(`citefox-${drill.id}`, now)
}

function named(row: PromptCheckRow): string {
  if (row.named === null) return ''
  return row.named ? 'Yes' : 'No'
}

/**
 * Exactly the rows the drawer shows, in its order (REPORT-SPEC "CSV").
 * Main writes UTF-8 with a BOM and neutralizes formula text (`grid:exportCsv`).
 */
export function drillCsv(
  drill: DrillRequest,
  shown: readonly PromptCheckRow[] | readonly DrillItem[] | readonly TopicDrillRow[],
  now = new Date()
): GridCsvRequest {
  const { marketLabel, checkDateLabel } = drill.scope
  if (drill.kind === 'topic') return topicDrillCsv(drill, shown as readonly TopicDrillRow[], now)
  if (drill.kind === 'prompts') {
    const rows = shown as readonly PromptCheckRow[]
    return {
      fileName: drillCsvName(drill, now),
      header: [
        'Question #',
        'Question',
        'Stage',
        'AI Overview',
        'Status',
        'Cited URL',
        'Named',
        'Position',
        'Last checked',
        'Market',
        'Check'
      ],
      rows: rows.map((row) => [
        row.promptPosition,
        row.text.split('**').join(''),
        stageLabel(row.intentStage),
        aioLabel(row),
        statusLabel(row.status),
        row.citedUrl ?? '',
        named(row),
        row.position,
        row.checkedAt ?? '',
        marketLabel,
        checkDateLabel
      ])
    }
  }
  const items = shown as readonly DrillItem[]
  const columns = drill.columns ?? []
  const withSecondary = items.some((item) => item.secondary)
  return {
    fileName: drillCsvName(drill, now),
    header: [
      drill.primaryLabel,
      ...(withSecondary ? ['Detail'] : []),
      ...columns.map((column) => column.label),
      'Market',
      'Check'
    ],
    rows: items.map((item) => [
      item.url ?? item.primary,
      ...(withSecondary ? [item.secondary ?? ''] : []),
      ...columns.map((column) => item.cells?.[column.id] ?? null),
      marketLabel,
      checkDateLabel
    ])
  }
}

function yesNo(value: boolean | null): string {
  if (value === null) return ''
  return value ? 'Yes' : 'No'
}

/** A topic drawer's rows: the question, its stage, the page and who else is cited. */
export function topicDrillCsv(
  drill: TopicDrill,
  rows: readonly TopicDrillRow[],
  now = new Date()
): GridCsvRequest {
  const { marketLabel, checkDateLabel } = drill.scope
  const noun = drill.noun[0]
  return {
    fileName: drillCsvName(drill, now),
    header: [
      'Number',
      noun.charAt(0).toUpperCase() + noun.slice(1),
      'Stage',
      'Result',
      drill.view === 'cited' ? 'Cited page' : 'Target page',
      'Position',
      'Cited instead',
      'Named',
      'Win odds',
      'Market',
      'Check'
    ],
    rows: rows.map((row) => [
      row.label,
      row.text,
      row.stage,
      row.matchState,
      row.page ?? '',
      row.position,
      row.citedDomains.join(', '),
      yesNo(row.named),
      row.winOdds,
      marketLabel,
      checkDateLabel
    ])
  }
}
