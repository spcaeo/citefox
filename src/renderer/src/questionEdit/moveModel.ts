import type { QuestionRow, QuestionTarget } from '@shared/ipc'
import type { MoveMode } from './open'

/** The value of the "back to its page" choice. Never a real id. */
export const BACK_TO_PAGE = '__page__'

export interface Loaded {
  rows: readonly QuestionRow[]
  /** Source kind by id, for "from a topic". */
  topicIds: ReadonlySet<string>
  sourceNames: ReadonlyMap<string, string>
  targets: readonly QuestionTarget[]
}

export type Load =
  { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; data: Loaded }

export function count(n: number, noun = 'question', plural = 'questions'): string {
  return `${n.toLocaleString('en-US')} ${n === 1 ? noun : plural}`
}

/** The destinations a mode offers: topics to move to; any page or topic to copy into. */
export function destinations(
  data: Loaded,
  picked: readonly QuestionRow[],
  mode: MoveMode
): { topics: QuestionTarget[]; pages: QuestionTarget[]; backToPage: boolean } {
  const live = data.targets.filter(
    (target) => target.status === 'tracked' || target.status === 'paused'
  )
  const allFrom = (id: string): boolean =>
    picked.length > 0 && picked.every((row) => row.sourceId === id)
  const topics = live.filter(
    (target) => target.kind === 'topic' && !(mode === 'move' && allFrom(target.id))
  )
  const pages = mode === 'copy' ? live.filter((target) => target.kind === 'page') : []
  const backToPage = mode === 'move' && picked.some((row) => data.topicIds.has(row.sourceId))
  return { topics, pages, backToPage }
}
