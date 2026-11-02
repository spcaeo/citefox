import { isOverviewPeriod, type VisibilityOverviewRequest } from '@shared/ipc'
import { IpcRequestError } from '../../ipc-request'
import { plain, readId } from '../grid/parse'

const CHANNEL = 'visibility:overview'
const KEYS = new Set(['projectId', 'period', 'marketId', 'vs'])

/**
 * `{ projectId, period, marketId?, vs? }`. A missing or null market reads each page's
 * default; a missing or null `vs` compares with each page's previous check. `vs` is a
 * run id or a `YYYY-MM-DD` day, both id-shaped.
 */
export function parseOverviewRequest(value: unknown): VisibilityOverviewRequest {
  const record = plain(value, CHANNEL)
  for (const key of Object.keys(record)) {
    if (!KEYS.has(key)) throw new IpcRequestError(CHANNEL)
  }
  if (!isOverviewPeriod(record.period)) throw new IpcRequestError(CHANNEL)
  const market = record.marketId
  const vs = record.vs
  return {
    projectId: readId(record.projectId, CHANNEL),
    period: record.period,
    marketId: market === undefined || market === null ? null : readId(market, CHANNEL),
    vs: vs === undefined || vs === null ? null : readId(vs, CHANNEL)
  }
}
