import { isFixKind } from '@shared/domain'
import { isLoopStep, OWNER_LABEL_MAX } from '@shared/fix-loop'
import { OWNER_CONTEXT_MAX } from '@shared/owner-why'
import type {
  DraftOwnerWhyRequest,
  DraftPageEditRequest,
  IndexCheckRequest,
  LostGroundRequest,
  OwnerWhyRequest,
  OwnerWhySearch,
  PageEditRequest,
  ProjectIdRequest,
  RunIndexCheckRequest,
  SavePageEditHtmlRequest,
  SavePageFixBriefRequest,
  SaveRecoveryPlanRequest,
  SetFixKindRequest,
  SetLoopOwnerRequest,
  SuggestAnchorsRequest
} from '@shared/ipc'
import { IpcRequestError } from '../../ipc-request'
import { PAGE_AI_TEXT_MAX } from '../../storage/fix-loop-records'
import { toBriefContent } from '../../storage/page-fix-briefs'

/**
 * Request parsing for the fix-loop `fixes:*` channels. Exact keys only; a malformed
 * request is refused with the channel name only, never its arguments (NFR-5). Limits
 * a person can hit (a long owner label, an empty plan) get a plain message instead.
 */

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/
/** Pages one index check or anchor request may name. */
export const FIX_LOOP_MAX_PAGES = 500
/** The most searches one index check could ever need. */
const MAX_CONFIRMED = FIX_LOOP_MAX_PAGES * 2

export function parseLedgerRequest(value: unknown): ProjectIdRequest {
  const channel = 'fixes:ledger'
  const record = exact(value, channel, ['projectId'])
  return { projectId: readId(record.projectId, channel) }
}

export function parseSearchesRequest(
  value: unknown,
  channel: 'fixes:searches' | 'fixes:pageFixCount' | 'fixes:briefs' = 'fixes:searches'
): ProjectIdRequest {
  const record = exact(value, channel, ['projectId'])
  return { projectId: readId(record.projectId, channel) }
}

export function parseSetOwner(value: unknown): SetLoopOwnerRequest {
  const channel = 'fixes:setOwner'
  const record = exact(value, channel, ['projectId', 'step', 'label'])
  if (!isLoopStep(record.step) || typeof record.label !== 'string') {
    throw new IpcRequestError(channel)
  }
  const label = record.label.trim()
  if (label.length > OWNER_LABEL_MAX) {
    throw new IpcRequestError(channel, `Keep the owner to ${OWNER_LABEL_MAX} characters or fewer`)
  }
  return { projectId: readId(record.projectId, channel), step: record.step, label }
}

export function parseSetKind(value: unknown): SetFixKindRequest {
  const channel = 'fixes:setKind'
  const record = exact(value, channel, ['projectId', 'fixId', 'kind'])
  if (!isFixKind(record.kind)) throw new IpcRequestError(channel)
  return {
    projectId: readId(record.projectId, channel),
    fixId: readId(record.fixId, channel),
    kind: record.kind
  }
}

export function parseIndexPreview(value: unknown): IndexCheckRequest {
  const channel = 'fixes:indexPreview'
  const record = exact(value, channel, ['projectId', 'pageIds'])
  return {
    projectId: readId(record.projectId, channel),
    pageIds: readPageIds(record.pageIds, channel)
  }
}

export function parseCheckIndex(value: unknown): RunIndexCheckRequest {
  const channel = 'fixes:checkIndex'
  const record = exact(value, channel, ['projectId', 'pageIds', 'confirmedSearches'])
  const confirmed = record.confirmedSearches
  if (
    typeof confirmed !== 'number' ||
    !Number.isInteger(confirmed) ||
    confirmed < 0 ||
    confirmed > MAX_CONFIRMED
  ) {
    throw new IpcRequestError(channel)
  }
  return {
    projectId: readId(record.projectId, channel),
    pageIds: readPageIds(record.pageIds, channel),
    confirmedSearches: confirmed
  }
}

