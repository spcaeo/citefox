import { ENGINE_LABEL, type EngineId } from '@shared/domain'
import { isRecord } from '../json-schema'

/** cloro's API (https://cloro.dev/docs). A key is sent as `Authorization: Bearer <key>`. */
export const CLORO_BASE_URL = 'https://api.cloro.dev'

/** Not billable: cloro charges 0 credits for it, so a key test costs nothing. */
export const CLORO_CREDITS_URL = `${CLORO_BASE_URL}/v1/credits`

/** Sync monitor endpoints, one per engine. Google AI Overview rides on the Google search. */
export const CLORO_ENGINE_PATH: Readonly<Record<EngineId, string>> = {
  google_aio: '/v1/monitor/google',
  chatgpt: '/v1/monitor/chatgpt',
  perplexity: '/v1/monitor/perplexity',
  google_ai_mode: '/v1/monitor/aimode',
  gemini: '/v1/monitor/gemini',
  copilot: '/v1/monitor/copilot'
}

export function cloroEngineUrl(engine: EngineId): string {
  return `${CLORO_BASE_URL}${CLORO_ENGINE_PATH[engine]}`
}

/**
 * cloro asks sync clients for at least 5 minutes: it retries upstream for up to that long,
 * and closing the connection early loses a result it may still bill.
 */
export const CLORO_TIMEOUT_MS = 300_000

export interface CloroQuery {
  /** The question as searched. */
  q: string
  /** ISO 3166-1 alpha-2, any case. */
  gl: string
  hl: string
  /** Google canonical location (the market's SerpApi location uses the same names). */
  location: string | null
  device: string
}

/** cloro wants an uppercase ISO code; `UK` is SerpApi's spelling of `GB`. */
export function cloroCountry(gl: string): string {
  const upper = gl.trim().toUpperCase()
  return upper === 'UK' ? 'GB' : upper
}

/** The JSON body of one sync call. Google gets the AI Overview add-on with markdown. */
export function cloroRequestBody(engine: EngineId, query: CloroQuery): Record<string, unknown> {
  const country = cloroCountry(query.gl)
  if (engine === 'google_aio') {
    const body: Record<string, unknown> = {
      query: query.q,
      country,
      hl: query.hl.toLowerCase(),
      device: query.device,
      include: { aioverview: { markdown: true } }
    }
    if (query.location !== null && query.location.trim().length > 0) {
      body.location = query.location
    }
    return body
  }
  return { prompt: query.q, country, include: { markdown: true } }
}

/**
 * Why a cloro call did not give a result. `unavailable` is the engine being down at
 * cloro (`MODEL_UNAVAILABLE`, or not served in that country): shown, not charged, and
 * tried again at the next check. `retryable` is a failure cloro does not bill (a 429 or
 * a 5xx), so one more try cannot cost twice.
 */
export interface CloroFailure {
  code: 'rejected' | 'out_of_searches' | 'rate_limited' | 'unavailable' | 'empty' | 'other'
  message: string
  retryable: boolean
}

const UNREADABLE = 'cloro returned a response CiteFox could not read.'

/**
 * Reads cloro's error envelope (`{ success: false, error: { code, message } }`). Null
 * for a 200 with `success` not false. Messages are fixed sentences: they never hold the
 * response body or the key.
 */
export function readCloroFailure(
  engine: EngineId,
  status: number,
  bodyText: string
): CloroFailure | null {
  let parsed: unknown
  try {
    parsed = bodyText.trim().length === 0 ? null : (JSON.parse(bodyText) as unknown)
  } catch {
    parsed = null
  }
  const error = isRecord(parsed) && isRecord(parsed.error) ? parsed.error : null
  const code = error !== null && typeof error.code === 'string' ? error.code : ''
  const message = error !== null && typeof error.message === 'string' ? error.message : ''
  if (code === 'MODEL_UNAVAILABLE' || /not available in this country/i.test(message)) {
    return {
      code: 'unavailable',
      message: `${ENGINE_LABEL[engine]} is not available at cloro right now. CiteFox tries again at the next check.`,
      retryable: false
    }
  }
  if (status === 401 || /API_KEY/.test(code)) {
    return { code: 'rejected', message: 'cloro rejected this key.', retryable: false }
  }
  if (status === 403 || code === 'INSUFFICIENT_CREDITS') {
    return {
      code: 'out_of_searches',
      message: 'This cloro key is out of credits.',
      retryable: false
    }
  }
  if (status === 429) {
    return { code: 'rate_limited', message: 'cloro is limiting this key.', retryable: true }
  }
  if (status === 500 || status === 502 || status === 503 || status === 504) {
    return { code: 'other', message: 'cloro could not answer this call.', retryable: true }
  }
  if (status !== 200) {
    return {
      code: 'other',
      message:
        status === 400 ? 'cloro did not accept this request.' : 'cloro did not answer this call.',
      retryable: false
    }
  }
  if (!isRecord(parsed)) return { code: 'empty', message: UNREADABLE, retryable: false }
  if (parsed.success === false || !isRecord(parsed.result)) {
    return { code: 'other', message: UNREADABLE, retryable: false }
  }
  return null
}

/** `X-Credits-Charged` from a sync response. Null when cloro did not send it. */
export function creditsCharged(
  headers: Readonly<Record<string, string>> | undefined
): number | null {
  if (headers === undefined) return null
  const match = Object.keys(headers).find((key) => key.toLowerCase() === 'x-credits-charged')
  if (match === undefined) return null
  const raw = headers[match]?.trim() ?? ''
  if (raw.length === 0) return null
  const value = Number(raw)
  return Number.isFinite(value) && value >= 0 ? Math.trunc(value) : null
}

/** One cited source of an answer: the place it holds, its address and its label. */
export interface CloroSource {
  position: number
  url: string
  title: string | null
}

/**
 * `sources` in cloro's order, then citation pills whose URL is not already a source.
 * Positions are renumbered 1, 2, 3 so they read as "cited Nth".
 */
export function readCloroSources(sources: unknown, pills: unknown): CloroSource[] {
  const seen = new Set<string>()
  const found: CloroSource[] = []
  const add = (item: unknown): void => {
    if (!isRecord(item) || typeof item.url !== 'string') return
    const url = item.url.trim()
    if (url.length === 0 || url.length > 2000 || !/^https?:\/\//i.test(url) || seen.has(url)) return
    seen.add(url)
    const label = typeof item.label === 'string' ? item.label.trim() : ''
    found.push({ position: found.length + 1, url, title: label.length === 0 ? null : label })
  }
  const ordered = Array.isArray(sources) ? [...sources] : []
  ordered.sort((left, right) => positionOf(left) - positionOf(right))
  for (const item of ordered) add(item)
  if (Array.isArray(pills)) for (const item of pills) add(item)
  return found
}

function positionOf(item: unknown): number {
  return isRecord(item) && typeof item.position === 'number' ? item.position : Number.MAX_VALUE
}

export function textOf(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length === 0 ? null : trimmed
}
