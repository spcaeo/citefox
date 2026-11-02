import { competitorDomainOf, MAX_COMPETITOR_ALIASES, MAX_PRODUCT_NAME } from '@shared/domain'
import type {
  CompetitorsProjectRequest,
  MergeCompetitorsRequest,
  RemoveCompetitorsRequest,
  RestoreCompetitorsRequest,
  RemoveSiteTypeDefRequest,
  SaveCompetitorRequest,
  SaveSiteTypeDefRequest,
  SetSiteKindRequest,
  SetSiteTypeRequest
} from '@shared/ipc'
import { isSortableSiteKind } from '@shared/report/site-kinds'
import { isSiteRole } from '@shared/site-role'
import { isSiteTypeChoice, isSiteTypeTone, MAX_SITE_TYPE_NAME } from '@shared/site-overrides'
import { IpcRequestError } from '../../ipc-request'

/**
 * Request parsing for the competitor CRUD channels. A malformed request is refused
 * with the channel name only, never its arguments (NFR-5); a person's mistake (an
 * empty name, a domain that is not one) says what to fix.
 */

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/
const MAX_IDS = 120

function recordOf(
  value: unknown,
  channel: string,
  required: readonly string[],
  optional: readonly string[] = []
): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new IpcRequestError(channel)
  }
  const record = value as Record<string, unknown>
  const keys = Object.keys(record)
  if (!required.every((key) => keys.includes(key))) throw new IpcRequestError(channel)
  if (!keys.every((key) => required.includes(key) || optional.includes(key))) {
    throw new IpcRequestError(channel)
  }
  return record
}

function readId(value: unknown, channel: string): string {
  if (typeof value !== 'string' || !ID.test(value)) throw new IpcRequestError(channel)
  return value
}

function readIds(value: unknown, channel: string): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_IDS) {
    throw new IpcRequestError(channel)
  }
  return [...new Set(value.map((item) => readId(item, channel)))]
}

function readName(value: unknown, channel: string): string {
  if (typeof value !== 'string') throw new IpcRequestError(channel)
  const name = value.replace(/\s+/gu, ' ').trim()
  if (name.length === 0) throw new IpcRequestError(channel, 'Give the competitor a name')
  if (name.length > MAX_PRODUCT_NAME) {
    throw new IpcRequestError(channel, `Keep the name under ${MAX_PRODUCT_NAME} characters`)
  }
  return name
}

function readDomain(value: unknown, channel: string): string | null {
  if (value === null) return null
  if (typeof value !== 'string') throw new IpcRequestError(channel)
  if (value.trim().length === 0) return null
  const domain = competitorDomainOf(value)
  if (domain === null) {
    throw new IpcRequestError(channel, 'Use a domain such as competitor.example.com')
  }
  return domain
}

function readAliases(value: unknown, channel: string, domain: string | null): string[] {
  if (!Array.isArray(value)) throw new IpcRequestError(channel)
  const out: string[] = []
  for (const item of value as unknown[]) {
    const host = readDomain(item, channel)
    if (host === null || host === domain || out.includes(host)) continue
    out.push(host)
  }
  if (out.length > MAX_COMPETITOR_ALIASES) {
    throw new IpcRequestError(channel, `Keep it to ${MAX_COMPETITOR_ALIASES} other domains`)
  }
  return out
}

export function parseCompetitorsProject(
  value: unknown,
  channel: string
): CompetitorsProjectRequest {
  const record = recordOf(value, channel, ['projectId'])
  return { projectId: readId(record.projectId, channel) }
}

export function parseSaveCompetitor(value: unknown): SaveCompetitorRequest {
  const channel = 'competitors:save'
  const record = recordOf(
    value,
    channel,
    ['projectId', 'id', 'name', 'domain', 'aliases', 'tier'],
    ['productIds']
  )
  const domain = readDomain(record.domain, channel)
  if (record.tier !== 'direct' && record.tier !== 'partial') throw new IpcRequestError(channel)
  const request: SaveCompetitorRequest = {
    projectId: readId(record.projectId, channel),
    id: record.id === null ? null : readId(record.id, channel),
    name: readName(record.name, channel),
    domain,
    aliases: readAliases(record.aliases, channel, domain),
    tier: record.tier
  }
  if (record.productIds === undefined) return request
  if (!Array.isArray(record.productIds) || record.productIds.length > MAX_IDS) {
    throw new IpcRequestError(channel)
  }
  const productIds = [
    ...new Set(
      (record.productIds as unknown[]).map((item) => (item === null ? null : readId(item, channel)))
    )
  ]
  if (productIds.length === 0) throw new IpcRequestError(channel, 'Pick what it competes with')
  return { ...request, productIds }
}

