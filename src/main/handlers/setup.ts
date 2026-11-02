/** Background page setup and "ask me" notices. */

import type {
  IpcHandlersFor,
  noticesChannels,
  ResolveNoticeRequest,
  SetupCheckWhenReadyRequest,
  SetupPageRequest,
  SetupPauseRequest,
  SetupRateRequest,
  SetupRetryRequest,
  setupChannels
} from '@shared/ipc'
import { IpcRequestError } from '../ipc-request'
import { listNotices, resolveNotice } from '../notices/service'
import { setCheckWhenReady } from '../setup-runner/first-check'
import type { SetupRunner } from '../setup-runner/runner'
import { guard, type EngineContext } from './context'

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/

export function setupHandlers(
  ctx: EngineContext,
  runner: SetupRunner
): IpcHandlersFor<typeof setupChannels> & IpcHandlersFor<typeof noticesChannels> {
  return {
    'setup:status': () => guard('setup:status', ctx, () => runner.status()),
    'setup:page': (request) =>
      guard('setup:page', ctx, () => {
        const parsed = parsePage(request, 'setup:page')
        return runner.pagePipeline(parsed.projectId, parsed.pageId)
      }),
    'setup:start': (request) =>
      guard('setup:start', ctx, () => {
        const parsed = parsePage(request, 'setup:start')
        return runner.startPage(parsed.projectId, parsed.pageId)
      }),
    'setup:stop': (request) =>
      guard('setup:stop', ctx, () => {
        const parsed = parsePage(request, 'setup:stop')
        return runner.stopPage(parsed.projectId, parsed.pageId)
      }),
    'setup:checkWhenReady': (request) =>
      guard('setup:checkWhenReady', ctx, () => {
        const parsed = parseCheckWhenReady(request)
        return setCheckWhenReady(ctx, parsed.projectId, parsed.on)
      }),
    'setup:retry': (request) => guard('setup:retry', ctx, () => runner.retry(parseRetry(request))),
    'setup:pause': (request) =>
      guard('setup:pause', ctx, () => runner.setPaused(parsePause(request).paused)),
    'setup:setRate': (request) =>
      guard('setup:setRate', ctx, () => runner.setRate(parseRate(request))),
    'notices:list': () => guard('notices:list', ctx, () => listNotices(ctx.storage)),
    'notices:resolve': (request) =>
      guard('notices:resolve', ctx, () =>
        resolveNotice(
          { storage: ctx.storage, logger: ctx.logger, now: ctx.now },
          parseResolve(request)
        )
      )
  }
}

export function parseRetry(value: unknown): SetupRetryRequest {
  const channel = 'setup:retry'
  const record = plain(value, channel, ['projectId', 'pageIds'])
  const request: SetupRetryRequest = {}
  if (record.projectId !== undefined) request.projectId = readId(record.projectId, channel)
  if (record.pageIds !== undefined) {
    if (request.projectId === undefined) {
      throw new IpcRequestError(channel, 'Name the project of those pages')
    }
    if (!Array.isArray(record.pageIds) || record.pageIds.length > 5000) {
      throw new IpcRequestError(channel)
    }
    request.pageIds = record.pageIds.map((id: unknown) => readId(id, channel))
  }
  return request
}

export function parsePage(value: unknown, channel: string): SetupPageRequest {
  const record = plain(value, channel, ['projectId', 'pageId'])
  return { projectId: readId(record.projectId, channel), pageId: readId(record.pageId, channel) }
}

export function parseCheckWhenReady(value: unknown): SetupCheckWhenReadyRequest {
  const channel = 'setup:checkWhenReady'
  const record = plain(value, channel, ['projectId', 'on'])
  if (typeof record.on !== 'boolean') throw new IpcRequestError(channel)
  return { projectId: readId(record.projectId, channel), on: record.on }
}

export function parsePause(value: unknown): SetupPauseRequest {
  const record = plain(value, 'setup:pause', ['paused'])
  if (typeof record.paused !== 'boolean') throw new IpcRequestError('setup:pause')
  return { paused: record.paused }
}

export function parseRate(value: unknown): SetupRateRequest {
  const record = plain(value, 'setup:setRate', ['pagesPerHour'])
  const rate = record.pagesPerHour
  if (typeof rate !== 'number' || !Number.isInteger(rate) || rate < 1 || rate > 200) {
    throw new IpcRequestError('setup:setRate', 'Choose 1 to 200 pages an hour.')
  }
  return { pagesPerHour: rate }
}

export function parseResolve(value: unknown): ResolveNoticeRequest {
  const channel = 'notices:resolve'
  const record = plain(value, channel, ['noticeId', 'actionId'])
  return { noticeId: readId(record.noticeId, channel), actionId: readId(record.actionId, channel) }
}

function plain(
  value: unknown,
  channel: string,
  allowed: readonly string[]
): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new IpcRequestError(channel)
  }
  const record = value as Record<string, unknown>
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) throw new IpcRequestError(channel)
  }
  return record
}

function readId(value: unknown, channel: string): string {
  if (typeof value !== 'string' || !ID.test(value)) throw new IpcRequestError(channel)
  return value
}
