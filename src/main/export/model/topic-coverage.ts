import type {
  KeywordUniverseRow,
  TopicGoal,
  TopicResultRow,
  TopicStageCoverage,
  TopicTodoGroup
} from '@shared/domain'
import { TOPIC_STAGE_LABEL, WIN_ODDS_LABEL } from '@shared/domain'
import type { TopicResults } from '@shared/ipc'
import { TOPIC_COVERAGE_COPY, topicActionText, topicGoalSentence } from '@shared/report-copy'
import { urlPath } from './rows'
import type {
  TopicCount,
  TopicCoverageAction,
  TopicCoverageGoal,
  TopicCoverageKeywordRow,
  TopicCoverageSection,
  TopicCoverageStage,
  TopicCoverageTodoGroup,
  TopicCoverageTodoRow,
  TopicCoverageTopic
} from './topic-types'

/** The Claude summary saved for the topic (`topic_summaries`), when one was written. */
export interface SavedTopicSummary {
  line: string
  executive: string
  actions: readonly TopicCoverageAction[]
  createdAt: string
}

/** What the builder needs from the report: its rows and the drill registry. */
export interface TopicCoverageContext {
  rows: readonly { id: string; promptId: string; pageId: string; marketId: string }[]
  count(token: string, ids: readonly string[]): TopicCount
}

/**
 * One topic's coverage, built from `topics:results` (pure). A number drills to report
 * rows only when every prompt behind it is a row of this report (NFR-14: the drawer
 * then lists exactly `n`); otherwise it is a plain number.
 */
export function buildTopicCoverageTopic(
  results: TopicResults,
  saved: SavedTopicSummary | null,
  context: TopicCoverageContext,
  marketLabel: string
): TopicCoverageTopic {
  const topicId = results.topic.id
  const marketId = results.topic.marketId
  const rowIds = new Map<string, string>()
  for (const row of context.rows) {
    if (row.pageId === topicId && row.marketId === marketId) rowIds.set(row.promptId, row.id)
  }
  const prefix = `topic:${topicId}:${marketId}`
  const count = (token: string, promptIds: readonly string[]): TopicCount => {
    const ids = promptIds.map((id) => rowIds.get(id))
    if (ids.every((id): id is string => id !== undefined)) {
      return context.count(`${prefix}:${token}`, ids)
    }
    return { n: promptIds.length, drill: null }
  }
  const byId = new Map(results.rows.map((row) => [row.promptId, row]))
  const goals = (['question', 'keyword'] as const)
    .map((kind) => results.goals[kind === 'question' ? 'questions' : 'keywords'])
    .filter((goal) => goal.prompts > 0)
    .map((goal) => goalModel(goal, results.rows, count))
  const stages = results.byStage.map((stage) => stageModel(stage, count))
  const todo = results.todo.map((group) => todoModel(group, byId, rowIds, count))
  const executive = saved?.executive.trim() ?? ''
  return {
    topicId,
    name: results.topic.name,
    sourceLine: results.topic.sourceLine,
    marketId,
    marketLabel,
    checkedAt: results.topic.checkedAt,
    executive: executive.length > 0 ? executive : builtExecutive(results, goals),
    executiveSaved: executive.length > 0,
    executiveAt: executive.length > 0 ? (saved?.createdAt ?? null) : null,
    nextActions:
      saved !== null && saved.actions.length > 0
        ? saved.actions.slice(0, 3)
        : builtActions(results, byId),
    goals,
    stages,
    todo,
    keywords: {
      byGroup: results.keywords.byGroup.map((row) => keywordModel(row, 'group', count)),
      byIntent: results.keywords.byIntent.map((row) => keywordModel(row, 'intent', count)),
      byFunnel: results.keywords.byFunnel.map((row) => keywordModel(row, 'funnel', count)),
      byPageType: results.keywords.byPageType.map((row) => keywordModel(row, 'type', count))
    }
  }
}

/** The section: the topics, or the "topic scope only" empty state when there are none. */
export function topicCoverageSection(topics: readonly TopicCoverageTopic[]): TopicCoverageSection {
  return {
    empty: topics.length === 0 ? { ...TOPIC_COVERAGE_COPY.empty } : null,
    topics
  }
}

type CountFn = (token: string, promptIds: readonly string[]) => TopicCount

function ids(rows: readonly TopicResultRow[], keep: (row: TopicResultRow) => boolean): string[] {
  return rows.filter(keep).map((row) => row.promptId)
}

function goalModel(
  goal: TopicGoal,
  rows: readonly TopicResultRow[],
  count: CountFn
): TopicCoverageGoal {
  const mine = rows.filter((row) => row.kind === goal.kind)
  const aio = (row: TopicResultRow): boolean =>
    row.state === 'right_page' ||
    row.state === 'other_page' ||
    row.state === 'not_cited' ||
    row.state === 'no_page'
  const k = goal.kind
  return {
    kind: k,
    label: TOPIC_COVERAGE_COPY.kinds[k],
    prompts: goal.prompts,
    withAio: count(`${k}:aio`, ids(mine, aio)),
    cited: count(
      `${k}:cited`,
      ids(mine, (row) => row.state === 'right_page' || row.state === 'other_page')
    ),
    rightPage: count(
      `${k}:right`,
      ids(mine, (row) => row.state === 'right_page')
    ),
    otherPage: count(
      `${k}:other`,
      ids(mine, (row) => row.state === 'other_page')
    ),
    named: count(
      `${k}:named`,
      ids(mine, (row) => aio(row) && row.named === true)
    ),
    noAio: count(
      `${k}:noaio`,
      ids(mine, (row) => row.state === 'no_aio')
    ),
    failed: count(
      `${k}:failed`,
      ids(mine, (row) => row.state === 'failed')
    ),
    notChecked: goal.notChecked,
    rate: goal.rate,
    bandLo: goal.band.lo,
    bandHi: goal.band.hi,
    bandState: goal.bandState,
    toReachBand: goal.toReachBand
  }
}

