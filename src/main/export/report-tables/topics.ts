import { TOPIC_COVERAGE_COPY } from '@shared/report-copy'
import type { Cell } from '../cells'
import type { TopicCoverageKeywordRow, TopicCoverageTopic } from '../model/types'
import { draft, emptyTable, n, num, pct, text, type DraftTable, type TableContext } from './build'

const C = TOPIC_COVERAGE_COPY
const COL = C.columns

/** Topic coverage tables: summary, goals, stages, to-do and the keyword universe. */
export function topicCoverageTables(context: TableContext): DraftTable[] {
  const coverage = context.model.topicCoverage
  if (coverage === undefined || coverage.empty !== null) {
    return [emptyTable('topic_coverage', coverage?.empty ?? { ...C.empty })]
  }
  const many = coverage.topics.length > 1
  return coverage.topics.flatMap((topic, index) => topicTables(topic, many ? index + 1 : null))
}

function topicTables(topic: TopicCoverageTopic, index: number | null): DraftTable[] {
  const id = (part: string): string => (index === null ? `topic-${part}` : `topic${index}-${part}`)
  const sheet = (name: string): string => (index === null ? name : `T${index} ${name}`)
  const marketCell = text(topic.marketLabel)
  const tables: DraftTable[] = [
    draft(
      id('summary'),
      sheet('Topic summary'),
      ['Topic', 'Market', 'Source', 'Checked', C.executive, 'Written by'],
      [
        [
          text(topic.name),
          marketCell,
          text(topic.sourceLine),
          topic.checkedAt === null ? { kind: 'blank' } : { kind: 'date', value: topic.checkedAt },
          text(topic.executive),
          text(topic.executiveSaved ? 'Claude, from saved results' : 'CiteFox, from the numbers')
        ]
      ]
    ),
    draft(
      id('actions'),
      sheet('Topic next actions'),
      ['#', 'Action', 'Re-check first'],
      topic.nextActions.map((action, at) => [num(at + 1), text(action.text), text(action.verify)])
    ),
    draft(
      id('goals'),
      sheet('Topic goals'),
      [
        COL.kind,
        COL.prompts,
        COL.withAio,
        COL.cited,
        COL.rightPage,
        COL.otherPage,
        COL.named,
        COL.noAio,
        COL.failed,
        COL.rate,
        'Band low',
        'Band high',
        COL.toReach
      ],
      topic.goals.map((goal) => [
        text(goal.label),
        num(goal.prompts),
        n(goal.withAio),
        n(goal.cited),
        n(goal.rightPage),
        n(goal.otherPage),
        n(goal.named),
        n(goal.noAio),
        n(goal.failed),
        pct(goal.rate),
        pct(goal.bandLo),
        pct(goal.bandHi),
        num(goal.toReachBand)
      ])
    ),
    draft(
      id('stages'),
      sheet('Topic stages'),
      [COL.stage, COL.questions, COL.withAio, COL.cited, COL.rate],
      topic.stages.map((stage) => [
        text(stage.label),
        num(stage.questions),
        n(stage.aio),
        n(stage.cited),
        pct(stage.rate)
      ])
    ),
    draft(
      id('todo'),
      sheet('Topic to-do'),
      [COL.state, COL.number, COL.question, COL.stage, COL.target, COL.citedInstead, COL.winOdds],
      topic.todo.flatMap((group) =>
        group.rows.map((row): Cell[] => [
          text(group.label),
          text(`${row.kind === 'question' ? 'Q' : 'K'}${row.number}`),
          text(row.text),
          text(row.stage),
          text(row.targetUrl ?? C.noTarget),
          text(row.citedInstead.join(', ')),
          row.winOdds === null ? { kind: 'blank' } : num(row.winOdds)
        ])
      )
    )
  ]
  const universe: [string, string, readonly TopicCoverageKeywordRow[]][] = [
    ['kw-groups', COL.group, topic.keywords.byGroup],
    ['kw-intent', COL.intent, topic.keywords.byIntent],
    ['kw-funnel', COL.funnel, topic.keywords.byFunnel],
    ['kw-page-type', COL.pageType, topic.keywords.byPageType]
  ]
  for (const [key, header, rows] of universe) {
    if (rows.length === 0) continue
    const withKind = key === 'kw-groups'
    tables.push(
      draft(
        id(key),
        sheet(`Keywords by ${header.toLowerCase()}`),
        [
          header,
          ...(withKind ? [COL.groupKind] : []),
          COL.keywords,
          COL.withAio,
          COL.youCited,
          COL.named,
          COL.rate
        ],
        rows.map((row) => [
          text(row.label),
          ...(withKind ? [text(row.groupKind)] : []),
          n(row.keywords),
          n(row.aio),
          n(row.cited),
          n(row.named),
          pct(row.rate)
        ])
      )
    )
  }
  return tables
}
