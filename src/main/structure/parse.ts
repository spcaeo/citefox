import {
  isClusterMethod,
  isClusterRole,
  isCountryCode,
  isIntervalDays,
  isLanguageTag,
  isMarketDevice,
  isSampleCount,
  isSitemapChangedPageRule,
  isSitemapNewPageRule,
  isSitemapRemovedPageRule,
  isSitemapSyncFrequency,
  type ClusterMethod,
  type ClusterRole,
  type IntervalDays,
  type SampleCount,
  type SitemapSyncRules
} from '@shared/domain'
import type {
  ClaudePickRequest,
  ClusterIdRequest,
  ClusterSummaryRequest,
  CreateClusterRequest,
  CreateGroupRequest,
  DiscoverSitemapsRequest,
  GroupIdRequest,
  ImportEstimateRequest,
  ImportTrackRequest,
  MarketDraft,
  MergeClustersRequest,
  MovePageRequest,
  MovePagesRequest,
  ParseImportUrlsRequest,
  ProjectIdRequest,
  ReclusterRequest,
  RenameClusterRequest,
  RenameGroupRequest,
  SetGroupPagesRequest,
  SetPageRoleRequest,
  SetSiloRequest,
  SetSitemapIncludedRequest,
  SetSitemapRulesRequest,
  SitemapIdRequest,
  SitemapUrlRequest,
  SplitClusterRequest,
  TrackClusterRequest
} from '@shared/ipc'
import { IpcRequestError } from '../ipc-request'
import { MAX_PROMPT_COUNT } from '../storage/pages'

/**
 * Request parsing for the structure area. Every field is checked; unknown keys
 * are rejected. Messages name the channel only, like the other areas.
 */

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/
/** Pasted URL lists and CSV files. About 10,000 rows of long URLs. */
const MAX_IMPORT_TEXT = 4 * 1024 * 1024
const MAX_IDS = 20_000

type Rec = Record<string, unknown>

export function parseProject(value: unknown, channel: string): ProjectIdRequest {
  const r = rec(value, channel, ['projectId'])
  return { projectId: id(r.projectId, channel) }
}

export function parseDiscover(value: unknown): DiscoverSitemapsRequest {
  const c = 'sitemaps:discover'
  const r = rec(value, c, ['projectId', 'url'])
  return { projectId: id(r.projectId, c), url: r.url === null ? null : text(r.url, c, 2000, true) }
}

export function parseSitemapUrl(value: unknown): SitemapUrlRequest {
  const c = 'sitemaps:add'
  const r = rec(value, c, ['projectId', 'url'])
  return { projectId: id(r.projectId, c), url: text(r.url, c, 2000) }
}

export function parseSitemapId(value: unknown, c: string): SitemapIdRequest {
  const r = rec(value, c, ['projectId', 'sitemapId'])
  return { projectId: id(r.projectId, c), sitemapId: id(r.sitemapId, c) }
}

export function parseSetIncluded(value: unknown): SetSitemapIncludedRequest {
  const c = 'sitemaps:setIncluded'
  const r = rec(value, c, ['projectId', 'sitemapId', 'included'])
  return {
    projectId: id(r.projectId, c),
    sitemapId: id(r.sitemapId, c),
    included: bool(r.included, c)
  }
}

export function parseSetRules(value: unknown): SetSitemapRulesRequest {
  const c = 'sitemaps:setRules'
  const r = rec(value, c, ['projectId', 'rules'])
  const rules = rec(r.rules, c, ['frequency', 'onNew', 'onRemoved', 'onChanged'])
  const parsed: SitemapSyncRules = {
    frequency: oneOf(rules.frequency, c, isSitemapSyncFrequency),
    onNew: oneOf(rules.onNew, c, isSitemapNewPageRule),
    onRemoved: oneOf(rules.onRemoved, c, isSitemapRemovedPageRule),
    onChanged: oneOf(rules.onChanged, c, isSitemapChangedPageRule)
  }
  return { projectId: id(r.projectId, c), rules: parsed }
}