function stageModel(stage: TopicStageCoverage, count: CountFn): TopicCoverageStage {
  return {
    stage: stage.stage,
    label: TOPIC_STAGE_LABEL[stage.stage],
    questions: stage.prompts,
    aio: count(`stage:${stage.stage}:aio`, [...stage.citedIds, ...stage.notCitedIds]),
    cited: count(`stage:${stage.stage}:cited`, stage.citedIds),
    rate: stage.rate
  }
}

function pathOf(url: string | null): string | null {
  return url === null ? null : urlPath(url)
}

function todoModel(
  group: TopicTodoGroup,
  byId: ReadonlyMap<string, TopicResultRow>,
  rowIds: ReadonlyMap<string, string>,
  count: CountFn
): TopicCoverageTodoGroup {
  const rows: TopicCoverageTodoRow[] = []
  for (const id of group.promptIds) {
    const row = byId.get(id)
    if (row === undefined) continue
    rows.push({
      number: row.number,
      kind: row.kind,
      text: row.text,
      stage: row.stage === null ? null : TOPIC_STAGE_LABEL[row.stage],
      targetUrl: row.targetUrl,
      targetPath: pathOf(row.targetUrl),
      citedInstead: row.citedInstead,
      winOdds: row.winOdds?.score ?? null,
      winLevel: row.winOdds === null ? null : WIN_ODDS_LABEL[row.winOdds.level],
      rowId: rowIds.get(row.promptId) ?? null
    })
  }
  return {
    state: group.state,
    label: group.label,
    hint: group.hint,
    count: count(`todo:${group.state}`, group.promptIds),
    rows
  }
}

function keywordModel(
  row: KeywordUniverseRow,
  table: string,
  count: CountFn
): TopicCoverageKeywordRow {
  const token = `kw:${table}:${row.key}`
  return {
    key: row.key,
    label: row.label,
    groupKind: row.groupKind,
    keywords: count(`${token}:all`, row.promptIds),
    aio: count(`${token}:aio`, row.aioIds),
    cited: count(`${token}:cited`, row.citedIds),
    named: count(`${token}:named`, row.namedIds),
    rate: row.citedRate
  }
}

/** Executive summary from the numbers when no Claude summary was saved. */
function builtExecutive(results: TopicResults, goals: readonly TopicCoverageGoal[]): string {
  const parts = goals.map((goal) =>
    topicGoalSentence({
      label: goal.label,
      cited: goal.cited.n,
      withAio: goal.withAio.n,
      rate: goal.rate,
      bandLo: goal.bandLo,
      bandHi: goal.bandHi,
      toReachBand: goal.toReachBand
    })
  )
  const strongest = results.summaryInputs.strongestStage
  const weakest = results.summaryInputs.weakestStage
  if (strongest !== null && weakest !== null && strongest.stage !== weakest.stage) {
    parts.push(
      `${TOPIC_STAGE_LABEL[strongest.stage]} is strongest (${strongest.cited} of ${strongest.withAio}); ${TOPIC_STAGE_LABEL[weakest.stage]} is weakest (${weakest.cited} of ${weakest.withAio}).`
    )
  }
  const open = results.todo
    .filter((group) => group.state !== 'right_page' && group.count > 0)
    .map((group) => `${group.count} ${group.label.toLowerCase()}`)
  if (open.length > 0) parts.push(`To do: ${open.join(', ')}.`)
  if (parts.length === 0) return TOPIC_COVERAGE_COPY.notChecked.message
  return parts.join(' ')
}

/** The three highest-odds open rows, as plain actions. */
function builtActions(
  results: TopicResults,
  byId: ReadonlyMap<string, TopicResultRow>
): TopicCoverageAction[] {
  const open = results.rows
    .filter(
      (row): row is TopicResultRow & { state: 'not_cited' | 'other_page' | 'no_page' } =>
        row.state === 'not_cited' || row.state === 'other_page' || row.state === 'no_page'
    )
    .sort(
      (a, b) =>
        (b.winOdds?.score ?? -1) - (a.winOdds?.score ?? -1) ||
        a.kind.localeCompare(b.kind) * -1 ||
        a.number - b.number
    )
  const picked = results.summaryInputs.next
    .map((id) => byId.get(id))
    .filter(
      (row): row is TopicResultRow & { state: 'not_cited' | 'other_page' | 'no_page' } =>
        row !== undefined &&
        (row.state === 'not_cited' || row.state === 'other_page' || row.state === 'no_page')
    )
  const rows = [...picked, ...open.filter((row) => !picked.includes(row))].slice(0, 3)
  return rows.map((row) => ({
    text: topicActionText({
      state: row.state,
      label: `${row.kind === 'question' ? 'Q' : 'K'}${row.number}`,
      text: row.text,
      targetPath: pathOf(row.targetUrl),
      citedOwnPath: pathOf(row.citedOwnUrl)
    }),
    verify: null
  }))
}
