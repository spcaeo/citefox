import { ENGINE_LABEL, isEngineId } from '@shared/domain'
import type { SqliteDatabase } from '../storage/database'

/** The report lists at most this many recent failures. */
export const FAILED_CHECKS_LIMIT = 30

/** A question text shorter than this is not worth hiding inside a message. */
const MIN_HIDDEN_QUESTION = 8

export interface FailedCheck {
  /** Engine name as the app shows it ("ChatGPT", "Google AI Overview"). */
  engine: string
  /** The stored reason code, such as `rate_limited`. */
  code: string
  /** The stored reason message, with the question text hidden unless the person ticked it. */
  message: string
  /** UTC time of the check, ISO 8601. */
  at: string
  /** The question text. Set only when the person ticked "Include my question texts". */
  question: string | null
}

export interface FailedCheckSummary {
  /** Most recent first, at most {@link FAILED_CHECKS_LIMIT}. */
  recent: readonly FailedCheck[]
  /** Failures per engine and reason code across the same projects, most common first. */
  counts: readonly { engine: string; code: string; count: number }[]
  /** Projects that could not be read. */
  unreadable: number
}

interface Row {
  engine: string
  code: string | null
  message: string | null
  at: string | null
  label: string | null
}

/** Google AI Overview samples that ended in an error. */
const GOOGLE_FAILURES = `
  SELECT 'google_aio' AS engine, s.error_code AS code, s.message AS message,
         COALESCE(r.finished_at, r.started_at) AS at, p.label AS label
  FROM serp_results s
  JOIN runs r ON r.id = s.run_id
  LEFT JOIN prompts p ON p.id = s.prompt_id
  WHERE s.status = 'error'`

/** Answer-engine replies that ended in an error or "unavailable". */
const ENGINE_FAILURES = `
  SELECT a.engine AS engine, a.error_code AS code, a.message AS message,
         a.checked_at AS at, p.label AS label
  FROM engine_answers a
  LEFT JOIN prompts p ON p.id = a.prompt_id
  WHERE a.status IN ('error', 'unavailable')`

function engineName(engine: string): string {
  return isEngineId(engine) ? ENGINE_LABEL[engine] : 'Unknown engine'
}

/** Replaces each question text in `message` with a mark, so a failure reason never carries one. */
function withoutQuestions(message: string, labels: readonly string[]): string {
  let text = message
  for (const label of labels) {
    if (label.length < MIN_HIDDEN_QUESTION) continue
    text = text.split(label).join('[question]')
  }
  return text
}

function rowsOf(db: SqliteDatabase, sql: string): Row[] {
  try {
    return db
      .prepare<unknown[], Row>(`${sql} ORDER BY at DESC LIMIT ${FAILED_CHECKS_LIMIT * 4}`)
      .all()
  } catch {
    // An older project file without this table: nothing to report from it.
    return []
  }
}

/** The recent failures stored in one project file, newest first, before the final cut. */
export function readProjectFailures(db: SqliteDatabase, includeQuestions: boolean): FailedCheck[] {
  const rows = [...rowsOf(db, GOOGLE_FAILURES), ...rowsOf(db, ENGINE_FAILURES)]
  const labels = rows.map((row) => row.label).filter((label): label is string => label !== null)
  return rows
    .filter((row) => row.at !== null)
    .map((row) => ({
      engine: engineName(row.engine),
      code: row.code ?? 'unknown',
      message: includeQuestions ? (row.message ?? '') : withoutQuestions(row.message ?? '', labels),
      at: row.at ?? '',
      question: includeQuestions ? row.label : null
    }))
}

/** Joins the failures of several project files into the summary the report prints. */
export function summariseFailures(
  perProject: readonly (readonly FailedCheck[])[],
  unreadable: number
): FailedCheckSummary {
  const all = perProject.flat().sort((left, right) => right.at.localeCompare(left.at))
  const tally = new Map<string, { engine: string; code: string; count: number }>()
  for (const item of all) {
    const key = `${item.engine}\u0000${item.code}`
    const found = tally.get(key)
    if (found) found.count += 1
    else tally.set(key, { engine: item.engine, code: item.code, count: 1 })
  }
  return {
    recent: all.slice(0, FAILED_CHECKS_LIMIT),
    counts: [...tally.values()].sort((left, right) => right.count - left.count).slice(0, 12),
    unreadable
  }
}
