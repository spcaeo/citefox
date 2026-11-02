import { REPORT_SECTION_COPY, TOPIC_COVERAGE_COPY } from '@shared/report-copy'
import type { TopicCoverageKeywordRow, TopicCoverageTopic } from '../../model/types'
import {
  emptyBlock,
  grouped,
  h2,
  h3,
  para,
  pctText,
  section,
  table,
  type BlockContext
} from '../blocks'
import { plainTile } from './pages'

const C = TOPIC_COVERAGE_COPY
const COL = C.columns

/** Topic coverage in the PDF, in the HTML report's order and copy. */
export function topicCoverageBlocks(context: BlockContext): void {
  const copy = REPORT_SECTION_COPY.topic_coverage
  section(context, copy.title, copy.description)
  const coverage = context.model.topicCoverage
  if (coverage === undefined || coverage.empty !== null) {
    emptyBlock(context, coverage?.empty ?? { ...C.empty })
    return
  }
  for (const topic of coverage.topics) topicBlocks(context, topic, coverage.topics.length > 1)
}

function topicBlocks(context: BlockContext, topic: TopicCoverageTopic, many: boolean): void {
  if (many) h2(context, topic.name)
  para(context, `${topic.sourceLine} · ${topic.marketLabel}`, 'muted')
  h3(context, C.executive)
  para(context, topic.executive, 'lead')
  para(context, topic.executiveSaved ? C.executiveSaved : C.executiveBuilt, 'muted')
  if (topic.nextActions.length > 0) {
    h3(context, C.nextActions)
    context.blocks.push({
      kind: 'list',
      items: topic.nextActions.map((action) =>
        context.say(`${action.text}${action.verify === null ? '' : ` (${action.verify})`}`)
      )
    })
  }
  h3(context, C.goals)
  context.blocks.push({
    kind: 'kpis',
    tiles: topic.goals.map((goal) =>
      plainTile(
        context,
        goal.label,
        pctText(goal.rate),
        C.goalsLede,
        `${grouped(goal.cited.n)} of ${grouped(goal.withAio.n)} · goal ${goal.bandLo}–${goal.bandHi}%${goal.toReachBand > 0 ? ` · +${goal.toReachBand} to reach the band` : ''}`
      )
    )
  })
  table(context, {
    headers: [
      COL.kind,
      COL.withAio,
      COL.cited,
      COL.rightPage,
      COL.otherPage,
      COL.noAio,
      COL.failed,
      COL.rate,
      COL.band,
      COL.toReach
    ],
    rows: topic.goals.map((goal) => [
      goal.label,
      grouped(goal.withAio.n),
      grouped(goal.cited.n),
      grouped(goal.rightPage.n),
      grouped(goal.otherPage.n),
      grouped(goal.noAio.n),
      grouped(goal.failed.n),
      pctText(goal.rate),
      `${goal.bandLo}–${goal.bandHi}%`,
      grouped(goal.toReachBand)
    ]),
    widths: [3, 2, 1.4, 1.4, 1.4, 1.6, 1.4, 1.4, 1.4, 1.6],
    numeric: [1, 2, 3, 4, 5, 6, 7, 9],
    meter: { column: 7, values: topic.goals.map((goal) => goal.rate) }
  })
  h3(context, C.stages)
  if (topic.stages.length === 0) para(context, 'No buyer questions in this topic.', 'muted')
  else {
    table(context, {
      headers: [COL.stage, COL.questions, COL.withAio, COL.cited, COL.rate],
      rows: topic.stages.map((stage) => [
        stage.label,
        grouped(stage.questions),
        grouped(stage.aio.n),
        grouped(stage.cited.n),
        pctText(stage.rate)
      ]),
      widths: [3, 1.5, 2, 1.5, 1.5],
      numeric: [1, 2, 3, 4],
      meter: { column: 4, values: topic.stages.map((stage) => stage.rate) }
    })
  }
  h3(context, C.todo)
  table(context, {
    headers: [COL.state, COL.prompts],
    rows: topic.todo.map((group) => [group.label, grouped(group.count.n)]),
    widths: [4, 1.5],
    numeric: [1]
  })
  for (const group of topic.todo) {
    if (group.rows.length === 0) continue
    para(context, `${group.label} · ${group.count.n}`, 'body')
    table(context, {
      headers: [COL.number, COL.question, COL.stage, COL.target, COL.citedInstead, COL.winOdds],
      rows: group.rows.map((row) => [
        `${row.kind === 'question' ? 'Q' : 'K'}${row.number}`,
        row.text,
        row.stage ?? '—',
        row.targetPath ?? C.noTarget,
        row.citedInstead.join(', ') || '—',
        row.winOdds === null ? '—' : `${row.winLevel ?? ''} ${row.winOdds}`.trim()
      ]),
      widths: [0.8, 6, 1.4, 3, 3, 1.6],
      numeric: [5],
      size: 8
    })
  }
  para(context, C.winOddsNote, 'muted')
  h3(context, C.keywords)
  keywordTable(context, COL.group, topic.keywords.byGroup)
  keywordTable(context, COL.intent, topic.keywords.byIntent)
  keywordTable(context, COL.funnel, topic.keywords.byFunnel)
  keywordTable(context, COL.pageType, topic.keywords.byPageType)
}

function keywordTable(
  context: BlockContext,
  header: string,
  rows: readonly TopicCoverageKeywordRow[]
): void {
  if (rows.length === 0) return
  table(context, {
    headers: [header, COL.keywords, COL.withAio, COL.youCited, COL.named, COL.rate],
    rows: rows.map((row) => [
      row.label,
      grouped(row.keywords.n),
      grouped(row.aio.n),
      grouped(row.cited.n),
      grouped(row.named.n),
      pctText(row.rate)
    ]),
    widths: [4, 1.5, 2, 1.5, 1.5, 1.5],
    numeric: [1, 2, 3, 4, 5],
    meter: { column: 5, values: rows.map((row) => row.rate) }
  })
}
