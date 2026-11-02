import type { PageKind } from '@shared/domain'
import {
  QUESTION_SEARCH_LIMIT,
  type QuestionSearchHit,
  type SearchQuestionsRequest,
  type SearchQuestionsResult
} from '@shared/ipc'
import { askPageLabel } from '../ask/query'
import { plain, readId, requireKeys } from '../engine/grid/parse'
import { IpcRequestError } from '../ipc-request'
import type { SqliteDatabase } from '../storage/database'

const CHANNEL = 'search:questions'

/** As long as `pages:search` takes: a search box, not a document. */
const MAX_QUERY = 200

/** Words matched at most; more only slow the statement and narrow nothing a person typed. */
const MAX_WORDS = 8

export function parseSearchQuestions(value: unknown): SearchQuestionsRequest {
  const record = plain(value, CHANNEL)
  requireKeys(record, CHANNEL, ['projectId', 'query'])
  const query = record.query
  if (typeof query !== 'string' || query.length > MAX_QUERY || query.includes('\0')) {
    throw new IpcRequestError(CHANNEL)
  }
  return { projectId: readId(record.projectId, CHANNEL), query }
}

interface HitSql {
  prompt_id: string
  source_id: string
  kind: PageKind
  label: string | null
  title: string | null
  url: string | null
  text: string
}

/**
 * Words of `query`, lower-cased, at most `MAX_WORDS`. SQLite's `lower()` folds ASCII
 * letters only, so the match is case-insensitive for ASCII and exact for the rest.
 */
function wordsOf(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean).slice(0, MAX_WORDS)
}

/**
 * `search:questions`: one statement over the project file (NFR-12). Every prompt of a
 * tracked, setting-up or paused page's or topic's active set is a candidate, enabled
 * or not, as on the Questions screen. A prompt matches when one of its market
 * wordings holds every word (`**` emphasis ignored); that wording is the one shown,
 * the source's default market first. `instr` keeps the words literal, so `%` and `_`
 * need no escaping. The statement reads one row past the limit to tell `more`.
 */
export function searchQuestions(db: SqliteDatabase, query: string): SearchQuestionsResult {
  const words = wordsOf(query)
  if (words.length === 0) return { questions: [], more: false }
  const plainText = (column: string): string => `replace(lower(${column}), '**', '')`
  const holdsEvery = words.map(() => `instr(${plainText('v.text')}, ?) > 0`).join(' AND ')
  const rows = db
    .prepare<unknown[], HitSql>(
      `SELECT prompts.id AS prompt_id, pages.id AS source_id, pages.kind, pages.label,
              pages.title, pages.url, hit.text
       FROM prompts
       JOIN prompt_sets ON prompt_sets.id = prompts.prompt_set_id AND prompt_sets.is_active = 1
       JOIN pages ON pages.id = prompt_sets.page_id
         AND pages.status IN ('tracked', 'setting_up', 'paused')
       JOIN prompt_variants AS hit ON hit.prompt_id = prompts.id AND hit.market_id = (
         SELECT v.market_id FROM prompt_variants AS v
         WHERE v.prompt_id = prompts.id AND ${holdsEvery}
         ORDER BY (v.market_id = pages.default_market_id) DESC, v.market_id ASC
         LIMIT 1
       )
       ORDER BY CASE WHEN instr(${plainText('hit.text')}, ?) > 0
                     THEN instr(${plainText('hit.text')}, ?) ELSE ${MAX_QUERY * 100} END ASC,
                length(hit.text) ASC, pages.rowid ASC, prompts.position ASC
       LIMIT ?`
    )
    .all(...words, words.join(' '), words.join(' '), QUESTION_SEARCH_LIMIT + 1)
  return {
    questions: rows.slice(0, QUESTION_SEARCH_LIMIT).map(toHit),
    more: rows.length > QUESTION_SEARCH_LIMIT
  }
}

function toHit(row: HitSql): QuestionSearchHit {
  const topic = row.kind === 'topic'
  return {
    promptId: row.prompt_id,
    sourceId: row.source_id,
    sourceKind: topic ? 'topic' : 'page',
    sourceName: topic ? row.title?.trim() || 'Topic' : askPageLabel(row),
    text: row.text
  }
}