export function parseSuggestAnchors(value: unknown): SuggestAnchorsRequest {
  const channel = 'fixes:suggestAnchors'
  const record = exact(value, channel, ['projectId', 'pageIds', 'refresh'])
  if (typeof record.refresh !== 'boolean') throw new IpcRequestError(channel)
  return {
    projectId: readId(record.projectId, channel),
    pageIds: readPageIds(record.pageIds, channel),
    refresh: record.refresh
  }
}

export function parseLostGround(value: unknown): LostGroundRequest {
  const channel = 'fixes:lostGround'
  const record = exact(value, channel, ['projectId', 'pageId', 'vsRunId'])
  return {
    projectId: readId(record.projectId, channel),
    pageId: readId(record.pageId, channel),
    vsRunId: record.vsRunId === null ? null : readId(record.vsRunId, channel)
  }
}

export function parseSaveRecoveryPlan(value: unknown): SaveRecoveryPlanRequest {
  const channel = 'fixes:saveRecoveryPlan'
  const record = exact(value, channel, ['projectId', 'pageId', 'inputKey', 'text'])
  if (typeof record.inputKey !== 'string' || typeof record.text !== 'string') {
    throw new IpcRequestError(channel)
  }
  const [before, now, ...rest] = record.inputKey.split('|')
  if (rest.length > 0) throw new IpcRequestError(channel)
  readId(before, channel)
  readId(now, channel)
  const text = record.text.trim()
  if (text.length === 0) throw new IpcRequestError(channel, 'Write the plan first')
  if (text.length > PAGE_AI_TEXT_MAX) {
    throw new IpcRequestError(channel, `Keep the plan to ${PAGE_AI_TEXT_MAX} characters or fewer`)
  }
  return {
    projectId: readId(record.projectId, channel),
    pageId: readId(record.pageId, channel),
    inputKey: record.inputKey,
    text
  }
}

export function parseSaveBrief(value: unknown): SavePageFixBriefRequest {
  const channel = 'fixes:saveBrief'
  const record = exact(value, channel, ['projectId', 'fixId', 'brief'])
  const brief = toBriefContent(record.brief)
  if (brief === null) throw new IpcRequestError(channel)
  return {
    projectId: readId(record.projectId, channel),
    fixId: readId(record.fixId, channel),
    brief
  }
}

/** Searches one page-edit request may name, and the characters of each. */
export const PAGE_EDIT_MAX_SEARCHES = 12
const SEARCH_TEXT_MAX = 1000
/** The largest page-edits HTML file the app saves. */
export const PAGE_EDIT_HTML_MAX = 5 * 1024 * 1024

export function parseDraftPageEdit(value: unknown): DraftPageEditRequest {
  const channel = 'fixes:draftPageEdit'
  const keys = ['projectId', 'fixId', 'pageId', 'url', 'searches', 'topicId']
  const withContext = typeof value === 'object' && value !== null && 'context' in value
  const record = exact(value, channel, withContext ? [...keys, 'context'] : keys)
  const { url, searches, context } = record
  if (
    withContext &&
    (typeof context !== 'string' ||
      context.trim().length === 0 ||
      context.length > OWNER_CONTEXT_MAX)
  ) {
    throw new IpcRequestError(channel)
  }
  if (typeof url !== 'string' || url.length > 2000 || !isHttpUrl(url)) {
    throw new IpcRequestError(channel)
  }
  if (!Array.isArray(searches) || searches.length > PAGE_EDIT_MAX_SEARCHES) {
    throw new IpcRequestError(channel)
  }
  const texts = searches.map((item: unknown) => {
    if (typeof item !== 'string' || item.trim().length === 0 || item.length > SEARCH_TEXT_MAX) {
      throw new IpcRequestError(channel)
    }
    return item.trim()
  })
  return {
    projectId: readId(record.projectId, channel),
    fixId: readId(record.fixId, channel),
    pageId: record.pageId === null ? null : readId(record.pageId, channel),
    url,
    searches: texts,
    topicId: record.topicId === null ? null : readId(record.topicId, channel),
    ...(typeof context === 'string' ? { context: context.trim() } : {})
  }
}

