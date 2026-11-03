import { redactString } from '../../logging/redact'
import { isRecord } from '../json-schema'
import { overviewHasContent, readAiOverview, type ParsedAiOverview } from './overview'

export const SERPAPI_SEARCH_URL = 'https://serpapi.com/search.json'

/** Why a SerpApi body is not a usable search. `empty` is FR-5.5's empty call. */
export interface SerpApiSearchFailure {
  code: 'rejected' | 'out_of_searches' | 'rate_limited' | 'empty' | 'other'
  message: string
}

export interface InterpretedSearch {
  failure: SerpApiSearchFailure | null
  /** SERP-3: the page token expired. The caller runs the search pair once more. */
  expired: boolean
  /** The overview must be fetched with `engine=google_ai_overview`. */
  pageToken: string | null
  /** An overview with content. Null with no failure and no token means no AIO. */
  overview: ParsedAiOverview | null
}

const UNREADABLE = 'The search service sent an answer CiteFox could not read. Try the check again.'
const NO_OVERVIEW = 'CiteFox could not read an AI Overview for this search. Try the check again.'

/**
 * Reads one SerpApi JSON body. Messages are fixed sentences: they never hold the
 * response body, the key, or a page token. An out-of-searches error is reported
 * as such whatever the HTTP status, including a 429 (FR-11.3).
 * `followUp` marks a `google_ai_overview` response, where a missing overview is
 * an empty call (FR-5.5), not "no AIO".
 */
export function interpretSearch(
  status: number,
  bodyText: string,
  secrets: readonly string[],
  followUp = false
): InterpretedSearch {
  let parsed: unknown
  try {
    parsed = JSON.parse(bodyText) as unknown
  } catch {
    return failure('other', UNREADABLE)
  }
  if (!isRecord(parsed)) return failure('other', UNREADABLE)
  const errorText = typeof parsed.error === 'string' ? redactString(parsed.error, { secrets }) : ''
  if (/page token/i.test(errorText) && /expir/i.test(errorText)) {
    return { failure: null, expired: true, pageToken: null, overview: null }
  }
  if (status === 401 || status === 403 || /invalid api key/i.test(errorText)) {
    return failure('rejected', 'SerpApi rejected this key.')
  }
  if (/out of searches/i.test(errorText)) {
    return failure('out_of_searches', 'This key is out of searches for the month.')
  }
  if (status === 429) return failure('rate_limited', 'SerpApi is limiting this key.')
  if (status !== 200 || errorText.length > 0) return failure('other', NO_OVERVIEW)
  const overview = readAiOverview(parsed.ai_overview)
  if (overview === null) {
    return followUp
      ? failure('empty', 'The AI Overview follow-up came back empty.')
      : { failure: null, expired: false, pageToken: null, overview: null }
  }
  if (overview.error !== null) {
    return failure('other', 'The search service could not load the AI Overview for this search.')
  }
  if (overviewHasContent(overview)) {
    return { failure: null, expired: false, pageToken: null, overview }
  }
  if (overview.pageToken !== null && !followUp) {
    return { failure: null, expired: false, pageToken: overview.pageToken, overview: null }
  }
  return failure(
    'empty',
    followUp
      ? 'The AI Overview follow-up came back empty.'
      : 'The search service returned an empty AI Overview.'
  )
}

function failure(code: SerpApiSearchFailure['code'], message: string): InterpretedSearch {
  return { failure: { code, message }, expired: false, pageToken: null, overview: null }
}
