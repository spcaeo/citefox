import type { PageSummary } from '@shared/domain'
import { INDEX_SEARCHES_MAX, INDEX_SEARCHES_MIN, type IndexState } from '@shared/fix-loop'
import type {
  IndexCheckPreview,
  IndexCheckRequest,
  IndexCheckResult,
  IndexCheckRun,
  RunIndexCheckRequest
} from '@shared/ipc'
import { IpcRequestError } from '../../ipc-request'
import { usageMonth } from '../../keys/present'
import { isRecord } from '../../providers/json-schema'
import { capAllowance } from '../../queue/usage'
import type { QueueProjectInput } from '../../queue/types'
import type { SqliteDatabase } from '../../storage/database'
import { insertIndexCheck } from '../../storage/fix-loop-records'
import { getPage } from '../../storage/pages'
import { getMarket, readProjectProfile } from '../../storage/project-profile'
import { readEffectiveScheduleCap } from '../../storage/project-schedule'
import type { ProjectRecord } from '../../storage/records'
import {
  createCapGate,
  createKeyRotation,
  keyRoom,
  keyUsageForMonth,
  loadRotationKeys,
  projectUsedForMonth,
  type RotatedCapture
} from '../checks/key-rotation'
import { normalizeUrl } from '../checks/url'
import type { EngineHost } from '../host'
import { isOpenPage } from './runs'

/**
 * "Check index": one Google `site:<address>` search per page through SerpApi, with the
 * same key rotation, `key_usage` charging and project cap as a check. It only runs
 * after the person confirmed the preview's top figure, so it never spends more than
 * they saw. Each result is stored in `index_checks`; the newest row is the page's state.
 */

export type IndexHost = Pick<
  EngineHost,
  'storage' | 'secrets' | 'logger' | 'http' | 'now' | 'createId' | 'knownSecrets'
>

const NO_KEY = 'Turn on a SerpApi key in Connections first. No search was sent.'
const NO_PAGES = 'Pick at least one page with an address. No search was sent.'
const KEYS_OUT =
  'No SerpApi key can search right now (out of searches or refused). The rest were not checked.'
const CAP_REACHED = "The project's search cap is reached. The rest were not checked."
const CHANGED = 'The number of searches changed. Look at the preview again, then confirm.'
const NO_MARKET = 'This page has no market, so no search was sent.'
const UNREADABLE = 'SerpApi returned a result CiteFox could not read.'

