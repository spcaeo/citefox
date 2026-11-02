import { isIntervalDays, isPageStatus } from '@shared/domain'
import {
  isBulkAction,
  type BulkActionRequest,
  type FixIdRequest,
  type IgnoreUrlRequest,
  type MergePagesRequest,
  type PointPromptRequest,
  type TrackUrlRequest,
  type UndoPointRequest,
  type UndoTrackRequest
} from '@shared/ipc'
import { IpcRequestError } from '../../ipc-request'
import { plain, readId, requireKeys } from '../grid/parse'

const MAX_BULK_PAGES = 20_000

export function parseBulkAction(value: unknown, channel: string): BulkActionRequest {
  const record = plain(value, channel)
  requireKeys(record, channel, [
    'projectId',
    'pageIds',
    'action',
    'marketId',
    'intervalDays',
    'groupId'
  ])
  const action = record.action
  if (typeof action !== 'string' || !isBulkAction(action)) throw new IpcRequestError(channel)
  const pageIds = record.pageIds
  if (!Array.isArray(pageIds) || pageIds.length === 0 || pageIds.length > MAX_BULK_PAGES) {
    throw new IpcRequestError(channel, 'Select at least one page')
  }
  const interval = record.intervalDays
  if (interval !== null && (typeof interval !== 'number' || !isIntervalDays(interval))) {
    throw new IpcRequestError(channel)
  }
  return {
    projectId: readId(record.projectId, channel),
    pageIds: [...new Set(pageIds.map((id) => readId(id, channel)))],
    action,
    marketId: nullableId(record.marketId, channel),
    intervalDays: interval,
    groupId: nullableId(record.groupId, channel)
  }
}

export function parsePointPrompt(value: unknown): PointPromptRequest {
  const channel = 'allpages:pointHere'
  const record = plain(value, channel)
  requireKeys(record, channel, ['projectId', 'fromPageId', 'promptId', 'toPageId'])
  return {
    projectId: readId(record.projectId, channel),
    fromPageId: readId(record.fromPageId, channel),
    promptId: readId(record.promptId, channel),
    toPageId: readId(record.toPageId, channel)
  }
}

export function parseUndoPoint(value: unknown): UndoPointRequest {
  const channel = 'allpages:undoPoint'
  const record = plain(value, channel)
  requireKeys(record, channel, [
    'projectId',
    'fromPageId',
    'toPageId',
    'fromPromptSetId',
    'toPromptSetId'
  ])
  return {
    projectId: readId(record.projectId, channel),
    fromPageId: readId(record.fromPageId, channel),
    toPageId: readId(record.toPageId, channel),
    fromPromptSetId: readId(record.fromPromptSetId, channel),
    toPromptSetId: readId(record.toPromptSetId, channel)
  }
}

export function parseMerge(value: unknown): MergePagesRequest {
  const channel = 'allpages:merge'
  const record = plain(value, channel)
  requireKeys(record, channel, ['projectId', 'pageId', 'marketId', 'promptId', 'citedUrl'])
  return {
    projectId: readId(record.projectId, channel),
    pageId: readId(record.pageId, channel),
    marketId: readId(record.marketId, channel),
    promptId: readId(record.promptId, channel),
    citedUrl: readUrl(record.citedUrl, channel)
  }
}

export function parseFixId(value: unknown): FixIdRequest {
  const channel = 'allpages:undoMerge'
  const record = plain(value, channel)
  requireKeys(record, channel, ['projectId', 'fixId'])
  return { projectId: readId(record.projectId, channel), fixId: readId(record.fixId, channel) }
}

export function parseTrackUrl(value: unknown): TrackUrlRequest {
  const channel = 'allpages:trackUrl'
  const record = plain(value, channel)
  requireKeys(record, channel, ['projectId', 'url'])
  return { projectId: readId(record.projectId, channel), url: readUrl(record.url, channel) }
}

export function parseUndoTrack(value: unknown): UndoTrackRequest {
  const channel = 'allpages:undoTrack'
  const record = plain(value, channel)
  requireKeys(record, channel, ['projectId', 'pageId', 'previousStatus'])
  const previous = record.previousStatus
  if (previous !== null && (typeof previous !== 'string' || !isPageStatus(previous))) {
    throw new IpcRequestError(channel)
  }
  return {
    projectId: readId(record.projectId, channel),
    pageId: readId(record.pageId, channel),
    previousStatus: previous
  }
}

export function parseIgnoreUrl(value: unknown): IgnoreUrlRequest {
  const channel = 'allpages:ignoreUrl'
  const record = plain(value, channel)
  requireKeys(record, channel, ['projectId', 'url', 'ignored'])
  if (typeof record.ignored !== 'boolean') throw new IpcRequestError(channel)
  return {
    projectId: readId(record.projectId, channel),
    url: readUrl(record.url, channel),
    ignored: record.ignored
  }
}

function nullableId(value: unknown, channel: string): string | null {
  return value === null ? null : readId(value, channel)
}

function readUrl(value: unknown, channel: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2000) {
    throw new IpcRequestError(channel)
  }
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    throw new IpcRequestError(channel)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new IpcRequestError(channel)
  if (url.username !== '' || url.password !== '') throw new IpcRequestError(channel)
  return url.href
}
