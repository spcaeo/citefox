/** Request parsers for Project settings › Markets. Unknown keys are refused. */

import type {
  AddProjectMarketRequest,
  ProjectMarketLink,
  RemoveProjectMarketRequest,
  RestoreProjectMarketRequest,
  SetDefaultProjectMarketRequest
} from '@shared/ipc'
import { readMarkets } from './ipc-m2'
import { IpcRequestError } from './ipc-request'

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/
const MAX_PAGES = 5000

function plain(value: unknown, channel: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new IpcRequestError(channel)
  }
  return value as Record<string, unknown>
}

function exactly(record: Record<string, unknown>, channel: string, keys: readonly string[]): void {
  for (const key of Object.keys(record)) {
    if (!keys.includes(key)) throw new IpcRequestError(channel)
  }
  for (const key of keys) {
    if (record[key] === undefined) throw new IpcRequestError(channel)
  }
}

function readId(value: unknown, channel: string): string {
  if (typeof value !== 'string' || !ID.test(value)) throw new IpcRequestError(channel)
  return value
}

function readInstant(value: unknown, channel: string): string {
  if (typeof value !== 'string' || value.length > 40 || Number.isNaN(Date.parse(value))) {
    throw new IpcRequestError(channel)
  }
  return value
}

function readIds(value: unknown, channel: string, min: number): string[] {
  if (!Array.isArray(value) || value.length < min || value.length > MAX_PAGES) {
    throw new IpcRequestError(channel)
  }
  const ids = value.map((entry) => readId(entry, channel))
  if (new Set(ids).size !== ids.length) throw new IpcRequestError(channel)
  return ids
}

export function parseAddProjectMarket(value: unknown): AddProjectMarketRequest {
  const channel = 'projectSettings:addMarket'
  const record = plain(value, channel)
  exactly(record, channel, ['projectId', 'market', 'pageIds'])
  const [market, ...rest] = readMarkets([record.market], channel)
  if (market === undefined || rest.length > 0) throw new IpcRequestError(channel)
  return {
    projectId: readId(record.projectId, channel),
    market,
    pageIds: readIds(record.pageIds, channel, 1)
  }
}

export function parseRemoveProjectMarket(value: unknown): RemoveProjectMarketRequest {
  const channel = 'projectSettings:removeMarket'
  const record = plain(value, channel)
  exactly(record, channel, ['projectId', 'marketId'])
  return {
    projectId: readId(record.projectId, channel),
    marketId: readId(record.marketId, channel)
  }
}

function readLink(value: unknown, channel: string): ProjectMarketLink {
  const record = plain(value, channel)
  for (const key of Object.keys(record)) {
    if (!['pageId', 'addedAt', 'baselineRunId', 'lastCheckedAt', 'wasDefault'].includes(key)) {
      throw new IpcRequestError(channel)
    }
  }
  if (typeof record.wasDefault !== 'boolean') throw new IpcRequestError(channel)
  return {
    pageId: readId(record.pageId, channel),
    addedAt: readInstant(record.addedAt, channel),
    baselineRunId: record.baselineRunId === null ? null : readId(record.baselineRunId, channel),
    lastCheckedAt:
      record.lastCheckedAt === null ? null : readInstant(record.lastCheckedAt, channel),
    wasDefault: record.wasDefault
  }
}

export function parseRestoreProjectMarket(value: unknown): RestoreProjectMarketRequest {
  const channel = 'projectSettings:restoreMarket'
  const record = plain(value, channel)
  exactly(record, channel, ['projectId', 'marketId', 'links'])
  if (!Array.isArray(record.links) || record.links.length > MAX_PAGES) {
    throw new IpcRequestError(channel)
  }
  return {
    projectId: readId(record.projectId, channel),
    marketId: readId(record.marketId, channel),
    links: record.links.map((link) => readLink(link, channel))
  }
}

export function parseSetDefaultProjectMarket(value: unknown): SetDefaultProjectMarketRequest {
  const channel = 'projectSettings:setDefaultMarket'
  const record = plain(value, channel)
  exactly(record, channel, ['projectId', 'marketId', 'pages'])
  if (record.pages !== 'none' && record.pages !== 'tracking') throw new IpcRequestError(channel)
  return {
    projectId: readId(record.projectId, channel),
    marketId: readId(record.marketId, channel),
    pages: record.pages
  }
}
