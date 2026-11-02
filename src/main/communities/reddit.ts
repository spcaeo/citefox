import type { ThreadCheckResult } from '@shared/domain'
import { brandNamed } from '../engine/checks/classify'
import { requestWithRetry, type HttpTransport } from '../providers/http'
import { isRecord } from '../providers/json-schema'
import type { SqliteDatabase } from '../storage/database'
import { brandSentence, threadExcerpt } from './excerpt'
import { redditThreadOf } from './source-type'
import { listRedditThreads, upsertRedditThread, type RedditThreadRow } from './store'

/** One request at a time, this far apart. Reddit's public JSON is rate limited per address. */
export const REDDIT_MIN_INTERVAL_MS = 2500

/** At most this many threads are read per "Check threads". The rest wait for the next run. */
export const REDDIT_MAX_PER_RUN = 25

/** A thread read within this window is not read again unless forced. */
export const REDDIT_CACHE_MS = 24 * 60 * 60 * 1000

const REDDIT_TIMEOUT_MS = 15_000
/** Every request goes to this one fixed origin; only a validated post id comes from stored data. */
const REDDIT_ORIGIN = 'https://www.reddit.com'
const MAX_BODY_BYTES = 2 * 1024 * 1024

export interface RedditDeps {
  http: HttpTransport
  /** SSRF guard: every address the host may be reached at, each validated (fetch-guard). */
  resolveHost?: (hostname: string) => Promise<readonly string[]>
  sleep: (ms: number) => Promise<void>
  now: () => Date
  userAgent: string
  minIntervalMs?: number
  maxPerRun?: number
}

class RedditSlowDown extends Error {}

/**
 * FR-17.4. Reads public Reddit data for cited threads, on demand: comment
 * count, upvotes, posted date, archived and locked ("Can we reply?"), and
 * whether the brand is named. Nothing is posted (FR-17.7). One request at a
 * time with a pause between, cached for a day; a 429 stops the run.
 */
export async function checkRedditThreads(
  deps: RedditDeps,
  db: SqliteDatabase,
  urls: readonly string[],
  options: { force: boolean; brandNames: readonly string[] }
): Promise<ThreadCheckResult> {
  const cache = listRedditThreads(db)
  const nowMs = deps.now().getTime()
  const wanted = [...new Set(urls)]
  const due: string[] = []
  let cached = 0
  for (const url of wanted) {
    const row = cache.get(url)
    const fresh =
      row !== undefined && row.error === null && nowMs - Date.parse(row.checkedAt) < REDDIT_CACHE_MS
    if (fresh && !options.force) cached += 1
    else due.push(url)
  }
  const cap = deps.maxPerRun ?? REDDIT_MAX_PER_RUN
  let skipped = Math.max(0, due.length - cap)
  let checked = 0
  let failed = 0
  let message: string | null =
    skipped > 0
      ? `Read ${cap} threads this time. Check threads again for the other ${skipped}.`
      : null
  const batch = due.slice(0, cap)
  for (let index = 0; index < batch.length; index += 1) {
    const url = batch[index] ?? ''
    if (index > 0) await deps.sleep(deps.minIntervalMs ?? REDDIT_MIN_INTERVAL_MS)
    try {
      const row = await fetchThread(deps, url, options.brandNames)
      upsertRedditThread(db, row)
      if (row.error === null) checked += 1
      else failed += 1
    } catch (error) {
      if (error instanceof RedditSlowDown) {
        skipped += batch.length - index
        message = 'Reddit asked CiteFox to slow down. Try Check threads again in a few minutes.'
        break
      }
      failed += 1
      upsertRedditThread(db, failedRow(url, deps.now(), 'Could not read this thread.'))
    }
  }
  return { checked, cached, failed, skipped, message }
}

