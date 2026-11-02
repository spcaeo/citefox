import type { PdfExportOptions, ReportSectionId } from '@shared/domain'
import type { ReportModel } from '../model/types'
import {
  PDF_PROMPT_LIMIT,
  PDF_TABLE_LIMIT,
  blockContext,
  para,
  type BlockContext,
  type ReportBlock
} from './blocks'
import type { Speech } from './common'
import { answerShapeBlocks, contentGapsBlocks, promptsBlocks } from './report-sections/content'
import { competitionBlocks } from './report-sections/competition'
import { coverBlocks } from './report-sections/cover'
import { overviewBlocks } from './report-sections/overview'
import { pagesBlocks } from './report-sections/pages'
import { headlineBlocks, methodBlocks, nextStepsBlocks } from './report-sections/perspectives'
import { reputationBlocks, trendsBlocks } from './report-sections/trends'
import { sourcesBlocks, universeBlocks } from './report-sections/universe'
import { topicCoverageBlocks } from './report-sections/topic-coverage'

/**
 * The PDF report in the HTML report's section order and copy (Docs/REPORT-SPEC.md
 * "Other outputs"), built only from the report model. The cover and the headline are
 * always first, "What to do next" follows when there is evidence, and "How this report
 * was made" is last.
 */

const SECTION_BLOCKS: Record<ReportSectionId, (context: BlockContext) => void> = {
  overview: overviewBlocks,
  topic_coverage: topicCoverageBlocks,
  pages: pagesBlocks,
  competition: competitionBlocks,
  reputation: reputationBlocks,
  trends: trendsBlocks,
  universe: universeBlocks,
  sources: sourcesBlocks,
  answer_shape: answerShapeBlocks,
  content_gaps: contentGapsBlocks,
  prompts: promptsBlocks
}

export interface ReportBlockOptions {
  secrets: readonly string[]
  /** Rows shown before a table is cut. Tests use small limits. */
  tableLimit?: number
  promptLimit?: number
}

export function buildReportBlocks(
  model: ReportModel,
  pdf: PdfExportOptions,
  options: ReportBlockOptions
): { blocks: ReportBlock[]; speech: Speech } {
  const speech: Speech = { secrets: options.secrets, replaced: 0 }
  const context = blockContext(model, pdf, speech, {
    table: options.tableLimit ?? PDF_TABLE_LIMIT,
    prompts: options.promptLimit ?? PDF_PROMPT_LIMIT
  })
  coverBlocks(context)
  headlineBlocks(context)
  nextStepsBlocks(context)
  for (const section of model.sections) SECTION_BLOCKS[section](context)
  methodBlocks(context)
  if (speech.replaced > 0) {
    const noun = speech.replaced === 1 ? 'character' : 'characters'
    para(
      context,
      `${speech.replaced} ${noun} could not be drawn in this report's font and were replaced with ?.`,
      'muted'
    )
  }
  return { blocks: context.blocks, speech }
}

/** First lines of the report for the export preview: headings, text and top table rows. */
export function reportBlocksPreview(blocks: readonly ReportBlock[]): string {
  const lines: string[] = []
  for (const block of blocks) {
    lines.push(...previewLines(block))
    if (lines.join('\n').length > 1600) break
  }
  return lines.join('\n').slice(0, 2000)
}

function previewLines(block: ReportBlock): string[] {
  switch (block.kind) {
    case 'cover':
      return [
        block.title,
        block.scope,
        ...block.facts.map((fact) => `${fact.label}: ${fact.value}`)
      ]
    case 'section':
      return ['', block.title.toUpperCase()]
    case 'h2':
    case 'h3':
    case 'p':
      return [block.text]
    case 'kpis':
      return block.tiles.map((tile) => `${tile.label}: ${tile.value}`)
    case 'bars':
      return block.rows.map((row) => `${row.label}: ${row.display}`)
    case 'stacked':
      return block.rows.map((row) => `${row.label}: ${row.display}`)
    case 'line':
      return [`Chart: ${block.series.map((series) => series.label).join(', ')}`]
    case 'table':
      return [
        block.headers.join(' | '),
        ...block.rows.slice(0, 3).map((row) => row.join(' | ').replaceAll('\n', ' '))
      ]
    case 'empty':
      return [block.title, block.message]
    case 'list':
      return block.items.map((item, index) => `${index + 1}. ${item}`)
    case 'faq':
      return [block.question]
  }
}
