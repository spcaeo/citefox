import type { PromptGoogleSearch, PromptOwnRank } from '@shared/domain'
import { isOwnHost } from '@shared/own-site'
import { normaliseQuestion } from '@shared/question-text'
import {
  googleExtrasFromRaw,
  NO_EXTRAS,
  ORGANIC_TOP,
  type GoogleExtras,
  type OrganicResult
} from '../../providers/serpapi/extras'
import { isRecord } from '../../providers/json-schema'
import type { SqliteDatabase } from '../../storage/database'
import {
  listGoogleJson,
  listSampleIds,
  listTrackedQuestionTexts,
  listUnreadSearchBodies,
  saveGoogleJson
} from '../../storage/google-extras-records'
import { normalizeUrl } from './url'

/** "People also ask" shown on the prompt page. */
export const PROMPT_QUESTIONS_MAX = 6
/** "Seen on Google" offered in Add questions. */
export const SEEN_ON_GOOGLE_MAX = 10

/** `serp_results.google_json` for a capture (written with the sample). */
export function encodeGoogleExtras(extras: GoogleExtras): string {
  return JSON.stringify({ organic: extras.organic, questions: extras.questions })
}

/** The stored JSON, checked. Anything odd reads as no extras. */
export function decodeGoogleExtras(json: string): GoogleExtras {
  let parsed: unknown
  try {
    parsed = JSON.parse(json) as unknown
  } catch {
    return NO_EXTRAS
  }
  if (!isRecord(parsed)) return NO_EXTRAS
  const organic = Array.isArray(parsed.organic)
    ? parsed.organic.flatMap((item): OrganicResult[] =>
        isRecord(item) &&
        typeof item.position === 'number' &&
        typeof item.url === 'string' &&
        typeof item.domain === 'string'
          ? [{ position: item.position, url: item.url, domain: item.domain }]
          : []
      )
    : null
  const questions = Array.isArray(parsed.questions)
    ? parsed.questions.filter((item): item is string => typeof item === 'string')
    : []
  return { organic, questions }
}

/**
 * The extras of these samples by id. Samples stored before migration 044 are read
 * from their stored search body now, once, and saved, so later reads are cheap and a
 * second call reads nothing again. A missing, cut-off or old-format body saves "no
 * extras" so it is not parsed again either.
 */
export function googleExtrasFor(
  db: SqliteDatabase,
  ids: readonly string[]
): Map<string, GoogleExtras> {
  const unique = [...new Set(ids)]
  const found = new Map<string, GoogleExtras>()
  const unread: string[] = []
  for (const row of listGoogleJson(db, unique)) {
    if (row.googleJson === null) unread.push(row.id)
    else found.set(row.id, decodeGoogleExtras(row.googleJson))
  }
  if (unread.length > 0) {
    const filled = listUnreadSearchBodies(db, unread).map((row) => {
      const extras = googleExtrasFromRaw(row.rawSearchJson)
      found.set(row.id, extras)
      return { id: row.id, googleJson: encodeGoogleExtras(extras) }
    })
    saveGoogleJson(db, filled)
  }
  return found
}

export interface OwnSite {
  ownDomain: string
  includeSubdomains: boolean
}

/**
 * The prompt page's Google facts. `sampleIds` are this market's samples of the
 * prompt (the rank); `allMarketSampleIds` add the page's other markets' latest
 * samples of the same prompt (the questions).
 */
export function promptGoogleSearch(
  db: SqliteDatabase,
  input: {
    sampleIds: readonly string[]
    otherSampleIds: readonly string[]
    pageUrl: string | null
    site: OwnSite
    /** True when a question passes the page's or topic's question checks as it is. */
    trackable: (text: string) => boolean
  }
): PromptGoogleSearch {
  const extras = googleExtrasFor(db, [...input.sampleIds, ...input.otherSampleIds])
  const here = input.sampleIds.flatMap((id) => {
    const item = extras.get(id)
    return item === undefined ? [] : [item]
  })
  const lists = here.flatMap((item) => (item.organic === null ? [] : [item.organic]))
  return {
    ownRank: ownRank(lists, input.pageUrl, input.site),
    hasResults: lists.length > 0,
    questions: rankQuestions(
      [...input.sampleIds, ...input.otherSampleIds].map((id) => extras.get(id) ?? NO_EXTRAS),
      listTrackedQuestionTexts(db),
      PROMPT_QUESTIONS_MAX
    ).map((text) => ({ text, trackable: input.trackable(text) }))
  }
}

/** The best own result across the samples' top 10s; this page wins a tie. */
export function ownRank(
  lists: readonly (readonly OrganicResult[])[],
  pageUrl: string | null,
  site: OwnSite
): PromptOwnRank | null {
  const target = pageUrl === null ? null : normalizeUrl(pageUrl)
  let best: PromptOwnRank | null = null
  for (const list of lists) {
    for (const result of list) {
      if (result.position > ORGANIC_TOP) continue
      if (!isOwnHost(result.domain, site.ownDomain, site.includeSubdomains)) continue
      const thisPage = target !== null && normalizeUrl(result.url) === target
      if (
        best === null ||
        result.position < best.position ||
        (result.position === best.position && thisPage && !best.thisPage)
      ) {
        best = { position: result.position, url: result.url, thisPage }
      }
    }
  }
  return best
}

/**
 * "People also ask" across samples: repeats merged (case, punctuation and spaces
 * ignored), questions already tracked anywhere left out, the most often asked
 * first, then in the order Google showed them.
 */
export function rankQuestions(
  extras: readonly GoogleExtras[],
  tracked: readonly string[],
  max: number
): string[] {
  const skip = new Set(tracked.map((text) => normaliseQuestion(text)))
  const seen = new Map<string, { text: string; count: number; first: number }>()
  let order = 0
  for (const item of extras) {
    for (const text of item.questions) {
      const key = normaliseQuestion(text)
      if (key.length === 0 || skip.has(key)) continue
      const known = seen.get(key)
      if (known) known.count += 1
      else seen.set(key, { text, count: 1, first: order })
      order += 1
    }
  }
  return [...seen.values()]
    .sort((left, right) => right.count - left.count || left.first - right.first)
    .slice(0, max)
    .map((item) => item.text)
}

/** "Seen on Google" for a page or topic: the questions of its latest checks in every market. */
export function seenOnGoogle(db: SqliteDatabase, runIds: readonly string[]): string[] {
  if (runIds.length === 0) return []
  const ids = listSampleIds(db, runIds, null)
  const extras = googleExtrasFor(db, ids)
  return rankQuestions(
    ids.map((id) => extras.get(id) ?? NO_EXTRAS),
    listTrackedQuestionTexts(db),
    SEEN_ON_GOOGLE_MAX
  )
}

/** The samples of these runs for one prompt. */
export function promptSampleIds(
  db: SqliteDatabase,
  runIds: readonly string[],
  promptId: string
): string[] {
  return runIds.length === 0 ? [] : listSampleIds(db, runIds, promptId)
}