async function fetchThread(
  deps: RedditDeps,
  url: string,
  brandNames: readonly string[]
): Promise<RedditThreadRow> {
  const parsed = redditThreadOf(url)
  const now = deps.now()
  if (parsed?.threadId === null || parsed === null) {
    return failedRow(url, now, 'This link is not a Reddit thread.')
  }
  const get = (target: string): ReturnType<typeof requestWithRetry> =>
    requestWithRetry(
      deps.http,
      {
        method: 'GET',
        url: target,
        headers: { 'User-Agent': deps.userAgent, Accept: 'application/json' },
        maxBodyBytes: MAX_BODY_BYTES,
        ...(deps.resolveHost !== undefined ? { resolveHost: deps.resolveHost } : {})
      },
      { timeoutMs: REDDIT_TIMEOUT_MS, label: 'Reddit', attempts: 1, sleep: deps.sleep }
    )
  let response = await get(`${REDDIT_ORIGIN}/comments/${parsed.threadId}.json?limit=100&raw_json=1`)
  // The transport never follows redirects. One hop is followed here, and only on Reddit itself.
  const next = sameOriginRedirect(response.status, response.headers?.location)
  if (next !== null) {
    await deps.sleep(deps.minIntervalMs ?? REDDIT_MIN_INTERVAL_MS)
    response = await get(next)
  }
  if (response.status === 429) throw new RedditSlowDown()
  if (response.status === 404 || response.status === 403) {
    return failedRow(url, now, 'The thread is removed or private.')
  }
  if (response.status < 200 || response.status >= 300) {
    return failedRow(url, now, `Reddit answered ${response.status}.`)
  }
  return parseThread(url, response.body, brandNames, now, parsed.subreddit)
}

/** Parses `/comments/<id>.json`: `[post listing, comment listing]`. */
export function parseThread(
  url: string,
  body: string,
  brandNames: readonly string[],
  now: Date,
  subreddit: string | null
): RedditThreadRow {
  let json: unknown
  try {
    json = JSON.parse(body)
  } catch {
    return failedRow(url, now, 'Reddit sent something CiteFox could not read.')
  }
  const post = firstChild(Array.isArray(json) ? json[0] : json)
  if (post === null) return failedRow(url, now, 'Reddit sent something CiteFox could not read.')
  const comments = Array.isArray(json) ? commentBodies(json[1]) : []
  const title = text(post.title)
  const selftext = text(post.selftext)
  const created = num(post.created_utc)
  const haystack = [title ?? '', selftext ?? '', ...comments].join('\n')
  const postParts = [title, selftext].filter((part): part is string => part !== null)
  return {
    url,
    threadId: text(post.id),
    subreddit: text(post.subreddit_name_prefixed) ?? subreddit,
    title,
    comments: nonNegative(num(post.num_comments)),
    upvotes: num(post.score),
    archived: post.archived === true,
    locked: post.locked === true,
    postedAt: created === null ? null : new Date(created * 1000).toISOString(),
    brandNamed: brandNames.length === 0 ? null : brandNamed(haystack, brandNames),
    excerpt: threadExcerpt(title, selftext),
    brandQuote: brandSentence(postParts, comments, brandNames),
    checkedAt: now.toISOString(),
    error: null
  }
}

function firstChild(listing: unknown): Record<string, unknown> | null {
  if (!isRecord(listing) || !isRecord(listing.data)) return null
  const children = listing.data.children
  if (!Array.isArray(children)) return null
  const first: unknown = children[0]
  if (!isRecord(first) || !isRecord(first.data)) return null
  return first.data
}

/** Comment bodies, replies included, depth-first. */
function commentBodies(listing: unknown, depth = 0): string[] {
  if (depth > 8 || !isRecord(listing) || !isRecord(listing.data)) return []
  const children = listing.data.children
  if (!Array.isArray(children)) return []
  const bodies: string[] = []
  for (const child of children as unknown[]) {
    if (!isRecord(child) || !isRecord(child.data)) continue
    const body = text(child.data.body)
    if (body !== null) bodies.push(body)
    bodies.push(...commentBodies(child.data.replies, depth + 1))
  }
  return bodies
}

/** A 3xx `Location` on https://www.reddit.com, as an absolute URL. Null otherwise. */
export function sameOriginRedirect(status: number, location: string | undefined): string | null {
  if (status < 300 || status > 399 || location === undefined) return null
  try {
    const target = new URL(location, REDDIT_ORIGIN)
    return target.origin === REDDIT_ORIGIN ? target.toString() : null
  } catch {
    return null
  }
}

function failedRow(url: string, now: Date, error: string): RedditThreadRow {
  const parsed = redditThreadOf(url)
  return {
    url,
    threadId: parsed?.threadId ?? null,
    subreddit: parsed?.subreddit ?? null,
    title: null,
    comments: null,
    upvotes: null,
    archived: null,
    locked: null,
    postedAt: null,
    brandNamed: null,
    excerpt: null,
    brandQuote: null,
    checkedAt: now.toISOString(),
    error
  }
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function nonNegative(value: number | null): number | null {
  return value === null ? null : Math.max(0, Math.round(value))
}