export function parseImportUrlsRequest(value: unknown): ParseImportUrlsRequest {
  const c = 'import:parseUrls'
  const r = rec(value, c, ['projectId', 'text', 'format'])
  if (typeof r.text !== 'string' || r.text.length > MAX_IMPORT_TEXT || r.text.includes('\0')) {
    throw new IpcRequestError(c, 'That list is too long. Import up to 10,000 URLs at a time.')
  }
  if (r.format !== 'lines' && r.format !== 'csv') throw new IpcRequestError(c)
  return { projectId: id(r.projectId, c), text: r.text, format: r.format }
}

export function parseEstimate(value: unknown): ImportEstimateRequest {
  const c = 'import:estimate'
  const r = rec(value, c, [
    'projectId',
    'pageCount',
    'setupPageCount',
    'marketCount',
    'promptCount',
    'samples',
    'intervalDays',
    'stagger'
  ])
  return {
    projectId: id(r.projectId, c),
    pageCount: count(r.pageCount, c, 100_000),
    setupPageCount: count(r.setupPageCount, c, 100_000),
    marketCount: count(r.marketCount, c, 50),
    promptCount: count(r.promptCount, c, MAX_PROMPT_COUNT),
    samples: samples(r.samples, c),
    intervalDays: interval(r.intervalDays, c),
    stagger: bool(r.stagger, c)
  }
}

export function parseClaudePickRequest(value: unknown): ClaudePickRequest {
  const c = 'import:claudePick'
  const r = rec(value, c, ['projectId', 'instruction'])
  return { projectId: id(r.projectId, c), instruction: nullableText(r.instruction, c, 500) }
}

export function parseTrack(value: unknown): ImportTrackRequest {
  const c = 'import:track'
  const r = rec(
    value,
    c,
    [
      'projectId',
      'pageIds',
      'urls',
      'markets',
      'intervalDays',
      'samples',
      'promptCount',
      'stagger',
      'labels'
    ],
    ['labels']
  )
  if (!Array.isArray(r.urls) || r.urls.length > MAX_IDS) throw new IpcRequestError(c)
  if (has(r, 'labels') && (!Array.isArray(r.labels) || r.labels.length > MAX_IDS))
    throw new IpcRequestError(c)
  const promptCount = count(r.promptCount, c, MAX_PROMPT_COUNT)
  if (promptCount < 1) throw new IpcRequestError(c)
  return {
    projectId: id(r.projectId, c),
    pageIds: ids(r.pageIds, c),
    urls: r.urls.map((url) => text(url, c, 2000)),
    markets: markets(r.markets, c),
    intervalDays: interval(r.intervalDays, c),
    samples: samples(r.samples, c),
    promptCount,
    stagger: bool(r.stagger, c),
    ...(has(r, 'labels')
      ? {
          labels: (r.labels as unknown[]).map((item) => {
            const entry = rec(item, c, ['url', 'label'])
            return { url: text(entry.url, c, 2000), label: text(entry.label, c, 500) }
          })
        }
      : {})
  }
}

export function parseClusterId(value: unknown, c: string): ClusterIdRequest {
  const r = rec(value, c, ['projectId', 'clusterId'])
  return { projectId: id(r.projectId, c), clusterId: id(r.clusterId, c) }
}

export function parseRecluster(value: unknown): ReclusterRequest {
  const c = 'structure:recluster'
  const r = rec(value, c, ['projectId', 'method', 'useClaude', 'instruction'])
  const method: ClusterMethod = oneOf(r.method, c, isClusterMethod)
  return {
    projectId: id(r.projectId, c),
    method,
    useClaude: bool(r.useClaude, c),
    instruction: nullableText(r.instruction, c, 500)
  }
}

export function parseRenameCluster(value: unknown): RenameClusterRequest {
  const c = 'structure:renameCluster'
  const r = rec(value, c, ['projectId', 'clusterId', 'name'])
  return {
    projectId: id(r.projectId, c),
    clusterId: id(r.clusterId, c),
    name: text(r.name, c, 120)
  }
}

