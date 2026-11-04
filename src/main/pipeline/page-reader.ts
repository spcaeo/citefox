import type { JinaMode, PageReadReader } from '@shared/domain'
import type { PageReadResult } from '@shared/ipc'
import { randomUUID } from 'node:crypto'
import type { Logger } from '../logging/logger'
import { redactString } from '../logging/redact'
import {
  CITEFOX_USER_AGENT,
  requestWithRetry,
  type HttpResponse,
  type HttpTransport
} from '../providers/http'
import { createJinaReaderClient } from '../providers/jina/reader'
import type { SecretStore } from '../secrets/secret-store'
import {
  getLatestSnapshot,
  insertSnapshot,
  setSnapshotEligibility,
  type StoredSnapshot
} from '../storage/content-records'
import type { SqliteDatabase } from '../storage/database'
import { getPage, setPageTitleIfEmpty } from '../storage/pages'
import { PipelineError } from './errors'
import { decodePageBytes, isReadablePageContentType } from './charset'
import {
  MAX_DIRECT_REDIRECTS,
  assertPublicPageUrl,
  rejectBlockedLiteral,
  resolvePublicAddresses,
  systemAddressLookup,
  type AddressLookup
} from './fetch-guard'
import { readEligibility } from './eligibility'
import { extractHtml, extractJinaBody, extractMarkdown, type ExtractedPage } from './extract'
import { pageReadFlags, titleMatchesH1 } from './flags'
import { recordPageRead } from './page-history'

const FETCH_TIMEOUT_MS = 20_000

/** A direct page read stops past this size. Real pages are far smaller. */
export const MAX_PAGE_BYTES = 5 * 1024 * 1024

/** One Jina Reader key in rotation order (FR-11.5). Never the secret. */
export interface JinaKeyRef {
  id: string
  name: string
  keychainRef: string
}

/** Called as Jina reads happen, so usage and failovers can be recorded (FR-11.10). */
export interface JinaReadHooks {
  /** One Reader request. `keyId` is null for a keyless read. */
  onRead?: (keyId: string | null) => void
  /** `from` refused the read; `to` is the next key, or null for the keyless fallback. */
  onFailover?: (from: JinaKeyRef, to: JinaKeyRef | null) => void
}

export interface ReadPageOptions {
  db: SqliteDatabase
  transport: HttpTransport
  logger: Logger
  secretStore: SecretStore
  /** One key. Ignored when `jinaKeys` is set. */
  jinaKeychainRef: string | null
  /**
   * FR-11.5. Keys tried in order: a key that is refused, out of credit, or rate-limited
   * hands the read to the next one, and after the last key Reader is called without a
   * key at the lower rate limit.
   */
  jinaKeys?: readonly JinaKeyRef[]
  jinaHooks?: JinaReadHooks
  /** `auto` follows `jinaMode`. The other readers force one path. */
  reader: PageReadReader
  jinaMode: JinaMode
  pageId: string
  /** Project that owns this database. Copied onto the page summary. Not a column. */
  projectId: string
  /** Used for the direct-fetch SSRF check. Defaults to `dns.lookup`. */
  dns?: AddressLookup
  suppliedText?: string | null
  reuseStored?: boolean
  now?: () => string
  clock?: () => number
  sleep?: (ms: number) => Promise<void>
  delayMs?: number
  secrets?: readonly string[]
}

/**
 * Read one page and store a snapshot. The result is the shared page-read summary.
 * The body stays on the snapshot row.
 */
