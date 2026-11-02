import { TOPIC_STAGES, type TopicBand, type TopicStage, type TopicSummary } from '@shared/domain'
import type { QuestionRow, QuestionsList } from '@shared/ipc'
import { clusterStats, pathOf, stageLabel, type ClusterStats } from '../clusters'
import { rowTotals, type Totals } from '../views/model'
import { formatMoment } from '../../utils/dates'

/**
 * The Topics screen's pure rules (Docs/TOPICS-SPEC.md §8.1): one line per topic from
 * the question list, and the screen's URL. The dashboard's totals are in views/model.
 */

export type ResultsBy = 'topic' | 'stage' | 'target'
export type TopicAction = 'rename' | 'merge' | 'split' | 'delete'

export const RESULTS_BY: readonly ResultsBy[] = ['topic', 'stage', 'target']
export const TOPIC_ACTIONS: readonly TopicAction[] = ['rename', 'merge', 'split', 'delete']

/** What `#/topics?…` holds: the results grouping, an open row action and the marked row. */
export interface TopicsView {
  results: ResultsBy
  action: TopicAction | null
  /** The topic the action is for. */
  topic: string | null
  /** The marked topic row (came back from it). */
  row: string | null
  /** The Suggest topics section is open. */
  suggest: boolean
  /** The "+ New empty topic" form is open (`new=empty`). */
  create: boolean
}

export const DEFAULT_TOPICS_VIEW: TopicsView = {
  results: 'topic',
  action: null,
  topic: null,
  row: null,
  suggest: false,
  create: false
}

const OWN_KEYS = ['results', 'action', 'topic', 'row', 'suggest', 'new'] as const

function oneOf<T extends string>(items: readonly T[], value: string | null): T | null {
  return items.find((item) => item === value) ?? null
}

export function parseTopicsView(query: string): TopicsView {
  const params = new URLSearchParams(query)
  const action = oneOf(TOPIC_ACTIONS, params.get('action'))
  const topic = params.get('topic') || null
  return {
    results: oneOf(RESULTS_BY, params.get('results')) ?? 'topic',
    // An action needs its topic; without one the URL is just the list.
    action: topic === null ? null : action,
    topic: action === null ? null : topic,
    row: params.get('row') || null,
    suggest: params.get('suggest') === '1',
    create: params.get('new') === 'empty'
  }
}

/** The query for a view. Keys this screen does not own (such as `dialog`) are kept. */
export function topicsViewQuery(view: TopicsView, current = ''): string {
  const params = new URLSearchParams(current)
  for (const key of OWN_KEYS) params.delete(key)
  if (view.results !== 'topic') params.set('results', view.results)
  if (view.action !== null && view.topic !== null) {
    params.set('action', view.action)
    params.set('topic', view.topic)
  }
  if (view.row !== null) params.set('row', view.row)
  if (view.suggest) params.set('suggest', '1')
  if (view.create) params.set('new', 'empty')
  return params.toString()
}

const ORIGIN: Readonly<Record<TopicSummary['source'], string>> = {
  seed: 'From a buyer problem',
  questions: 'From my own questions',
  competitor: "From a competitor's page"
}

/** One topic on the list: its questions on their latest check and its target pages. */
export interface TopicLine {
  id: string
  name: string
  /** "From a buyer problem · every 14 days". Paused shows as a chip (`status`). */
  origin: string
  status: TopicSummary['status']
  band: TopicBand
  /** Every question and keyword of the topic, as the Questions screen lists them. */
  rows: readonly QuestionRow[]
  /** Buyer questions only. */
  questionRows: readonly QuestionRow[]
  /** The questions goal: own site cited ÷ questions with an AI Overview, against the band. */
  stats: ClusterStats
  /** Every search's result, with the headline `targetPct` (target page cited ÷ with an AI Overview). */
  totals: Totals
  /** Distinct target pages, most questions first. */
  targets: readonly { url: string; path: string; pageId: string | null; questions: number }[]
  /** Latest finished check of any of its questions. Null before the first. */
  checkedAt: string | null
  /** Stages with questions (Split needs two). */
  stages: number
}

const LISTED: ReadonlySet<TopicSummary['status']> = new Set(['tracked', 'paused', 'setting_up'])

