import { isCompetitorPeriod, type CompetitorsOverviewRequest } from '@shared/ipc'
import { IpcRequestError } from '../../ipc-request'

const CHANNEL = 'competitors:overview'
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/
const KEYS = new Set(['projectId', 'marketId', 'productId', 'period'])

/** A malformed request is refused with the channel name only, never its arguments (NFR-5). */
export function parseCompetitorsOverview(value: unknown): CompetitorsOverviewRequest {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new IpcRequestError(CHANNEL)
  }
  const record = value as Record<string, unknown>
  if (!Object.keys(record).every((key) => KEYS.has(key))) throw new IpcRequestError(CHANNEL)
  const period = record.period
  if (!isCompetitorPeriod(period)) throw new IpcRequestError(CHANNEL)
  return {
    projectId: readId(record.projectId),
    marketId: optionalId(record.marketId),
    productId: optionalId(record.productId),
    period
  }
}

/** `competitors:sortSites`: `{ projectId }` only. */
export function parseCompetitorsSortSites(value: unknown): { projectId: string } {
  const channel = 'competitors:sortSites'
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new IpcRequestError(channel)
  }
  const record = value as Record<string, unknown>
  const keys = Object.keys(record)
  if (keys.length !== 1 || keys[0] !== 'projectId') throw new IpcRequestError(channel)
  const projectId = record.projectId
  if (typeof projectId !== 'string' || !ID.test(projectId)) throw new IpcRequestError(channel)
  return { projectId }
}

function readId(value: unknown): string {
  if (typeof value !== 'string' || !ID.test(value)) throw new IpcRequestError(CHANNEL)
  return value
}

function optionalId(value: unknown): string | null {
  return value === undefined || value === null ? null : readId(value)
}