export async function readPage(options: ReadPageOptions): Promise<PageReadResult> {
  const page = getPage(options.db, options.pageId, options.projectId)
  if (page === null) {
    throw new PipelineError('That page is not in this project.', {
      code: 'not_found',
      nextStep: 'Add the page, then read it.'
    })
  }
  if (page.url === null) {
    throw new PipelineError('A topic has no page to read.', {
      code: 'not_found',
      nextStep: 'Edit the topic instead.'
    })
  }
  const pageUrl = page.url
  if (options.reader !== 'file') rejectBlockedLiteral(pageUrl)
  if (options.reuseStored) {
    const stored = getLatestSnapshot(options.db, page.id)
    if (stored !== null) return resultFrom(stored, pageUrl, true)
  }

  const keys = readJinaSecrets(options)
  const secrets = [...(options.secrets ?? []), ...keys.map((key) => key.secret)]
  const delayMs = options.delayMs ?? 0
  if (delayMs > 0) await (options.sleep ?? delay)(delayMs)

  const attempt = await fetchPage(options, pageUrl, keys, secrets)
  if (attempt === null) {
    throw new PipelineError(failureMessage(options), {
      code: 'fetch_failed',
      nextStep: failureNextStep(options),
      secrets
    })
  }
  const clock = options.clock ?? Date.now
  const started = clock()
  const extracted = extractAttempt(attempt)
  // Only a direct read sees the HTML head and the response headers.
  const eligibility =
    attempt.method === 'direct' ? readEligibility(attempt.body, attempt.headers) : null
  const durationMs = Math.max(0, clock() - started)
  const now = options.now ?? (() => new Date().toISOString())
  const previous = getLatestSnapshot(options.db, page.id)
  if (previous !== null && previous.contentHash === extracted.contentHash) {
    options.logger.info('page read reused snapshot', {
      pageId: page.id,
      method: attempt.method,
      contentHash: previous.contentHash
    })
    keepRead(options, previous, extracted, now())
    // Robots rules can change while the text stays the same.
    if (eligibility !== null) {
      setSnapshotEligibility(options.db, previous.id, eligibility)
      return resultFrom({ ...previous, eligibility }, pageUrl, true)
    }
    return resultFrom(previous, pageUrl, true)
  }
  const snapshot = snapshotFrom(page.id, attempt, extracted, durationMs, now(), eligibility)
  insertSnapshot(options.db, snapshot)
  keepRead(options, snapshot, extracted, snapshot.fetchedAt)
  if (snapshot.title !== null) {
    setPageTitleIfEmpty(options.db, page.id, snapshot.title, options.projectId)
  }
  options.logger.info('page read stored', {
    pageId: page.id,
    method: snapshot.method,
    status: snapshot.httpStatus,
    contentHash: snapshot.contentHash
  })
  return resultFrom(snapshot, pageUrl, false)
}

/**
 * Page change history: the read, its dates, and any change since the read before.
 * A failure here never fails the read itself.
 */
function keepRead(
  options: ReadPageOptions,
  snapshot: StoredSnapshot,
  extracted: ExtractedPage,
  readAt: string
): void {
  try {
    const change = recordPageRead(options.db, {
      pageId: snapshot.pageId,
      snapshot,
      readAt,
      publishedAt: canonicalDate(extracted.publishedAt),
      modifiedAt: canonicalDate(extracted.modifiedAt)
    })
    if (change !== null) {
      options.logger.info('page change seen', { pageId: snapshot.pageId, changeId: change.id })
    }
  } catch (error) {
    options.logger.warn('page read history not saved', {
      pageId: snapshot.pageId,
      message: error instanceof Error ? error.message : 'unknown'
    })
  }
}

async function fetchPage(
  options: ReadPageOptions,
  pageUrl: string,
  keys: readonly JinaSecret[],
  secrets: readonly string[]
): Promise<FetchedPage | null> {
  if (options.reader === 'file') {
    const text = options.suppliedText ?? ''
    if (text.trim().length === 0) return null
    return { method: 'file', status: null, body: text }
  }
  const mode =
    options.reader === 'auto' ? options.jinaMode : options.reader === 'jina' ? 'always' : 'never'
  if (mode !== 'always') {
    const direct = await fetchDirect(options, pageUrl, secrets)
    if (direct !== null) {
      return { method: 'direct', status: direct.status, body: direct.body, headers: direct.headers }
    }
    if (mode === 'never') return null
  }
  const jina = await fetchJina(options, pageUrl, keys, secrets)
  if (jina === null) return null
  return { method: 'jina', status: jina.status, body: jina.body }
}

