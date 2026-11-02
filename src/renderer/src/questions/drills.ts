import type { EngineId } from '@shared/domain'
import type { QuestionRow, QuestionSource, QuestionsList } from '@shared/ipc'
import { opaqueId, type ItemDrill } from '../drill'
import { engineLabel, statusText, type StatusMap } from '../engines/model'
import {
  openQuestionEditor,
  questionEditSource,
  questionMenuItems,
  questionProject,
  updateQuestions
} from '../questionEdit'
import { engineKpiRows, rowStatuses, type EngineKpiPart } from './engineView'
import { resultText, sourceLabel } from './model'

/** The Questions KPI tiles that open their rows. */
export type QuestionsKpiId = 'tracked' | 'off' | 'overviews' | 'cited' | 'named'

const TITLES: Readonly<Record<QuestionsKpiId, string>> = {
  // Searches: the tiles count questions and keywords alike (audit2 #12).
  tracked: 'Searches tracked',
  off: 'Searches left out of checks',
  overviews: 'Searches where an AI Overview shows',
  cited: 'Searches where you are cited',
  named: 'Searches where you are named'
}

/** The rows each tile counts: the same tests as `questionKpis`, so the counts agree. */
export function kpiRows(rows: readonly QuestionRow[], id: QuestionsKpiId): QuestionRow[] {
  switch (id) {
    case 'tracked':
      return rows.filter((row) => row.enabled)
    case 'off':
      return rows.filter((row) => !row.enabled)
    case 'overviews':
      return rows.filter((row) => row.overview === true)
    case 'cited':
      return rows.filter((row) => row.cited === true)
    case 'named':
      return rows.filter((row) => row.named === true)
  }
}

function menuFor(
  row: QuestionRow,
  source: QuestionSource | undefined
): ItemDrill['items'][number]['menu'] {
  return () =>
    questionMenuItems(
      {
        sourceId: row.sourceId,
        promptId: row.promptId,
        text: row.text,
        enabled: row.enabled,
        inTopic: source?.kind === 'topic',
        stage: row.stage
      },
      {
        onEdit: () => openQuestionEditor({ sourceId: row.sourceId, promptId: row.promptId }),
        onToggle: () => {
          const projectId = questionProject()
          if (projectId === null) return
          void updateQuestions(
            questionEditSource(),
            projectId,
            row.enabled ? 'disable' : 'enable',
            [row]
          )
        },
        onRemove: () => {
          const projectId = questionProject()
          if (projectId === null) return
          void updateQuestions(questionEditSource(), projectId, 'remove', [row])
        }
      }
    )
}

/**
 * The drill behind a Questions KPI tile: every question it counts, with where it
 * comes from and its latest result. A row opens Prompt detail; its `⋯` edits,
 * pauses or removes the question.
 */
export function questionsKpiDrill(
  id: QuestionsKpiId,
  list: QuestionsList,
  sources: ReadonlyMap<string, QuestionSource>,
  marketLabel: string
): ItemDrill {
  return questionRowsDrill({
    id: `questions:${id}`,
    title: TITLES[id],
    description:
      id === 'tracked' || id === 'off'
        ? 'Every page and topic in this project.'
        : `The latest check of each question in ${marketLabel}.`,
    rows: kpiRows(list.rows, id),
    list,
    sources,
    marketLabel
  })
}

/** The parts of a group header's "cited N of M" that open their questions. */
export type GroupPart = 'cited' | 'aio'

/**
 * The questions behind a group header's "cited N of M": buyer questions (keywords are
 * scored apart, as `clusterStats` counts them) whose latest check showed an AI
 * Overview (`aio`), and of those the ones citing you (`cited`).
 */
export function groupRows(rows: readonly QuestionRow[], part: GroupPart): QuestionRow[] {
  return rows.filter(
    (row) =>
      row.promptKind === 'question' &&
      row.overview === true &&
      (part === 'aio' || row.cited === true)
  )
}

export function questionsGroupDrill(input: {
  part: GroupPart
  mode: string
  groupKey: string
  label: string
  rows: readonly QuestionRow[]
  list: QuestionsList
  sources: ReadonlyMap<string, QuestionSource>
  marketLabel: string
}): ItemDrill {
  const { part, label } = input
  return questionRowsDrill({
    id: `questions:group:${input.mode}:${opaqueId(input.groupKey)}:${part}`,
    title:
      part === 'cited'
        ? `${label}: questions where you are cited`
        : `${label}: questions with an AI Overview`,
    description:
      part === 'cited'
        ? `Buyer questions in this group whose latest AI Overview in ${input.marketLabel} cites you.`
        : `Buyer questions in this group whose latest check in ${input.marketLabel} showed an AI Overview. Keywords are scored apart.`,
    rows: groupRows(input.rows, part),
    list: input.list,
    sources: input.sources,
    marketLabel: input.marketLabel
  })
}

const ENGINE_TITLES: Readonly<Record<EngineKpiPart, string>> = {
  answered: 'answered',
  cited: 'cites you',
  named: 'names you, without citing you'
}

/** The drill behind an engine KPI tile: the tracked questions it counts on that engine. */
export function questionsEngineDrill(input: {
  engine: EngineId
  part: EngineKpiPart
  statuses: StatusMap
  list: QuestionsList
  sources: ReadonlyMap<string, QuestionSource>
  marketLabel: string
}): ItemDrill {
  const { engine, part, statuses } = input
  const label = engineLabel(engine)
  return questionRowsDrill({
    id: `questions:engine:${engine}:${part}`,
    title: `Questions where ${label} ${ENGINE_TITLES[part]}`,
    description: `The latest ${label} answer to each tracked question in ${input.marketLabel}.`,
    rows: engineKpiRows(input.list.rows, statuses, engine, part),
    list: input.list,
    sources: input.sources,
    marketLabel: input.marketLabel,
    resultLabel: label,
    result: (row) => statusText(rowStatuses(row, statuses)?.[engine])
  })
}

function questionRowsDrill(input: {
  id: string
  title: string
  description: string
  rows: readonly QuestionRow[]
  list: QuestionsList
  sources: ReadonlyMap<string, QuestionSource>
  marketLabel: string
  /** The result column's heading and text. Default: Google AI Overview's result, "You". */
  resultLabel?: string
  result?: (row: QuestionRow) => string
}): ItemDrill {
  const { list, sources } = input
  return {
    kind: 'items',
    id: input.id,
    title: input.title,
    description: input.description,
    noun: ['question', 'questions'],
    primaryLabel: 'Question',
    columns: [
      { id: 'from', label: 'From', width: 'minmax(120px, 1fr)' },
      { id: 'result', label: input.resultLabel ?? 'You', width: '120px' }
    ],
    scope: {
      pageId: null,
      marketId: list.marketId,
      runId: null,
      marketLabel: input.marketLabel,
      checkDateLabel: '',
      brand: list.lens.brandNames[0] ?? '',
      domain: list.lens.ownDomain
    },
    items: input.rows.map((row) => {
      const source = sources.get(row.sourceId)
      return {
        id: row.promptId,
        primary: row.text,
        target: {
          kind: 'prompt',
          pageId: row.resultPageId ?? row.sourceId,
          promptId: row.resultPromptId ?? row.promptId,
          marketId: list.marketId,
          runId: row.runId
        },
        cells: {
          from: sourceLabel(source),
          result: !row.enabled ? 'Left out' : input.result ? input.result(row) : resultText(row)
        },
        menu: menuFor(row, source)
      }
    })
  }
}
