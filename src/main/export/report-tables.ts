import type { ReportSectionId } from '@shared/domain'
import type { ExportTable } from './cells'
import type { ReportModel } from './model/types'
import {
  finishTables,
  tableContext,
  type DraftTable,
  type TableContext
} from './report-tables/build'
import {
  answerShapeTables,
  contentGapsTables,
  promptsTable,
  referencesTable,
  sourcesTables,
  universeTables
} from './report-tables/detail'
import {
  competitionTables,
  overviewTables,
  pagesTables,
  reputationTables,
  trendsTables
} from './report-tables/summary'
import { topicCoverageTables } from './report-tables/topics'

/**
 * The XLSX sheets and CSV files of a report (Docs/REPORT-SPEC.md "Other outputs"),
 * built only from the report model: one table per section table, in report order, for
 * the sections in `model.sections`. A section with no data gets one row that says why.
 * `prompts` adds the Prompts table and the Raw references table.
 */

export interface ReportTableOptions {
  /** Split the Prompts and Raw references tables into one table per market. */
  sheetPerMarket?: boolean
}

const SECTION_TABLES: Record<
  Exclude<ReportSectionId, 'prompts'>,
  (context: TableContext) => DraftTable[]
> = {
  overview: overviewTables,
  topic_coverage: topicCoverageTables,
  pages: pagesTables,
  competition: competitionTables,
  reputation: reputationTables,
  trends: trendsTables,
  universe: universeTables,
  sources: sourcesTables,
  answer_shape: answerShapeTables,
  content_gaps: contentGapsTables
}

export function buildReportTables(
  model: ReportModel,
  options: ReportTableOptions = {}
): ExportTable[] {
  const context = tableContext(model)
  const drafts: DraftTable[] = []
  for (const section of model.sections) {
    if (section === 'prompts')
      drafts.push(...promptTables(context, options.sheetPerMarket === true))
    else drafts.push(...SECTION_TABLES[section](context))
  }
  return finishTables(drafts)
}

function promptTables(context: TableContext, perMarket: boolean): DraftTable[] {
  const { model } = context
  if (!perMarket || model.markets.length < 2) {
    return [
      promptsTable(context, model.rows, 'prompts', 'Prompts'),
      referencesTable(context, model.references, 'raw-references', 'Raw references')
    ]
  }
  const prompts: DraftTable[] = []
  const references: DraftTable[] = []
  for (const market of model.markets) {
    const rows = model.rows.filter((row) => row.marketId === market.id)
    const ids = new Set(rows.map((row) => row.id))
    const code = market.code.toLowerCase()
    prompts.push(promptsTable(context, rows, `prompts-${code}`, `Prompts ${market.label}`))
    references.push(
      referencesTable(
        context,
        model.references.filter((reference) => ids.has(reference.rowId)),
        `raw-references-${code}`,
        `Raw references ${market.label}`
      )
    )
  }
  return [...prompts, ...references]
}