export function parseMerge(value: unknown): MergeClustersRequest {
  const c = 'structure:mergeClusters'
  const r = rec(value, c, ['projectId', 'fromClusterId', 'intoClusterId'])
  return {
    projectId: id(r.projectId, c),
    fromClusterId: id(r.fromClusterId, c),
    intoClusterId: id(r.intoClusterId, c)
  }
}

export function parseMovePage(value: unknown): MovePageRequest {
  const c = 'structure:movePage'
  const r = rec(value, c, ['projectId', 'pageId', 'clusterId'])
  return { projectId: id(r.projectId, c), pageId: id(r.pageId, c), clusterId: id(r.clusterId, c) }
}

export function parseMovePages(value: unknown): MovePagesRequest {
  const c = 'structure:movePages'
  const r = rec(value, c, ['projectId', 'pageIds', 'clusterId'])
  return {
    projectId: id(r.projectId, c),
    pageIds: ids(r.pageIds, c, 1),
    clusterId: r.clusterId === null ? null : id(r.clusterId, c)
  }
}

export function parseCreateCluster(value: unknown): CreateClusterRequest {
  const c = 'structure:createCluster'
  const r = rec(value, c, ['projectId', 'name', 'pageIds'])
  return {
    projectId: id(r.projectId, c),
    name: text(r.name, c, 120),
    pageIds: ids(r.pageIds, c, 1)
  }
}

export function parseSplitCluster(value: unknown): SplitClusterRequest {
  const c = 'structure:splitCluster'
  const r = rec(value, c, ['projectId', 'clusterId', 'name', 'pageIds'])
  return {
    projectId: id(r.projectId, c),
    clusterId: id(r.clusterId, c),
    name: text(r.name, c, 120),
    pageIds: ids(r.pageIds, c, 1)
  }
}

export function parseSetRole(value: unknown): SetPageRoleRequest {
  const c = 'structure:setPageRole'
  const r = rec(value, c, ['projectId', 'clusterId', 'pageId', 'role'])
  const role: ClusterRole = oneOf(r.role, c, isClusterRole)
  return {
    projectId: id(r.projectId, c),
    clusterId: id(r.clusterId, c),
    pageId: id(r.pageId, c),
    role
  }
}

export function parseTrackCluster(value: unknown): TrackClusterRequest {
  const c = 'structure:trackCluster'
  const r = rec(value, c, ['projectId', 'clusterId', 'track'])
  return { projectId: id(r.projectId, c), clusterId: id(r.clusterId, c), track: bool(r.track, c) }
}

export function parseSetSilo(value: unknown): SetSiloRequest {
  const c = 'structure:setSilo'
  const r = rec(value, c, ['projectId', 'path', 'trackAll', 'marketIds'], ['trackAll', 'marketIds'])
  const path = text(r.path, c, 500)
  if (!path.startsWith('/') || !path.endsWith('/') || path.includes('//'))
    throw new IpcRequestError(c)
  const request: SetSiloRequest = { projectId: id(r.projectId, c), path }
  if (has(r, 'trackAll')) request.trackAll = bool(r.trackAll, c)
  if (has(r, 'marketIds')) request.marketIds = r.marketIds === null ? null : ids(r.marketIds, c, 1)
  return request
}

export function parseCreateGroup(value: unknown): CreateGroupRequest {
  const c = 'structure:createGroup'
  const r = rec(value, c, ['projectId', 'name', 'note'])
  return {
    projectId: id(r.projectId, c),
    name: text(r.name, c, 80),
    note: nullableText(r.note, c, 300)
  }
}

export function parseGroupId(value: unknown, c: string): GroupIdRequest {
  const r = rec(value, c, ['projectId', 'groupId'])
  return { projectId: id(r.projectId, c), groupId: id(r.groupId, c) }
}

export function parseRenameGroup(value: unknown): RenameGroupRequest {
  const c = 'structure:renameGroup'
  const r = rec(value, c, ['projectId', 'groupId', 'name', 'note'])
  return {
    projectId: id(r.projectId, c),
    groupId: id(r.groupId, c),
    name: text(r.name, c, 80),
    note: nullableText(r.note, c, 300)
  }
}