function targetsOf(rows: readonly QuestionRow[]): TopicLine['targets'] {
  const byUrl = new Map<string, { url: string; pageId: string | null; questions: number }>()
  for (const row of rows) {
    if (row.targetUrl === null) continue
    const known = byUrl.get(row.targetUrl)
    if (known === undefined) {
      byUrl.set(row.targetUrl, { url: row.targetUrl, pageId: row.targetPageId, questions: 1 })
    } else known.questions += 1
  }
  return [...byUrl.values()]
    .sort((a, b) => b.questions - a.questions || a.url.localeCompare(b.url))
    .map((item) => ({ ...item, path: pathOf(item.url) }))
}

function latest(dates: readonly (string | null)[]): string | null {
  let best: string | null = null
  for (const date of dates) if (date !== null && (best === null || date > best)) best = date
  return best
}

/** The listed topics (not removed), in the order `topics:list` gives them. */
export function topicLines(
  topics: readonly TopicSummary[],
  list: QuestionsList | null
): TopicLine[] {
  const bySource = new Map<string, QuestionRow[]>()
  for (const row of list?.rows ?? []) {
    bySource.set(row.sourceId, [...(bySource.get(row.sourceId) ?? []), row])
  }
  return topics
    .filter((topic) => LISTED.has(topic.status))
    .map((topic) => {
      const rows = bySource.get(topic.id) ?? []
      const questionRows = rows.filter((row) => row.promptKind === 'question')
      const band = topic.bands.questions
      const every = topic.intervalDays === 1 ? 'every day' : `every ${topic.intervalDays} days`
      return {
        id: topic.id,
        name: topic.name,
        origin: `${ORIGIN[topic.source]} · ${every}`,
        status: topic.status,
        band,
        rows,
        questionRows,
        stats: clusterStats(rows, band),
        totals: rowTotals(rows),
        targets: targetsOf(rows),
        checkedAt: latest([topic.checkedAt, ...rows.map((row) => row.checkedAt)]),
        stages: new Set(rows.flatMap((row) => (row.stage === null ? [] : [row.stage]))).size
      }
    })
}

/** "42%", or "—" before an overview showed. */
export function shareText(stats: Pick<ClusterStats, 'rate'>): string {
  return stats.rate === null ? '—' : `${stats.rate}%`
}

/** "+8 pts", "−3 pts", "0 pts" or "—". */
export function changeText(change: number | null): string {
  if (change === null) return '—'
  if (change > 0) return `+${change} pts`
  if (change < 0) return `−${Math.abs(change)} pts`
  return '0 pts'
}

export function changeTone(change: number | null): 'up' | 'down' | 'flat' {
  if (change === null || change === 0) return 'flat'
  return change > 0 ? 'up' : 'down'
}

/** "Oct 23, 9:00 AM" on this computer's clock, or "Not checked yet". */
export function checkedText(iso: string | null): string {
  if (iso === null) return 'Not checked yet'
  if (Number.isNaN(new Date(iso).getTime())) return 'Not checked yet'
  return formatMoment(iso)
}

export function countText(count: number, one: string, many = `${one}s`): string {
  return `${count.toLocaleString('en-US')} ${count === 1 ? one : many}`
}

/** The cited share of a topic for the bar: 0 before an overview showed. */
export function barValue(stats: ClusterStats): number {
  return stats.rate ?? 0
}

/** "7 of 10" overview line, with the share it stands for. */
export function overviewText(stats: ClusterStats): string {
  return `${stats.withAio} of ${stats.questions}`
}

/**
 * What Split by stage will do (the same rule as `topics:split`): the stage with most
 * questions stays (ties go to the earlier stage) with the questions that have no
 * stage; every other stage becomes "<topic> · <Stage>".
 */
export function splitPreview(line: Pick<TopicLine, 'name' | 'rows'>): {
  keep: TopicStage | null
  kept: number
  topics: { stage: TopicStage; name: string; questions: number }[]
} {
  const counts = new Map<TopicStage, number>()
  for (const row of line.rows) {
    if (row.stage !== null) counts.set(row.stage, (counts.get(row.stage) ?? 0) + 1)
  }
  const ordered = TOPIC_STAGES.filter((stage) => counts.has(stage))
  if (ordered.length < 2) return { keep: ordered[0] ?? null, kept: line.rows.length, topics: [] }
  const keep = ordered.reduce((best, stage) =>
    (counts.get(stage) ?? 0) > (counts.get(best) ?? 0) ? stage : best
  )
  const topics = ordered
    .filter((stage) => stage !== keep)
    .map((stage) => ({
      stage,
      name: `${line.name} · ${stageLabel(stage)}`.slice(0, 120),
      questions: counts.get(stage) ?? 0
    }))
  return {
    keep,
    kept: line.rows.length - topics.reduce((sum, topic) => sum + topic.questions, 0),
    topics
  }
}
