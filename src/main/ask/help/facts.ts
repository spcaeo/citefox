import type { SqliteDatabase } from '../../storage/database'
import { readProjectSchedule } from '../../storage/project-schedule'

/**
 * Facts about the project's checks that help answers need besides the counts
 * in the context packet: how many checks have finished, when the next one is,
 * and how many fixes are logged. "Why is What changed empty?" is then
 * answered with "You have 1 check, so What changed waits for the next one on
 * Nov 9, 2026." Read from the project file in code; never a search.
 */

export interface CheckFacts {
  /** Finished checks (one Check now, or one scheduled check, across its pages). */
  checks: number
  firstCheckAt: string | null
  latestCheckAt: string | null
  /** Null while paused or when nothing is planned. */
  nextCheckAt: string | null
  paused: boolean
  intervalDays: number
  fixes: number
}

export function readCheckFacts(db: SqliteDatabase, projectId: string): CheckFacts {
  const runs = safe(
    () =>
      db
        .prepare<unknown[], { checks: number; first: string | null; latest: string | null }>(
          `SELECT COUNT(DISTINCT job_id) AS checks, MIN(finished_at) AS first, MAX(finished_at) AS latest
           FROM runs WHERE status = 'finished'`
        )
        .get(),
    undefined
  )
  const fixes = safe(
    () => db.prepare<unknown[], { n: number }>('SELECT COUNT(*) AS n FROM fixes').get()?.n ?? 0,
    0
  )
  const schedule = safe(() => readProjectSchedule(db, projectId), null)
  return {
    checks: runs?.checks ?? 0,
    firstCheckAt: runs?.first ?? null,
    latestCheckAt: runs?.latest ?? null,
    nextCheckAt: schedule === null || schedule.paused ? null : schedule.nextCheckAt,
    paused: schedule?.paused ?? false,
    intervalDays: schedule?.defaultIntervalDays ?? 0,
    fixes
  }
}

/** The facts as prompt lines. Dates read "Nov 9, 2026 (2026-11-09)" so the number check passes them. */
export function checkFactsText(facts: CheckFacts, dayText: (iso: string | null) => string): string {
  const lines = [
    facts.checks === 0
      ? 'Checks finished: 0 (no check has finished yet, so no screen has results).'
      : `Checks finished: ${facts.checks} (first ${dayText(facts.firstCheckAt)}, latest ${dayText(facts.latestCheckAt)}).`,
    facts.checks === 1
      ? 'Only one check so far: anything that compares two checks (What changed, movement, trends, fix verdicts) waits for the next check.'
      : null,
    facts.paused
      ? 'Scheduled checks are paused for this project.'
      : facts.nextCheckAt === null
        ? 'Next scheduled check: none planned.'
        : `Next scheduled check: ${dayText(facts.nextCheckAt)}.`,
    facts.intervalDays > 0 && !facts.paused
      ? `Checks repeat every ${facts.intervalDays} days.`
      : null,
    `Fixes logged: ${facts.fixes}.`
  ]
  return lines.filter((line): line is string => line !== null).join('\n')
}

function safe<T>(read: () => T, fallback: T): T {
  try {
    return read()
  } catch {
    return fallback
  }
}
