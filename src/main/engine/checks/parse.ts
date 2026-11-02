import type {
  ActiveJobsRequest,
  CheckJobIdRequest,
  GetPromptCheckRequest,
  GetResultsRequest,
  NotCitedRequest,
  ProjectIdRequest,
  ResultsHistoryRequest,
  StartCheckRequest
} from '@shared/ipc'
import { MAX_NOT_CITED_PAGES } from '@shared/ipc'
import { isEngineId, type EngineId } from '@shared/domain'
import { IpcRequestError } from '../../ipc-request'
import { isRecord } from '../../providers/json-schema'

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/

export function parseStartCheck(value: unknown): StartCheckRequest {
  const channel = 'checks:start'
  const record = plain(value, channel)
  const keys = ['projectId', 'pageIds', 'marketIds', 'promptIds']
  exactKeys(record, channel, Object.hasOwn(record, 'engines') ? [...keys, 'engines'] : keys)
  const pageIds = idList(record.pageIds, channel)
  const firstPage = pageIds[0]
  if (firstPage === undefined) throw new IpcRequestError(channel)
  const engines = record.engines ?? null
  if (
    engines !== null &&
    (!Array.isArray(engines) || engines.length === 0 || !engines.every(isEngineId))
  )
    throw new IpcRequestError(channel)
  return {
    projectId: readId(record.projectId, channel),
    pageIds: [firstPage, ...pageIds.slice(1)],
    marketIds: nullableIds(record.marketIds, channel),
    promptIds: nullableIds(record.promptIds, channel),
    ...(engines === null ? {} : { engines: [...new Set(engines as EngineId[])] })
  }
}

export function parseNotCited(value: unknown): NotCitedRequest {
  const channel = 'checks:notCited'
  const record = plain(value, channel)
  exactKeys(record, channel, ['projectId', 'pageIds', 'marketIds'])
  const pageIds = idList(record.pageIds, channel)
  if (pageIds.length > MAX_NOT_CITED_PAGES) throw new IpcRequestError(channel)
  return {
    projectId: readId(record.projectId, channel),
    pageIds: [...new Set(pageIds)],
    marketIds: nullableIds(record.marketIds, channel)
  }
}

export function parseCheckJobId(value: unknown, channel = 'checks:get'): CheckJobIdRequest {
  const record = plain(value, channel)
  exactKeys(record, channel, ['jobId'])
  return { jobId: readId(record.jobId, channel) }
}

export function parseActiveJobs(value: unknown): ActiveJobsRequest {
  const channel = 'checks:listActive'
  const record = plain(value, channel)
  exactKeys(record, channel, ['projectId'])
  return { projectId: record.projectId === null ? null : readId(record.projectId, channel) }
}

export function parseGetPrompt(value: unknown): GetPromptCheckRequest {
  const channel = 'checks:getPrompt'
  const record = plain(value, channel)
  exactKeys(record, channel, ['projectId', 'pageId', 'promptId', 'marketId', 'runId'])
  return {
    projectId: readId(record.projectId, channel),
    pageId: readId(record.pageId, channel),
    promptId: readId(record.promptId, channel),
    marketId: nullableId(record.marketId, channel),
    runId: nullableId(record.runId, channel)
  }
}

export function parseGetResults(value: unknown): GetResultsRequest {
  const channel = 'results:get'
  const record = plain(value, channel)
  exactKeys(record, channel, ['projectId', 'pageId', 'marketId', 'runId'])
  return {
    projectId: readId(record.projectId, channel),
    pageId: readId(record.pageId, channel),
    marketId: nullableId(record.marketId, channel),
    runId: nullableId(record.runId, channel)
  }
}

export function parseResultsHistory(value: unknown): ResultsHistoryRequest {
  const channel = 'results:history'
  const record = plain(value, channel)
  exactKeys(record, channel, ['projectId', 'pageId', 'marketId'])
  return {
    projectId: readId(record.projectId, channel),
    pageId: readId(record.pageId, channel),
    marketId: nullableId(record.marketId, channel)
  }
}

export function parseScoreProject(value: unknown): ProjectIdRequest {
  const channel = 'scores:listPages'
  const record = plain(value, channel)
  exactKeys(record, channel, ['projectId'])
  return { projectId: readId(record.projectId, channel) }
}

function plain(value: unknown, channel: string): Record<string, unknown> {
  if (!isRecord(value)) throw new IpcRequestError(channel)
  return value
}

function exactKeys(
  record: Record<string, unknown>,
  channel: string,
  allowed: readonly string[]
): void {
  const keys = Object.keys(record)
  if (keys.length !== allowed.length || allowed.some((key) => !Object.hasOwn(record, key))) {
    throw new IpcRequestError(channel)
  }
}

function readId(value: unknown, channel: string): string {
  if (typeof value !== 'string' || !ID.test(value)) throw new IpcRequestError(channel)
  return value
}

function nullableId(value: unknown, channel: string): string | null {
  if (value === null) return null
  return readId(value, channel)
}

function nullableIds(value: unknown, channel: string): string[] | null {
  if (value === null) return null
  return idList(value, channel)
}

function idList(value: unknown, channel: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !ID.test(item))) {
    throw new IpcRequestError(channel)
  }
  return value
}
