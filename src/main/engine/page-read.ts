import type { JinaMode, PageReadMethod, PageReadReader } from '@shared/domain'
import type { PageReadResult, StartPageReadRequest } from '@shared/ipc'
import { PipelineError } from '../pipeline/errors'
import { readPage, snapshotReadResult, type ReadPageOptions } from '../pipeline/page-reader'
import type { SqliteDatabase } from '../storage/database'
import { getLatestSnapshot } from '../storage/content-records'
import type { EngineHost } from './host'
import { jinaHooks, jinaKeysInOrder } from './jina-keys'
import { requirePage } from './page-access'
import { withProject } from './project-db'

export function startPageRead(
  host: EngineHost,
  request: StartPageReadRequest
): Promise<PageReadResult> {
  const channel = 'pages:readStart'
  return withProject(host, request.projectId, channel, async (opened) => {
    const page = requirePage(opened.db, request.pageId, request.projectId, channel)
    const settings = host.settings()
    host.emitPageReadProgress({
      pageId: page.id,
      phase: 'fetch',
      state: 'running',
      detail: 'Reading the page.',
      nextStep: null
    })
    try {
      const result = await readPage(
        trackedReadOptions(host, opened.db, request.projectId, page.id, {
          reader: request.reader,
          suppliedText: request.suppliedText
        })
      )
      host.emitPageReadProgress({
        pageId: page.id,
        phase: 'fetch',
        state: 'ok',
        detail: 'Fetched the page.',
        nextStep: null
      })
      host.emitPageReadProgress({
        pageId: page.id,
        phase: 'extract',
        state: 'running',
        detail: 'Extracting the page.',
        nextStep: null
      })
      host.emitPageReadProgress({
        pageId: page.id,
        phase: 'extract',
        state: 'ok',
        detail: 'Extracted the page.',
        nextStep: null
      })
      host.emitPageReadProgress({
        pageId: page.id,
        phase: 'summary',
        state: 'running',
        detail: 'Summarizing the page.',
        nextStep: null
      })
      host.emitPageReadProgress({
        pageId: page.id,
        phase: 'summary',
        state: 'ok',
        detail: result.summary === null ? 'No summary yet.' : 'Summarized the page.',
        nextStep: null
      })
      return result
    } catch (error) {
      if (error instanceof PipelineError && error.code === 'fetch_failed') {
        host.emitPageReadProgress({
          pageId: page.id,
          phase: 'fetch',
          state: 'warning',
          detail: error.message,
          nextStep: error.nextStep
        })
        return failedRead(host, page.id, request.reader, settings.jinaMode, error)
      }
      host.emitPageReadProgress({
        pageId: page.id,
        phase: 'fetch',
        state: 'warning',
        detail: error instanceof Error ? error.message : 'The read failed.',
        nextStep: null
      })
      throw error
    }
  })
}

/**
 * The options every read of a tracked page uses, so each one (Read the page again,
 * scheduled reads, page edits) also lands in the page's change history.
 */
export function trackedReadOptions(
  host: EngineHost,
  db: SqliteDatabase,
  projectId: string,
  pageId: string,
  read: { reader: PageReadReader; suppliedText: string | null }
): ReadPageOptions {
  return {
    db,
    transport: host.http,
    logger: host.logger,
    secretStore: host.secrets,
    jinaKeychainRef: null,
    jinaKeys: jinaKeysInOrder(host.storage),
    jinaHooks: jinaHooks(host, projectId),
    reader: read.reader,
    jinaMode: host.settings().jinaMode,
    pageId,
    projectId,
    ...(host.pageDns !== undefined ? { dns: host.pageDns } : {}),
    suppliedText: read.suppliedText,
    now: () => host.now().toISOString(),
    clock: () => host.now().getTime(),
    secrets: host.knownSecrets()
  }
}

/**
 * A tracked page read now inside an already opened project (page edits on a page
 * never read before). Returns null when the read fails; never throws.
 */
export async function readTrackedPageNow(
  host: EngineHost,
  db: SqliteDatabase,
  projectId: string,
  pageId: string
): Promise<PageReadResult | null> {
  try {
    return await readPage(
      trackedReadOptions(host, db, projectId, pageId, { reader: 'auto', suppliedText: null })
    )
  } catch (error) {
    host.logger.info('tracked page read failed', {
      pageId,
      message: error instanceof Error ? error.message : 'unknown'
    })
    return null
  }
}

export function getPageRead(
  host: EngineHost,
  projectId: string,
  pageId: string
): Promise<PageReadResult | null> {
  return withProject(host, projectId, 'pages:getRead', (opened) => {
    const page = requirePage(opened.db, pageId, projectId, 'pages:getRead')
    const snapshot = getLatestSnapshot(opened.db, page.id)
    // A topic's snapshot is its definition, not a page read.
    if (snapshot === null || page.url === null) return null
    return snapshotReadResult(snapshot, page.url)
  })
}

/**
 * A failed read still resolves (NFR-10). It does not insert a snapshot row,
 * so `id` and `contentHash` stay null (FR-2.3).
 */
function failedRead(
  host: EngineHost,
  pageId: string,
  reader: PageReadReader,
  jinaMode: JinaMode,
  error: PipelineError
): PageReadResult {
  return {
    id: null,
    pageId,
    fetchedAt: host.now().toISOString(),
    method: failedMethod(reader, jinaMode),
    httpStatus: null,
    durationMs: 0,
    title: null,
    titleLength: 0,
    metaDescription: null,
    metaDescriptionLength: 0,
    h1: null,
    titleMatchesH1: null,
    canonical: null,
    canonicalMatchesPage: null,
    publishedAt: null,
    modifiedAt: null,
    h2Count: 0,
    h3Count: 0,
    tableCount: 0,
    outline: [],
    faqs: [],
    wordCount: 0,
    contentHash: null,
    snapshotReused: false,
    flags: [],
    eligibility: null,
    summary: null,
    message: error.message,
    nextStep: error.nextStep
  }
}

function failedMethod(reader: PageReadReader, jinaMode: JinaMode): PageReadMethod {
  if (reader === 'file') return 'file'
  if (reader === 'jina' || (reader === 'auto' && jinaMode === 'always')) return 'jina'
  return 'direct'
}
