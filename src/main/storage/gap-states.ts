import { isGapStatus, type GapRowState, type GapStatus } from '@shared/ipc'
import type { SqliteDatabase } from './database'
import { StorageError } from './errors'
import { assertId, requireUtcTimestamp } from './values'

/** `gap_states` in a project database (migration 041). */

/** Longest stored FAQ question and answer, in characters. */
export const GAP_FAQ_QUESTION_MAX = 300
export const GAP_FAQ_ANSWER_MAX = 2000

interface GapStateSql {
  prompt_id: string
  status: string | null
  published_url: string | null
  faq_question: string | null
  faq_answer: string | null
  updated_at: string
}

export function listGapStates(db: SqliteDatabase, pageId: string): GapRowState[] {
  assertId(pageId)
  return db
    .prepare<unknown[], GapStateSql>(
      `SELECT prompt_id, status, published_url, faq_question, faq_answer, updated_at
       FROM gap_states WHERE page_id = ? ORDER BY prompt_id`
    )
    .all(pageId)
    .map(fromSql)
}

export interface GapStatePatch {
  status?: GapStatus | null
  publishedUrl?: string | null
  /** Null drops the person's draft (Claude's shows again). */
  faq?: { question: string; answer: string } | null
}

/** Writes the changed fields of one prompt's state; a row with nothing left is removed. */
export function writeGapState(
  db: SqliteDatabase,
  pageId: string,
  promptId: string,
  patch: GapStatePatch,
  at: string
): GapRowState | null {
  assertId(pageId)
  assertId(promptId)
  const updatedAt = requireUtcTimestamp(at)
  const current = listGapStates(db, pageId).find((state) => state.promptId === promptId) ?? null
  const status = patch.status !== undefined ? patch.status : (current?.status ?? null)
  if (status !== null && !isGapStatus(status)) throw new StorageError('Unknown gap status')
  const publishedUrl =
    patch.publishedUrl !== undefined ? patch.publishedUrl : (current?.publishedUrl ?? null)
  if (publishedUrl !== null && (publishedUrl.length === 0 || publishedUrl.length > 2000)) {
    throw new StorageError('Invalid published URL')
  }
  const faq =
    patch.faq !== undefined
      ? patch.faq
      : current?.faq
        ? { question: current.faq.question, answer: current.faq.answer }
        : null
  if (faq !== null) {
    if (faq.question.length === 0 || faq.question.length > GAP_FAQ_QUESTION_MAX) {
      throw new StorageError('Invalid FAQ question')
    }
    if (faq.answer.length === 0 || faq.answer.length > GAP_FAQ_ANSWER_MAX) {
      throw new StorageError('Invalid FAQ answer')
    }
  }
  if (status === null && publishedUrl === null && faq === null) {
    db.prepare('DELETE FROM gap_states WHERE page_id = ? AND prompt_id = ?').run(pageId, promptId)
    return null
  }
  db.prepare(
    `INSERT INTO gap_states (page_id, prompt_id, status, published_url, faq_question, faq_answer, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (page_id, prompt_id) DO UPDATE SET
       status = excluded.status,
       published_url = excluded.published_url,
       faq_question = excluded.faq_question,
       faq_answer = excluded.faq_answer,
       updated_at = excluded.updated_at`
  ).run(
    pageId,
    promptId,
    status,
    publishedUrl,
    faq?.question ?? null,
    faq?.answer ?? null,
    updatedAt
  )
  return listGapStates(db, pageId).find((state) => state.promptId === promptId) ?? null
}

function fromSql(row: GapStateSql): GapRowState {
  const faq =
    row.faq_question !== null && row.faq_answer !== null
      ? {
          question: row.faq_question,
          answer: row.faq_answer,
          wordCount: countWords(row.faq_answer)
        }
      : null
  return {
    promptId: row.prompt_id,
    status: isGapStatus(row.status) ? row.status : null,
    publishedUrl: row.published_url,
    faq,
    updatedAt: row.updated_at
  }
}

export function countWords(text: string): number {
  const trimmed = text.trim()
  return trimmed ? trimmed.split(/\s+/).length : 0
}
