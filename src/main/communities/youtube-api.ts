import { ProviderError } from '../providers/errors'
import { requestWithRetry, type HttpTransport } from '../providers/http'
import { isRecord } from '../providers/json-schema'
import type { YoutubeVideoRow } from './store'

/** videos.list takes at most 50 ids per call (one quota unit each call). */
export const YOUTUBE_BATCH = 50

const API = 'https://www.googleapis.com/youtube/v3'
const TIMEOUT_MS = 15_000

export interface YoutubeApiDeps {
  http: HttpTransport
  sleep: (ms: number) => Promise<void>
  now: () => Date
  /** Exact secrets to mask in errors. The key is always one of them. */
  secrets: readonly string[]
}

/**
 * FR-11.9 and FR-17.4. Read-only YouTube Data API calls with the user's own key:
 * title, channel, views, publish date and length, batched 50 ids per call.
 * An id the API does not return is stored as missing (private or removed).
 */
export async function fetchVideoDetails(
  deps: YoutubeApiDeps,
  key: string,
  videoIds: readonly string[]
): Promise<YoutubeVideoRow[]> {
  const rows: YoutubeVideoRow[] = []
  const ids = [...new Set(videoIds)]
  for (let start = 0; start < ids.length; start += YOUTUBE_BATCH) {
    const batch = ids.slice(start, start + YOUTUBE_BATCH)
    const url = `${API}/videos?part=snippet,statistics,contentDetails&maxResults=${YOUTUBE_BATCH}&id=${batch
      .map(encodeURIComponent)
      .join(',')}&key=${encodeURIComponent(key)}`
    const json = await getJson(deps, key, url)
    const fetchedAt = deps.now().toISOString()
    const found = new Map<string, YoutubeVideoRow>()
    const items = isRecord(json) && Array.isArray(json.items) ? (json.items as unknown[]) : []
    for (const item of items) {
      const row = videoRow(item, fetchedAt)
      if (row !== null) found.set(row.videoId, row)
    }
    for (const id of batch) {
      rows.push(
        found.get(id) ?? {
          videoId: id,
          title: null,
          channelId: null,
          channelTitle: null,
          views: null,
          publishedAt: null,
          durationSeconds: null,
          fetchedAt,
          missing: true
        }
      )
    }
  }
  return rows
}

/** FR-18.10. A handle (`@name`) to its channel id. Null when no channel has that handle. */
export async function resolveChannelHandle(
  deps: YoutubeApiDeps,
  key: string,
  handle: string
): Promise<string | null> {
  const url = `${API}/channels?part=id&forHandle=${encodeURIComponent(handle)}&key=${encodeURIComponent(key)}`
  const json = await getJson(deps, key, url)
  const items = isRecord(json) && Array.isArray(json.items) ? (json.items as unknown[]) : []
  const first: unknown = items[0]
  return isRecord(first) && typeof first.id === 'string' ? first.id : null
}

async function getJson(deps: YoutubeApiDeps, key: string, url: string): Promise<unknown> {
  const secrets = [...deps.secrets, key]
  const response = await requestWithRetry(
    deps.http,
    { method: 'GET', url, headers: { Accept: 'application/json' } },
    { timeoutMs: TIMEOUT_MS, label: 'YouTube Data API', secrets, sleep: deps.sleep, attempts: 2 }
  )
  if (response.status === 200) {
    try {
      return JSON.parse(response.body) as unknown
    } catch {
      throw apiError('YouTube sent something CiteFox could not read.', 'malformed', secrets)
    }
  }
  const reason = errorReason(response.body)
  if (response.status === 403 && reason === 'quotaExceeded') {
    throw apiError(
      "The YouTube key has used today's quota. Views and dates refresh tomorrow.",
      'plan_limit',
      secrets
    )
  }
  if (response.status === 400 || response.status === 401 || response.status === 403) {
    throw apiError(
      'YouTube rejected the key. Check the YouTube Data API key in Connections.',
      'unauthorized',
      secrets
    )
  }
  throw apiError(`YouTube answered ${response.status}. Try again later.`, 'network', secrets)
}

function apiError(
  message: string,
  code: 'malformed' | 'plan_limit' | 'unauthorized' | 'network',
  secrets: readonly string[]
): ProviderError {
  return new ProviderError(message, { code, state: 'warning', nextStep: null, secrets })
}

function errorReason(body: string): string | null {
  try {
    const json = JSON.parse(body) as unknown
    if (!isRecord(json) || !isRecord(json.error) || !Array.isArray(json.error.errors)) return null
    const first: unknown = json.error.errors[0]
    return isRecord(first) && typeof first.reason === 'string' ? first.reason : null
  } catch {
    return null
  }
}

function videoRow(item: unknown, fetchedAt: string): YoutubeVideoRow | null {
  if (!isRecord(item) || typeof item.id !== 'string' || item.id.length !== 11) return null
  const snippet = isRecord(item.snippet) ? item.snippet : {}
  const statistics = isRecord(item.statistics) ? item.statistics : {}
  const details = isRecord(item.contentDetails) ? item.contentDetails : {}
  const views = typeof statistics.viewCount === 'string' ? Number(statistics.viewCount) : NaN
  return {
    videoId: item.id,
    title: typeof snippet.title === 'string' ? snippet.title : null,
    channelId: typeof snippet.channelId === 'string' ? snippet.channelId : null,
    channelTitle: typeof snippet.channelTitle === 'string' ? snippet.channelTitle : null,
    views: Number.isFinite(views) && views >= 0 ? Math.round(views) : null,
    publishedAt: typeof snippet.publishedAt === 'string' ? snippet.publishedAt : null,
    durationSeconds: typeof details.duration === 'string' ? isoDuration(details.duration) : null,
    fetchedAt,
    missing: false
  }
}

/** `PT1H2M3S` → 3723. Null for anything else. */
export function isoDuration(value: string): number | null {
  const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(value)
  if (match === null) return null
  const [, d, h, m, s] = match
  return Number(d ?? 0) * 86400 + Number(h ?? 0) * 3600 + Number(m ?? 0) * 60 + Number(s ?? 0)
}