function extractAttempt(attempt: {
  method: StoredSnapshot['method']
  body: string
}): ExtractedPage {
  if (attempt.method === 'jina') return extractJinaBody(attempt.body)
  if (attempt.method === 'file') return extractMarkdown(attempt.body)
  return extractHtml(attempt.body)
}

interface FetchedPage {
  method: StoredSnapshot['method']
  status: number | null
  body: string
  /** The final response's headers. Direct reads only. */
  headers?: Readonly<Record<string, string>>
}

async function fetchDirect(
  options: ReadPageOptions,
  pageUrl: string,
  secrets: readonly string[]
): Promise<{ status: number; body: string; headers: Readonly<Record<string, string>> } | null> {
  const resolve = options.dns ?? systemAddressLookup()
  let current = pageUrl
  for (let hop = 0; ; hop += 1) {
    await assertPublicPageUrl(current, resolve)
    let response: HttpResponse
    try {
      response = await requestWithRetry(
        options.transport,
        {
          method: 'GET',
          url: current,
          headers: {
            accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8',
            'user-agent': CITEFOX_USER_AGENT,
            'cache-control': 'no-cache',
            pragma: 'no-cache'
          },
          // Connect-time check: the transport connects only to addresses this
          // returns, so DNS cannot change between the check above and the socket.
          resolveHost: (hostname) => resolvePublicAddresses(hostname, resolve),
          maxBodyBytes: MAX_PAGE_BYTES
        },
        { timeoutMs: FETCH_TIMEOUT_MS, label: 'Page fetch', secrets, sleep: options.sleep }
      )
    } catch (error) {
      options.logger.warn('direct page fetch failed', {
        message: redactString(error instanceof Error ? error.message : 'fetch failed', { secrets })
      })
      return null
    }
    if (isRedirect(response.status)) {
      if (hop >= MAX_DIRECT_REDIRECTS) {
        throw new PipelineError('The page redirected too many times.', {
          code: 'fetch_failed',
          nextStep: 'Use a URL that does not redirect, and read the page again.'
        })
      }
      current = nextHop(current, response.headers)
      continue
    }
    if (response.status < 200 || response.status >= 300) {
      options.logger.warn('direct page fetch failed', { status: response.status })
      return null
    }
    const contentType = headerValue(response.headers, 'content-type')
    if (!isReadablePageContentType(contentType)) {
      options.logger.warn('direct page fetch skipped a non-HTML response', {
        status: response.status,
        contentType: contentType?.slice(0, 80) ?? null
      })
      return null
    }
    const size = response.bytes?.byteLength ?? Buffer.byteLength(response.body, 'utf8')
    if (size > MAX_PAGE_BYTES) {
      options.logger.warn('direct page fetch was too large', { bytes: size })
      return null
    }
    const body =
      response.bytes === undefined ? response.body : decodePageBytes(response.bytes, contentType)
    if (body.trim().length === 0) {
      options.logger.warn('direct page fetch failed', { status: response.status })
      return null
    }
    return { status: response.status, body, headers: response.headers ?? {} }
  }
}

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308
}

function nextHop(current: string, headers: Readonly<Record<string, string>> | undefined): string {
  const location = headerValue(headers, 'location')
  if (location === null || location.trim().length === 0) {
    throw new PipelineError('The page redirect had no destination.', {
      code: 'fetch_failed',
      nextStep: 'Use a URL that does not redirect, and read the page again.'
    })
  }
  try {
    return new URL(location, current).href
  } catch {
    throw new PipelineError('The page redirect had no destination.', {
      code: 'fetch_failed',
      nextStep: 'Use a URL that does not redirect, and read the page again.'
    })
  }
}

function headerValue(
  headers: Readonly<Record<string, string>> | undefined,
  name: string
): string | null {
  if (headers === undefined) return null
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === name) return value
  }
  return null
}