export function parseRemoveCompetitors(value: unknown): RemoveCompetitorsRequest {
  const channel = 'competitors:remove'
  const record = recordOf(value, channel, ['projectId', 'ids'])
  return { projectId: readId(record.projectId, channel), ids: readIds(record.ids, channel) }
}

export function parseMergeCompetitors(value: unknown): MergeCompetitorsRequest {
  const channel = 'competitors:merge'
  const record = recordOf(value, channel, ['projectId', 'ids', 'intoId'], ['name'])
  const intoId = readId(record.intoId, channel)
  const ids = readIds(record.ids, channel)
  if (!ids.includes(intoId)) ids.unshift(intoId)
  if (ids.length < 2) throw new IpcRequestError(channel, 'Pick two or more competitors to merge')
  return {
    projectId: readId(record.projectId, channel),
    ids,
    intoId,
    ...(record.name === undefined ? {} : { name: readName(record.name, channel) })
  }
}

export function parseRestoreCompetitors(value: unknown): RestoreCompetitorsRequest {
  const channel = 'competitors:restore'
  const record = recordOf(value, channel, ['projectId', 'undoToken'])
  return {
    projectId: readId(record.projectId, channel),
    undoToken: readId(record.undoToken, channel)
  }
}

export function parseSetSiteKind(value: unknown): SetSiteKindRequest {
  const channel = 'competitors:setSiteKind'
  const record = recordOf(value, channel, ['projectId', 'domain', 'kind'])
  const domain = readDomain(record.domain, channel)
  if (domain === null || !isSortableSiteKind(record.kind)) throw new IpcRequestError(channel)
  return { projectId: readId(record.projectId, channel), domain, kind: record.kind }
}

export function parseSetSiteType(value: unknown): SetSiteTypeRequest {
  const channel = 'competitors:setSiteType'
  const record = recordOf(value, channel, ['projectId', 'domain'], ['type', 'role'])
  const domain = readDomain(record.domain, channel)
  if (domain === null) throw new IpcRequestError(channel)
  if (record.type === undefined && record.role === undefined) throw new IpcRequestError(channel)
  if (record.type !== undefined && record.type !== null && !isSiteTypeChoice(record.type)) {
    throw new IpcRequestError(channel)
  }
  if (record.role !== undefined && record.role !== null && !isSiteRole(record.role)) {
    throw new IpcRequestError(channel)
  }
  return {
    projectId: readId(record.projectId, channel),
    domain,
    ...(record.type === undefined ? {} : { type: record.type }),
    ...(record.role === undefined ? {} : { role: record.role })
  }
}

export function parseSaveSiteTypeDef(value: unknown): SaveSiteTypeDefRequest {
  const channel = 'competitors:saveSiteTypeDef'
  const record = recordOf(value, channel, ['projectId', 'id', 'name', 'tone'])
  if (typeof record.name !== 'string' || !isSiteTypeTone(record.tone)) {
    throw new IpcRequestError(channel)
  }
  const name = record.name.replace(/\s+/gu, ' ').trim()
  if (name.length === 0) throw new IpcRequestError(channel, 'Give the type a name')
  if (name.length > MAX_SITE_TYPE_NAME) {
    throw new IpcRequestError(channel, `Keep the name under ${MAX_SITE_TYPE_NAME} characters`)
  }
  return {
    projectId: readId(record.projectId, channel),
    id: record.id === null ? null : readId(record.id, channel),
    name,
    tone: record.tone
  }
}

export function parseRemoveSiteTypeDef(value: unknown): RemoveSiteTypeDefRequest {
  const channel = 'competitors:removeSiteTypeDef'
  const record = recordOf(value, channel, ['projectId', 'id'])
  return { projectId: readId(record.projectId, channel), id: readId(record.id, channel) }
}
