import { TOPIC_STAGES, type TopicSummary } from '@shared/domain'
import type { MoveDestination, QuestionRow, QuestionSource, QuestionsList } from '@shared/ipc'
import {
  NO_STAGE,
  NO_TARGET,
  NOT_IN_TOPIC,
  NOT_IN_TOPIC_LABEL,
  pathOf,
  stageLabel
} from '../topics/clusters'
import type { GroupMode } from './model'

/**
 * How the Questions grid groups (Docs/TOPICS-SPEC.md §8): one group per topic with
 * the page questions last in "Not in a topic", per journey stage, or per target page.
 * Keys are opaque; labels are what the header shows.
 */

export const NO_TARGET_LABEL = 'No page yet'

/** Target page keys carry a prefix so a path can never clash with `no-target`. */
const PATH_KEY = 'path:'

export interface GroupKey {
  key: string
  label: string
}

/** The group a row sits in. Null for the flat list. */
export function groupOf(
  row: QuestionRow,
  mode: GroupMode,
  sources: ReadonlyMap<string, QuestionSource>
): GroupKey | null {
  if (mode === 'topic') {
    const source = sources.get(row.sourceId)
    return source?.kind === 'topic'
      ? { key: source.id, label: source.name }
      : { key: NOT_IN_TOPIC, label: NOT_IN_TOPIC_LABEL }
  }
  if (mode === 'stage') return { key: row.stage ?? NO_STAGE, label: stageLabel(row.stage) }
  if (mode === 'target') {
    if (row.targetUrl === null) return { key: NO_TARGET, label: NO_TARGET_LABEL }
    const path = pathOf(row.targetUrl)
    return { key: `${PATH_KEY}${path}`, label: path }
  }
  return null
}

/**
 * The fixed group order: topics as `questions:list` orders them then "Not in a topic";
 * the six stages then "No stage"; target paths A to Z then "No page yet".
 */
export function groupOrder(
  mode: GroupMode,
  list: Pick<QuestionsList, 'sources'>,
  rows: readonly QuestionRow[]
): string[] {
  if (mode === 'topic') {
    return [
      ...list.sources.filter((source) => source.kind === 'topic').map((source) => source.id),
      NOT_IN_TOPIC
    ]
  }
  if (mode === 'stage') return [...TOPIC_STAGES, NO_STAGE]
  if (mode === 'target') {
    const paths = new Set<string>()
    for (const row of rows) if (row.targetUrl !== null) paths.add(pathOf(row.targetUrl))
    return [...[...paths].sort().map((path) => `${PATH_KEY}${path}`), NO_TARGET]
  }
  return []
}

/** How many groups the rows fall into (0 for the flat list). */
export function groupCount(
  rows: readonly QuestionRow[],
  mode: GroupMode,
  sources: ReadonlyMap<string, QuestionSource>
): number {
  if (mode === 'none') return 0
  return new Set(rows.map((row) => groupOf(row, mode, sources)?.key)).size
}

/** Where a drop on a group header moves questions. Only topic groups take drops. */
export function dropDestination(mode: GroupMode, key: string): MoveDestination | null {
  if (mode !== 'topic') return null
  return key === NOT_IN_TOPIC ? { kind: 'page' } : { kind: 'topic', topicId: key }
}

/** `topic:<id>` or `page`, the value the drop target carries in the DOM. */
export function destinationKey(to: MoveDestination): string {
  if (to.kind === 'topic') return `topic:${to.topicId}`
  if (to.kind === 'new') return `new:${to.name}`
  return 'page'
}

export function parseDestination(value: string): MoveDestination | null {
  if (value === 'page') return { kind: 'page' }
  if (value.startsWith('topic:') && value.length > 'topic:'.length) {
    return { kind: 'topic', topicId: value.slice('topic:'.length) }
  }
  if (value.startsWith('new:') && value.trim().length > 'new:'.length) {
    return { kind: 'new', name: value.slice('new:'.length).trim() }
  }
  return null
}

export interface TopicChoice {
  id: string
  name: string
  /** Questions of this topic in the list. */
  count: number
}

/**
 * The topics a question can move to: those in the list first (in its order), then the
 * project's other tracked topics with no question yet. Removed topics are left out.
 */
export function topicChoices(
  list: Pick<QuestionsList, 'sources' | 'rows'>,
  topics: readonly TopicSummary[]
): TopicChoice[] {
  const counts = new Map<string, number>()
  for (const row of list.rows) counts.set(row.sourceId, (counts.get(row.sourceId) ?? 0) + 1)
  const out: TopicChoice[] = list.sources
    .filter((source) => source.kind === 'topic')
    .map((source) => ({ id: source.id, name: source.name, count: counts.get(source.id) ?? 0 }))
  for (const topic of topics) {
    if (topic.status === 'removed' || out.some((item) => item.id === topic.id)) continue
    out.push({ id: topic.id, name: topic.name, count: 0 })
  }
  return out
}

/** Stage order for the Stage column sort; null (no stage) sorts last. */
export function stageSort(row: QuestionRow): number | null {
  return row.stage === null ? null : TOPIC_STAGES.indexOf(row.stage)
}