/**
 * FR-11.5. Each key in order; a key Reader refuses, that is out of credit, or that is
 * rate-limited moves the read to the next key. After the last key (or with no key),
 * Reader is called without a key at the lower rate limit. A failure that is about the
 * page or the network stops at once: another key would not help.
 */
async function fetchJina(
  options: ReadPageOptions,
  pageUrl: string,
  keys: readonly JinaSecret[],
  secrets: readonly string[]
): Promise<{ status: number; body: string } | null> {
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]
    if (key === undefined) continue
    const response = await jinaRead(options, pageUrl, key.secret, secrets)
    options.jinaHooks?.onRead?.(key.ref.id.length > 0 ? key.ref.id : null)
    if (response !== null && !jinaFailed(response.status, response.body)) return response
    if (response === null || !jinaKeyProblem(response.status, response.body)) return null
    options.logger.warn('jina key refused, moving on', { status: response.status })
    options.jinaHooks?.onFailover?.(key.ref, keys[index + 1]?.ref ?? null)
  }
  const keyless = await jinaRead(options, pageUrl, null, secrets)
  options.jinaHooks?.onRead?.(null)
  if (keyless === null || jinaFailed(keyless.status, keyless.body)) return null
  return keyless
}

async function jinaRead(
  options: ReadPageOptions,
  pageUrl: string,
  secret: string | null,
  secrets: readonly string[]
): Promise<{ status: number; body: string } | null> {
  try {
    const client = createJinaReaderClient({
      transport: options.transport,
      logger: options.logger,
      sleep: options.sleep,
      secrets
    })
    const response = await client.read(pageUrl, secret)
    if (jinaFailed(response.status, response.body)) {
      options.logger.warn('jina page fetch failed', { status: response.status })
    }
    return response
  } catch (error) {
    options.logger.warn('jina page fetch failed', {
      message: redactString(error instanceof Error ? error.message : 'fetch failed', { secrets })
    })
    return null
  }
}

/** The key, not the page: refused (401, 403), out of credit (402), or rate-limited (429). */
function jinaKeyProblem(status: number, body: string): boolean {
  if (KEY_PROBLEM_STATUSES.has(status)) return true
  try {
    const parsed: unknown = JSON.parse(body)
    return (
      isRecord(parsed) && typeof parsed.code === 'number' && KEY_PROBLEM_STATUSES.has(parsed.code)
    )
  } catch {
    return false
  }
}

const KEY_PROBLEM_STATUSES: ReadonlySet<number> = new Set([401, 402, 403, 429])

function jinaFailed(status: number, body: string): boolean {
  if (status < 200 || status >= 300) return true
  if (body.trim().length === 0) return true
  try {
    const parsed: unknown = JSON.parse(body)
    if (isRecord(parsed) && typeof parsed.code === 'number' && parsed.code >= 400) return true
  } catch {
    // Markdown is a successful body.
  }
  return false
}

function snapshotFrom(
  pageId: string,
  attempt: { method: StoredSnapshot['method']; status: number | null; body: string },
  extracted: ExtractedPage,
  durationMs: number,
  fetchedAt: string,
  eligibility: StoredSnapshot['eligibility']
): StoredSnapshot {
  return {
    id: `snap-${randomUUID()}`,
    pageId,
    fetchedAt,
    method: attempt.method,
    httpStatus: attempt.status,
    durationMs,
    title: extracted.title,
    metaDescription: extracted.metaDescription,
    h1: extracted.h1,
    canonical: extracted.canonical,
    publishedAt: canonicalDate(extracted.publishedAt),
    modifiedAt: canonicalDate(extracted.modifiedAt),
    outline: extracted.outline,
    faqs: extracted.faqs,
    h2Count: extracted.h2Count,
    h3Count: extracted.h3Count,
    tableCount: extracted.tableCount,
    bodyText: extracted.bodyText,
    wordCount: extracted.wordCount,
    contentHash: extracted.contentHash,
    summary: null,
    eligibility
  }
}