export function parseDraftOwnerWhy(value: unknown): DraftOwnerWhyRequest {
  const channel = 'fixes:draftOwnerWhy'
  const record = exact(value, channel, ['projectId', 'fixId', 'target', 'citedUrl', 'searches'])
  const target = exact(record.target, channel, ['pageId', 'url'])
  const { citedUrl, searches } = record
  if (!isWebUrl(target.url) || !isWebUrl(citedUrl)) throw new IpcRequestError(channel)
  if (!Array.isArray(searches) || searches.length > OWNER_WHY_MAX_SEARCHES) {
    throw new IpcRequestError(channel)
  }
  const read = searches.map((item: unknown): OwnerWhySearch => {
    const search = exact(item, channel, ['promptId', 'runId', 'text'])
    const { text } = search
    if (typeof text !== 'string' || text.trim().length === 0 || text.length > SEARCH_TEXT_MAX) {
      throw new IpcRequestError(channel)
    }
    return {
      promptId: readId(search.promptId, channel),
      runId: search.runId === null ? null : readId(search.runId, channel),
      text: text.trim()
    }
  })
  return {
    projectId: readId(record.projectId, channel),
    fixId: readId(record.fixId, channel),
    target: {
      pageId: target.pageId === null ? null : readId(target.pageId, channel),
      url: target.url
    },
    citedUrl,
    searches: read
  }
}

export function parseOwnerWhy(value: unknown): OwnerWhyRequest {
  const channel = 'fixes:ownerWhy'
  const record = exact(value, channel, ['projectId', 'fixId'])
  return {
    projectId: readId(record.projectId, channel),
    fixId: readId(record.fixId, channel)
  }
}

/** Searches one comparison request may name (it reads the overviews of the first few). */
export const OWNER_WHY_MAX_SEARCHES = 20

function isWebUrl(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 2000 && isHttpUrl(value)
}

export function parsePageEdit(value: unknown): PageEditRequest {
  const channel = 'fixes:pageEdit'
  const record = exact(value, channel, ['projectId', 'fixId'])
  return {
    projectId: readId(record.projectId, channel),
    fixId: readId(record.fixId, channel)
  }
}

export function parseSavePageEditHtml(value: unknown): SavePageEditHtmlRequest {
  const channel = 'fixes:savePageEditHtml'
  const record = exact(value, channel, ['projectId', 'fileName', 'html', 'format'])
  const { fileName, html, format } = record
  if (format !== 'html' && format !== 'md') throw new IpcRequestError(channel)
  if (typeof fileName !== 'string' || fileName.length === 0 || fileName.length > 200) {
    throw new IpcRequestError(channel)
  }
  if (typeof html !== 'string' || html.length === 0) throw new IpcRequestError(channel)
  if (html.length > PAGE_EDIT_HTML_MAX) {
    throw new IpcRequestError(channel, 'This page is too large to save as one file')
  }
  return { projectId: readId(record.projectId, channel), fileName, html, format }
}

function isHttpUrl(value: string): boolean {
  try {
    const protocol = new URL(value).protocol
    return protocol === 'https:' || protocol === 'http:'
  } catch {
    return false
  }
}

function exact(value: unknown, channel: string, keys: readonly string[]): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new IpcRequestError(channel)
  }
  const record = value as Record<string, unknown>
  const present = Object.keys(record)
  if (present.length !== keys.length || !keys.every((key) => present.includes(key))) {
    throw new IpcRequestError(channel)
  }
  return record
}

function readId(value: unknown, channel: string): string {
  if (typeof value !== 'string' || !ID.test(value)) throw new IpcRequestError(channel)
  return value
}

/** Up to {@link FIX_LOOP_MAX_PAGES} unique page ids. */
function readPageIds(value: unknown, channel: string): string[] {
  if (!Array.isArray(value) || value.length > FIX_LOOP_MAX_PAGES) {
    throw new IpcRequestError(channel)
  }
  const ids = value.map((item) => readId(item, channel))
  if (new Set(ids).size !== ids.length) throw new IpcRequestError(channel)
  return ids
}
