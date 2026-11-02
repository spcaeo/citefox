import { createContext } from 'react'
import type { TrackingChange } from '@shared/ipc'
import { localDayKey } from './scale'
import type { ChartEvent } from './markers'

/**
 * The open project's tracking changes (`tracking:changes`), given by the shell to
 * every trend chart, which marks them in grey next to fixes, Google updates and
 * page changes. Empty outside the shell (tests, the gallery).
 */
export const TrackingChangesContext = createContext<readonly TrackingChange[]>([])

/** Why the marker is there, under its title on the hover card. */
export const TRACKING_LINE =
  'CiteFox tracks something new here, so numbers can move without any fix.'

function plural(count: number, one: string, many: string): string {
  return `${count.toLocaleString('en-US')} ${count === 1 ? one : many}`
}

/** One change in words: "You added 12 questions", "ChatGPT turned on". */
export function trackingWords(change: Pick<TrackingChange, 'kind' | 'count' | 'detail'>): string {
  switch (change.kind) {
    case 'questions_added':
      return `You added ${plural(change.count, 'question', 'questions')}`
    case 'questions_removed':
      return `You removed ${plural(change.count, 'question', 'questions')}`
    case 'engine_on':
      return `${change.detail ?? 'An AI engine'} turned on`
    case 'engine_off':
      return `${change.detail ?? 'An AI engine'} turned off`
    case 'market_added':
      return change.detail ? `Market added: ${change.detail}` : 'Market added'
    case 'schedule_changed':
      return change.detail && change.detail.startsWith('every ')
        ? `Checks now run ${change.detail}`
        : 'Check time changed'
  }
}

/**
 * The tracking changes as chart events, one per local day: questions added (and
 * removed) are summed, the rest listed once. `pageIds` keeps the question changes of
 * those pages only (a page's own chart); engines, markets and the schedule apply to
 * every chart. Null keeps every page's.
 */
export function trackingEvents(
  changes: readonly TrackingChange[],
  pageIds: ReadonlySet<string> | null = null
): ChartEvent[] {
  const byDay = new Map<string, TrackingChange[]>()
  for (const change of changes) {
    const isQuestion = change.kind === 'questions_added' || change.kind === 'questions_removed'
    if (isQuestion && pageIds !== null && (change.pageId === null || !pageIds.has(change.pageId))) {
      continue
    }
    const key = localDayKey(change.at)
    byDay.set(key, [...(byDay.get(key) ?? []), change])
  }
  return [...byDay.entries()].map(([key, list]) => {
    const parts = dayParts(list)
    const first = list[0] as TrackingChange
    return {
      id: `tracking:${key}`,
      kind: 'tracking' as const,
      at: first.at,
      title: parts.length === 1 ? (parts[0] ?? '') : plural(parts.length, 'change', 'changes'),
      line: parts.length === 1 ? TRACKING_LINE : `${parts.join('. ')}. ${TRACKING_LINE}`
    }
  })
}

/** A day's changes in words, questions summed, each other change once. */
function dayParts(list: readonly TrackingChange[]): string[] {
  const sum = (kind: TrackingChange['kind']): number =>
    list.filter((change) => change.kind === kind).reduce((total, change) => total + change.count, 0)
  const parts: string[] = []
  const added = sum('questions_added')
  const removed = sum('questions_removed')
  if (added > 0) parts.push(trackingWords({ kind: 'questions_added', count: added, detail: null }))
  if (removed > 0) {
    parts.push(trackingWords({ kind: 'questions_removed', count: removed, detail: null }))
  }
  for (const change of list) {
    if (change.kind === 'questions_added' || change.kind === 'questions_removed') continue
    const words = trackingWords(change)
    if (!parts.includes(words)) parts.push(words)
  }
  return parts
}
