import type { AlertLogEntry } from '@shared/ipc'
import { pageHash, topicHash } from '../../shell/routes'

/** The check a fired alert came from: the page's (or topic's) Results at that run. */
export function entryHash(entry: AlertLogEntry): string {
  return entry.pageUrl === null
    ? topicHash(entry.pageId, { runId: entry.runId, marketId: entry.marketId })
    : pageHash(entry.pageId, 'results', { runId: entry.runId, marketId: entry.marketId })
}