export function parseGroupPages(value: unknown): SetGroupPagesRequest {
  const c = 'structure:setGroupPages'
  const r = rec(value, c, ['projectId', 'groupId', 'add', 'remove'])
  return {
    projectId: id(r.projectId, c),
    groupId: id(r.groupId, c),
    add: ids(r.add, c),
    remove: ids(r.remove, c)
  }
}

export function parseClusterSummary(value: unknown): ClusterSummaryRequest {
  const c = 'structure:clusterSummary'
  const r = rec(value, c, ['projectId', 'limit'])
  const limit = count(r.limit, c, 100)
  return { projectId: id(r.projectId, c), limit: Math.max(1, limit) }
}

// ---------- helpers ----------

function rec(
  value: unknown,
  channel: string,
  allowed: readonly string[],
  optional: readonly string[] = []
): Rec {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new IpcRequestError(channel)
  const record = value as Rec
  for (const key of Object.keys(record))
    if (!allowed.includes(key)) throw new IpcRequestError(channel)
  for (const key of allowed) {
    if (!optional.includes(key) && !has(record, key)) throw new IpcRequestError(channel)
  }
  return record
}

function has(record: Rec, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key)
}

function id(value: unknown, channel: string): string {
  if (typeof value !== 'string' || !ID.test(value)) throw new IpcRequestError(channel)
  return value
}

function ids(value: unknown, channel: string, min = 0): string[] {
  if (!Array.isArray(value) || value.length < min || value.length > MAX_IDS)
    throw new IpcRequestError(channel)
  return [...new Set(value.map((entry) => id(entry, channel)))]
}

function text(value: unknown, channel: string, max: number, allowEmpty = false): string {
  if (typeof value !== 'string') throw new IpcRequestError(channel)
  const trimmed = value.trim()
  if ((!allowEmpty && trimmed.length === 0) || trimmed.length > max || hasControl(trimmed)) {
    throw new IpcRequestError(channel)
  }
  return trimmed
}

function nullableText(value: unknown, channel: string, max: number): string | null {
  if (value === null) return null
  const trimmed = text(value, channel, max, true)
  return trimmed.length === 0 ? null : trimmed
}

function bool(value: unknown, channel: string): boolean {
  if (typeof value !== 'boolean') throw new IpcRequestError(channel)
  return value
}

function count(value: unknown, channel: string, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > max) {
    throw new IpcRequestError(channel)
  }
  return value
}

function interval(value: unknown, channel: string): IntervalDays {
  if (typeof value !== 'number' || !isIntervalDays(value)) throw new IpcRequestError(channel)
  return value
}

function samples(value: unknown, channel: string): SampleCount {
  if (typeof value !== 'number' || !isSampleCount(value)) throw new IpcRequestError(channel)
  return value
}

function oneOf<T extends string>(
  value: unknown,
  channel: string,
  guard: (item: string) => item is T
): T {
  if (typeof value !== 'string' || !guard(value)) throw new IpcRequestError(channel)
  return value
}

function markets(value: unknown, channel: string): MarketDraft[] {
  if (!Array.isArray(value) || value.length > 50) throw new IpcRequestError(channel)
  return value.map((entry) => {
    const r = rec(entry, channel, ['country', 'language', 'location', 'device', 'localWording'])
    if (typeof r.country !== 'string' || !isCountryCode(r.country))
      throw new IpcRequestError(channel)
    if (typeof r.language !== 'string' || !isLanguageTag(r.language))
      throw new IpcRequestError(channel)
    if (typeof r.device !== 'string' || !isMarketDevice(r.device))
      throw new IpcRequestError(channel)
    return {
      country: r.country,
      language: r.language,
      location: r.location === null ? null : text(r.location, channel, 120),
      device: r.device,
      localWording: bool(r.localWording, channel)
    }
  })
}

function hasControl(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code <= 31 || code === 127) return true
  }
  return false
}