/** SerpApi says this when Google has nothing for the query: for `site:` that is "not indexed". */
const NO_RESULTS = /hasn['’]t returned any results|no results/i

interface Planned {
  preview: IndexCheckPreview
  pages: (PageSummary & { url: string })[]
  queue: QueueProjectInput
  month: string
  /** The project's allowance this month. Null: no cap. */
  allowance: number | null
}

/** `fixes:indexPreview`. Reads keys, usage and the cap; sends nothing. */
export function indexPreview(
  host: IndexHost,
  db: SqliteDatabase,
  project: ProjectRecord,
  request: IndexCheckRequest
): IndexCheckPreview {
  return plan(host, db, project, request).preview
}

function plan(
  host: IndexHost,
  db: SqliteDatabase,
  project: ProjectRecord,
  request: IndexCheckRequest
): Planned {
  const pages = request.pageIds.flatMap((pageId) => {
    const page = getPage(db, pageId, project.id)
    return page !== null && isOpenPage(page) ? [page] : []
  })
  const month = usageMonth(host.now())
  const cap = readEffectiveScheduleCap(db, month)
  const queue: QueueProjectInput = {
    projectId: project.id,
    name: project.name,
    cap: cap.cap,
    capRule: cap.capRule,
    dedicatedKeyId: cap.dedicatedKeyId,
    paused: false
  }
  const allowance = cap.cap === null ? null : capAllowance(cap.cap, cap.capRule)
  const capRoom =
    allowance === null
      ? null
      : Math.max(0, allowance - projectUsedForMonth(host.storage, project.id, month))
  const keys = loadRotationKeys(host.storage, queue)
  const used = keyUsageForMonth(host.storage, month)
  let keysRoom: number | null = 0
  for (const key of keys) {
    const room = keyRoom(key, used.get(key.keyId) ?? 0)
    keysRoom = keysRoom === null || room >= Number.MAX_SAFE_INTEGER ? null : keysRoom + room
  }
  const left =
    capRoom === null ? keysRoom : keysRoom === null ? capRoom : Math.min(capRoom, keysRoom)
  const searchesMin = pages.length * INDEX_SEARCHES_MIN
  const searchesMax = pages.length * INDEX_SEARCHES_MAX
  const reason =
    keys.length === 0
      ? NO_KEY
      : pages.length === 0
        ? NO_PAGES
        : left !== null && searchesMax > left
          ? `This check needs up to ${searchesMax} searches and ${left} ${left === 1 ? 'is' : 'are'} left this month. No search was sent.`
          : null
  return {
    preview: {
      pages: pages.length,
      searchesMin,
      searchesMax,
      left,
      canRun: reason === null,
      reason
    },
    pages,
    queue,
    month,
    allowance
  }
}

/**
 * `fixes:checkIndex`. Refused unless the preview can run and the person confirmed its
 * `searchesMax`. Stops early when the cap is reached or every key is out of searches.
 */
export async function checkIndex(
  host: IndexHost,
  db: SqliteDatabase,
  project: ProjectRecord,
  request: RunIndexCheckRequest
): Promise<IndexCheckRun> {
  const channel = 'fixes:checkIndex'
  const planned = plan(host, db, project, request)
  if (!planned.preview.canRun) {
    throw new IpcRequestError(channel, planned.preview.reason ?? 'The index check cannot run.')
  }
  if (request.confirmedSearches !== planned.preview.searchesMax) {
    throw new IpcRequestError(channel, CHANGED)
  }
  const projectMarket = readProjectProfile(db)?.market ?? null
  const rotation = createKeyRotation(host, {
    project: planned.queue,
    usageProjectId: project.id,
    month: planned.month,
    chargeUsage: true
  })
  const gate = createCapGate({
    allowance: planned.allowance,
    used: () => projectUsedForMonth(host.storage, project.id, planned.month)
  })
  const results: IndexCheckResult[] = []
  let searchesUsed = 0
  let stoppedReason: string | null = null
  for (const page of planned.pages) {
    const pageMarket =
      (page.defaultMarketId === null ? null : getMarket(db, page.defaultMarketId)) ?? projectMarket
    if (pageMarket === null) {
      results.push(store(host, db, page, { state: 'unknown', message: NO_MARKET }, 0))
      continue
    }
    if (rotation.exhausted()) {
      stoppedReason = KEYS_OUT
      break
    }
    const capture = await rotation.capture(
      {
        q: `site:${siteTarget(page.url)}`,
        gl: pageMarket.country,
        hl: pageMarket.language,
        location: pageMarket.serpapiLocation ?? pageMarket.location,
        device: pageMarket.device
      },
      gate
    )
    searchesUsed += capture.searches
    if (capture.exhausted) {
      stoppedReason = KEYS_OUT
      break
    }
    if (capture.halted && capture.searches === 0) {
      stoppedReason = CAP_REACHED
      break
    }
    results.push(store(host, db, page, indexStateOf(capture, page.url), capture.searches))
    if (gate.capHit()) {
      stoppedReason = CAP_REACHED
      break
    }
  }
  if (stoppedReason !== null && results.length === planned.pages.length) stoppedReason = null
  return { results, searchesUsed, stoppedReason }
}

function store(
  host: IndexHost,
  db: SqliteDatabase,
  page: PageSummary & { url: string },
  found: { state: IndexState; message: string | null },
  searches: number
): IndexCheckResult {
  const checkedAt = host.now().toISOString()
  insertIndexCheck(db, {
    id: `idx-${host.createId()}`,
    pageId: page.id,
    url: page.url,
    state: found.state,
    checkedAt,
    searches,
    message: found.message
  })
  return { pageId: page.id, check: { state: found.state, checkedAt, message: found.message } }
}

/** The address without its scheme or trailing slash: `site:example.com/pricing`. */
export function siteTarget(url: string): string {
  return url.replace(/^https?:\/\//i, '').replace(/\/+$/, '')
}

/**
 * Indexed when an organic result is the page (same address after normalising, so
 * http, www and a trailing slash do not matter). Not indexed when Google returned
 * other results or none. Unknown when the search failed (a rejected key, a timeout).
 */
export function indexStateOf(
  capture: Pick<RotatedCapture, 'rawSearchJson' | 'message'>,
  pageUrl: string
): { state: IndexState; message: string | null } {
  const body = parseBody(capture.rawSearchJson)
  const target = normalizeUrl(pageUrl)
  if (body !== null && Array.isArray(body.organic_results)) {
    const found = body.organic_results.some(
      (result) =>
        isRecord(result) &&
        typeof result.link === 'string' &&
        target !== null &&
        normalizeUrl(result.link) === target
    )
    return { state: found ? 'indexed' : 'not_indexed', message: null }
  }
  if (body !== null && typeof body.error === 'string' && NO_RESULTS.test(body.error)) {
    return { state: 'not_indexed', message: null }
  }
  if (body !== null && body.error === undefined && capture.message === null) {
    return { state: 'not_indexed', message: null }
  }
  return { state: 'unknown', message: capture.message ?? UNREADABLE }
}

function parseBody(raw: string | null): Record<string, unknown> | null {
  if (raw === null) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}