/** The shared page-read summary for a stored snapshot. A later get is not a reuse. */
export function snapshotReadResult(snapshot: StoredSnapshot, pageUrl: string): PageReadResult {
  return resultFrom(snapshot, pageUrl, false)
}

function resultFrom(
  snapshot: StoredSnapshot,
  pageUrl: string,
  snapshotReused: boolean
): PageReadResult {
  return {
    id: snapshot.id,
    pageId: snapshot.pageId,
    fetchedAt: snapshot.fetchedAt,
    method: snapshot.method,
    httpStatus: snapshot.httpStatus,
    durationMs: snapshot.durationMs,
    title: snapshot.title,
    titleLength: snapshot.title?.length ?? 0,
    metaDescription: snapshot.metaDescription,
    metaDescriptionLength: snapshot.metaDescription?.length ?? 0,
    h1: snapshot.h1,
    titleMatchesH1: titleMatchesH1(snapshot.title, snapshot.h1),
    canonical: snapshot.canonical,
    canonicalMatchesPage: canonicalMatches(snapshot.canonical, pageUrl),
    publishedAt: snapshot.publishedAt,
    modifiedAt: snapshot.modifiedAt,
    h2Count: snapshot.h2Count,
    h3Count: snapshot.h3Count,
    tableCount: snapshot.tableCount,
    outline: snapshot.outline,
    faqs: snapshot.faqs,
    wordCount: snapshot.wordCount,
    contentHash: snapshot.contentHash,
    snapshotReused,
    flags: pageReadFlags({
      title: snapshot.title,
      metaDescription: snapshot.metaDescription,
      h1: snapshot.h1
    }),
    eligibility: snapshot.eligibility ?? null,
    summary: snapshot.summary,
    message: 'Read the page.',
    nextStep: null
  }
}

function canonicalDate(value: string | null): string | null {
  if (value === null || value.length === 0) return null
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.toISOString()
}

function canonicalMatches(canonical: string | null, pageUrl: string): boolean | null {
  if (canonical === null) return null
  return stripSlash(canonical) === stripSlash(pageUrl)
}

function stripSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value
}

interface JinaSecret {
  ref: JinaKeyRef
  secret: string
}

/** Keys in order with their secrets. A key missing from the keychain is skipped. */
function readJinaSecrets(options: ReadPageOptions): JinaSecret[] {
  const refs: readonly JinaKeyRef[] =
    options.jinaKeys ??
    (options.jinaKeychainRef === null
      ? []
      : [{ id: '', name: 'Page reader', keychainRef: options.jinaKeychainRef }])
  const found: JinaSecret[] = []
  for (const ref of refs) {
    try {
      const secret = options.secretStore.get(ref.keychainRef)
      if (secret !== null && secret.length > 0) found.push({ ref, secret })
    } catch (error) {
      options.logger.warn('jina key read failed', {
        message: redactString(error instanceof Error ? error.message : 'keychain failed', {
          secrets: options.secrets
        })
      })
    }
  }
  return found
}

function failureMessage(options: ReadPageOptions): string {
  if (options.reader === 'file') return 'The supplied page text was empty.'
  if (options.reader === 'jina' || (options.reader === 'auto' && options.jinaMode === 'always')) {
    return 'Could not read the page with the page reader.'
  }
  if (options.reader === 'direct' || (options.reader === 'auto' && options.jinaMode === 'never')) {
    return 'Could not read the page. the page reader is off, and the direct fetch failed.'
  }
  return 'Could not read the page. The direct fetch and the page reader both failed.'
}

function failureNextStep(options: ReadPageOptions): string {
  if (options.reader === 'file') return 'Choose a file that contains the page text and read again.'
  if (options.reader === 'jina' || (options.reader === 'auto' && options.jinaMode === 'always')) {
    return 'Check the page reader key in Connections and read the page again.'
  }
  if (options.reader === 'direct' || (options.reader === 'auto' && options.jinaMode === 'never')) {
    return 'Turn the page reader on as a fallback, or read the page again.'
  }
  return 'Check the URL and the page reader key, then read the page again.'
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
