import { isEngineId } from '@shared/domain'
import type { MetricsRequest } from '@shared/ipc'
import type { MetricEngine, MetricScope } from '@shared/metrics'
import { IpcRequestError } from '../ipc-request'
import { plain, readId } from '../engine/grid/parse'

const CHANNEL = 'reports:metrics'
const KEYS = new Set(['projectId', 'scope', 'marketId', 'engine', 'from', 'to'])

/** A run id, a `YYYY-MM-DD` day or an ISO-8601 time: letters, digits and `-_:.+`. */
const MOMENT = /^[A-Za-z0-9_:.+-]{1,64}$/

function scopeOf(value: unknown): MetricScope {
  if (value === undefined || value === null) return { kind: 'project' }
  const record = plain(value, CHANNEL)
  if (record.kind === 'project' && Object.keys(record).length === 1) return { kind: 'project' }
  if ((record.kind === 'topic' || record.kind === 'page') && Object.keys(record).length === 2) {
    return { kind: record.kind, id: readId(record.id, CHANNEL) }
  }
  throw new IpcRequestError(CHANNEL)
}

function engineOf(value: unknown): MetricEngine {
  if (value === undefined || value === null || value === 'all') return 'all'
  if (isEngineId(value)) return value
  throw new IpcRequestError(CHANNEL)
}

function momentOf(value: unknown, allowPrevious: boolean): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string' || !MOMENT.test(value)) throw new IpcRequestError(CHANNEL)
  if ((value === 'previous' || value === 'first') && !allowPrevious) {
    throw new IpcRequestError(CHANNEL)
  }
  return value
}

/**
 * `{ projectId, scope?, marketId?, engine?, from?, to? }`. Missing values read the whole
 * project, each page's default market, every engine, latest only, up to the latest check.
 */
export function parseMetricsRequest(value: unknown): MetricsRequest {
  const record = plain(value, CHANNEL)
  for (const key of Object.keys(record)) {
    if (!KEYS.has(key)) throw new IpcRequestError(CHANNEL)
  }
  const market = record.marketId
  return {
    projectId: readId(record.projectId, CHANNEL),
    scope: scopeOf(record.scope),
    marketId: market === undefined || market === null ? null : readId(market, CHANNEL),
    engine: engineOf(record.engine),
    from: momentOf(record.from, true),
    to: momentOf(record.to, false)
  }
}
