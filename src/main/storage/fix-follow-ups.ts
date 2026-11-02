import { isFixKind, type FixKind } from '@shared/domain'
import type { SqliteDatabase } from './database'
import { isSqliteError } from './database'
import { StorageError } from './errors'
import { assertId, readJson, requireStoredText, requireUtcTimestamp } from './values'

/**
 * SCH-10, FR-14.5, FR-14.6. Section 10 `fixes` and `fix_prompts` in the project
 * database. One row is one logged fix. `markets` is the chosen market ids on
 * that fix, not a row per market. Targeted prompts live in `fix_prompts`.
 *
 * `rule` uses the scheduler's recheck set: `after_3_days`, `after_7_days`,
 * `next_scheduled`. `status` is derived: `planned` when `followup_run_id` is
 * null, `completed` when it is set. `goLiveAt` is column `live_on`
 * (ISO-8601 UTC, NFR-15). `projectId` is not a column.
 *
 * `followUpRunId` is section 10 `followup_run_id`. The runs table is later, so
 * this stores the id only. `verdict` is the FR-14.7 text, null until then.
 * The fix number is assigned per page and is only on the stored record.
 */
export const FIX_FOLLOW_UP_RULES = ['after_3_days', 'after_7_days', 'next_scheduled'] as const
export type FixFollowUpRule = (typeof FIX_FOLLOW_UP_RULES)[number]

export const FIX_FOLLOW_UP_STATUSES = ['planned', 'completed'] as const
export type FixFollowUpStatus = (typeof FIX_FOLLOW_UP_STATUSES)[number]

export interface NewFixFollowUp {
  id: string
  pageId: string
  /** What changed (SRS `description`). */
  description: string
  /** ISO-8601 UTC go-live. Column `live_on`. */
  goLiveAt: string
  rule: FixFollowUpRule
  promptIds: readonly string[]
  /** Column `markets`. */
  marketIds: readonly string[]
  /** Next number on the page when omitted. */
  number?: number
  /** ISO-8601 UTC when the fix was logged. Column `created_at` (migration 016). */
  createdAt?: string
  /** New page, rewrite or fix. Column `kind` (migration 043). Defaults to `fix`. */
  kind?: FixKind
  /** The page address, when `pageId` is a topic or an untracked address (migration 054). */
  url?: string | null
  /** The What to fix page fix it was logged from (migration 054). */
  pageFixId?: string | null
}

export interface FixFollowUpRecord {
  id: string
  pageId: string
  number: number
  /** Column `kind` (migration 043). */
  kind: FixKind
  description: string
  goLiveAt: string
  rule: FixFollowUpRule
  promptIds: readonly string[]
  marketIds: readonly string[]
  followUpRunId: string | null
  /**
   * Job started by "Run follow-up now" (migration 016). While it is set and the
   * run is not, the scheduler no longer plans this follow-up.
   */
  followUpJobId: string | null
  verdict: string | null
  status: FixFollowUpStatus
  /** Null for fixes stored before migration 016. */
  createdAt: string | null
  /** Migration 054. Null: the page's own address. */
  url: string | null
  /** Migration 054. Null for fixes not logged from What to fix. */
  pageFixId: string | null
  /** Migration 054. When Activity said the fix is working. */
  workedNotedAt: string | null
}

const DESCRIPTION_MAX = 4000
const URL_MAX = 2000
const VERDICT_MAX = 1000

export function createFixFollowUp(db: SqliteDatabase, input: NewFixFollowUp): FixFollowUpRecord {
  const row = normalizeNew(db, input)
  const write = db.transaction(() => {
    const number = row.number ?? nextFixNumber(db, row.pageId)
    db.prepare(
      `INSERT INTO fixes (
         id, page_id, number, description, live_on, recheck_rule, markets,
         followup_run_id, verdict, created_at, followup_job_id, kind, url, page_fix_id
       ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, NULL, ?, ?, ?)`
    ).run(
      row.id,
      row.pageId,
      number,
      row.description,
      row.goLiveAt,
      row.rule,
      JSON.stringify(row.marketIds),
      row.createdAt,
      row.kind,
      row.url,
      row.pageFixId
    )
    const insertPrompt = db.prepare(`INSERT INTO fix_prompts (fix_id, prompt_id) VALUES (?, ?)`)
    for (const promptId of row.promptIds) insertPrompt.run(row.id, promptId)
  })
  try {
    write()
  } catch (error) {
    throw saveError(error)
  }
  return requireFix(db, row.id)
}

/** Every follow-up in this project file, or one page. Ordered by page, then number. */
export function listFixFollowUps(db: SqliteDatabase, pageId?: string): FixFollowUpRecord[] {
  const filter = pageId === undefined ? null : assertId(pageId)
  const rows =
    filter === null
      ? db.prepare<unknown[], FixSql>(`${FIX_SELECT} ORDER BY page_id ASC, number ASC`).all()
      : db
          .prepare<unknown[], FixSql>(`${FIX_SELECT} WHERE page_id = ? ORDER BY number ASC`)
          .all(filter)
  return rows.map((row) => recordFromSql(db, row))
}

/**
 * SCH-10, FR-14.7. Stores the follow-up run id. That makes the fix completed.
 * `outcome` is the verdict. Omit it to leave the stored verdict. Null clears it.
 */
export function setFixFollowUpRun(
  db: SqliteDatabase,
  id: string,
  runId: string,
  outcome?: string | null
): FixFollowUpRecord {
  const fixId = assertId(id)
  const storedRunId = assertId(runId)
  const current = requireFix(db, fixId)
  const verdict = outcome === undefined ? current.verdict : requireVerdict(outcome)
  try {
    db.prepare(`UPDATE fixes SET followup_run_id = ?, verdict = ? WHERE id = ?`).run(
      storedRunId,
      verdict,
      fixId
    )
  } catch (error) {
    if (error instanceof StorageError) throw error
    if (isSqliteError(error)) throw new StorageError('Could not save follow-up')
    throw error
  }
  return requireFix(db, fixId)
}

/** One stored fix, or null when the id is unknown. */
export function getFixFollowUp(db: SqliteDatabase, id: string): FixFollowUpRecord | null {
  const row = db.prepare<unknown[], FixSql>(`${FIX_SELECT} WHERE id = ?`).get(assertId(id))
  return row === undefined ? null : recordFromSql(db, row)
}

/**
 * FR-14.6. Records the job "Run follow-up now" started. A completed fix keeps
 * its run; starting again only replaces the job id. Null frees a job that
 * ended without a run, so the scheduler plans the follow-up again.
 */
export function setFixFollowUpJob(
  db: SqliteDatabase,
  id: string,
  jobId: string | null
): FixFollowUpRecord {
  const fixId = assertId(id)
  const job = jobId === null ? null : assertId(jobId)
  requireFix(db, fixId)
  try {
    db.prepare(`UPDATE fixes SET followup_job_id = ? WHERE id = ?`).run(job, fixId)
  } catch (error) {
    if (isSqliteError(error)) throw new StorageError('Could not save follow-up')
    throw error
  }
  return requireFix(db, fixId)
}

/** FR-14.7. Stores the verdict text without touching the run. Null clears it. */
export function setFixVerdict(
  db: SqliteDatabase,
  id: string,
  verdict: string | null
): FixFollowUpRecord {
  const fixId = assertId(id)
  requireFix(db, fixId)
  const text = requireVerdict(verdict)
  try {
    db.prepare(`UPDATE fixes SET verdict = ? WHERE id = ?`).run(text, fixId)
  } catch (error) {
    if (isSqliteError(error)) throw new StorageError('Could not save follow-up')
    throw error
  }
  return requireFix(db, fixId)
}

/** Activity said the fix is working (migration 054): it says so once. */
export function setFixWorkedNoted(db: SqliteDatabase, id: string, at: string): void {
  const fixId = assertId(id)
  try {
    db.prepare(`UPDATE fixes SET worked_noted_at = ? WHERE id = ?`).run(
      requireUtcTimestamp(at),
      fixId
    )
  } catch (error) {
    if (error instanceof StorageError) throw error
    if (isSqliteError(error)) throw new StorageError('Could not save follow-up')
    throw error
  }
}

/** The change's kind on the Changes ledger (migration 043). */
export function setFixKind(db: SqliteDatabase, id: string, kind: FixKind): FixFollowUpRecord {
  const fixId = assertId(id)
  requireFix(db, fixId)
  if (!isFixKind(kind)) throw new StorageError('Invalid change kind')
  try {
    db.prepare(`UPDATE fixes SET kind = ? WHERE id = ?`).run(kind, fixId)
  } catch (error) {
    if (isSqliteError(error)) throw new StorageError('Could not save the change kind')
    throw error
  }
  return requireFix(db, fixId)
}

/** What `updateFixFollowUp` may change. Omitted fields stay. */
export interface FixFollowUpPatch {
  description?: string
  goLiveAt?: string
  rule?: FixFollowUpRule
  promptIds?: readonly string[]
  marketIds?: readonly string[]
  /** The change's kind on the Changes ledger. */
  kind?: FixKind
}

/**
 * Edits a logged fix in place: its number, follow-up job and run stay. New
 * prompts must be in the project file and new markets in the page's markets.
 */
export function updateFixFollowUp(
  db: SqliteDatabase,
  id: string,
  patch: FixFollowUpPatch
): FixFollowUpRecord {
  const fixId = assertId(id)
  const current = requireFix(db, fixId)
  const description =
    patch.description === undefined ? current.description : requireDescription(patch.description)
  const goLiveAt =
    patch.goLiveAt === undefined ? current.goLiveAt : requireUtcTimestamp(patch.goLiveAt)
  const rule = patch.rule === undefined ? current.rule : requireRule(patch.rule)
  const promptIds = patch.promptIds === undefined ? null : requireIdList(patch.promptIds, 'prompt')
  const marketIds =
    patch.marketIds === undefined ? current.marketIds : requireIdList(patch.marketIds, 'market')
  if (patch.kind !== undefined && !isFixKind(patch.kind))
    throw new StorageError('Invalid change kind')
  const kind = patch.kind ?? current.kind
  if (patch.marketIds !== undefined) {
    for (const marketId of marketIds) requirePageMarket(db, current.pageId, marketId)
  }
  if (promptIds !== null) {
    for (const promptId of promptIds) requireProjectPrompt(db, promptId)
  }
  const write = db.transaction(() => {
    db.prepare(
      `UPDATE fixes SET description = ?, live_on = ?, recheck_rule = ?, markets = ?, kind = ? WHERE id = ?`
    ).run(description, goLiveAt, rule, JSON.stringify(marketIds), kind, fixId)
    if (promptIds !== null) {
      db.prepare(`DELETE FROM fix_prompts WHERE fix_id = ?`).run(fixId)
      const insert = db.prepare(`INSERT INTO fix_prompts (fix_id, prompt_id) VALUES (?, ?)`)
      for (const promptId of promptIds) insert.run(fixId, promptId)
    }
  })
  try {
    write()
  } catch (error) {
    throw saveError(error)
  }
  return requireFix(db, fixId)
}

/** Deletes one fix and its targeted prompts. False when the id is unknown. */
export function deleteFixFollowUp(db: SqliteDatabase, id: string): boolean {
  const fixId = assertId(id)
  const write = db.transaction(() => {
    db.prepare(`DELETE FROM fix_prompts WHERE fix_id = ?`).run(fixId)
    return db.prepare(`DELETE FROM fixes WHERE id = ?`).run(fixId).changes === 1
  })
  try {
    return write()
  } catch (error) {
    if (isSqliteError(error)) throw new StorageError('Could not delete the fix')
    throw error
  }
}

/**
 * SCH-10. Drops the page's fixes and their targeted prompts.
 * The page row stays. Missing pages delete nothing. Returns how many fixes went.
 */
export function deleteFixFollowUpsForPage(db: SqliteDatabase, pageId: string): number {
  const id = assertId(pageId)
  const write = db.transaction(() => {
    const fixes = db
      .prepare<unknown[], { id: string }>(`SELECT id FROM fixes WHERE page_id = ?`)
      .all(id)
    const dropPrompts = db.prepare(`DELETE FROM fix_prompts WHERE fix_id = ?`)
    for (const fix of fixes) dropPrompts.run(fix.id)
    return db.prepare(`DELETE FROM fixes WHERE page_id = ?`).run(id).changes
  })
  try {
    return write()
  } catch (error) {
    if (error instanceof StorageError) throw error
    if (isSqliteError(error)) throw new StorageError('Could not delete fix follow-ups')
    throw error
  }
}

const FIX_SELECT = `SELECT id, page_id, number, description, live_on, recheck_rule, markets,
  followup_run_id, verdict, created_at, followup_job_id, kind, url, page_fix_id,
  worked_noted_at FROM fixes`

interface FixSql {
  id: string
  page_id: string
  number: number
  description: string
  live_on: string
  recheck_rule: string
  markets: string
  followup_run_id: string | null
  verdict: string | null
  created_at: string | null
  followup_job_id: string | null
  kind: string
  url: string | null
  page_fix_id: string | null
  worked_noted_at: string | null
}

interface NormalizedNew {
  id: string
  pageId: string
  description: string
  goLiveAt: string
  rule: FixFollowUpRule
  promptIds: readonly string[]
  marketIds: readonly string[]
  number: number | null
  createdAt: string | null
  kind: FixKind
  url: string | null
  pageFixId: string | null
}

function normalizeNew(db: SqliteDatabase, input: NewFixFollowUp): NormalizedNew {
  const pageId = assertId(input.pageId)
  requireOpenPage(db, pageId)
  const promptIds = requireIdList(input.promptIds, 'prompt')
  const marketIds = requireIdList(input.marketIds, 'market')
  for (const marketId of marketIds) requirePageMarket(db, pageId, marketId)
  for (const promptId of promptIds) requireProjectPrompt(db, promptId)
  return {
    id: assertId(input.id),
    pageId,
    description: requireDescription(input.description),
    goLiveAt: requireUtcTimestamp(input.goLiveAt),
    rule: requireRule(input.rule),
    promptIds,
    marketIds,
    number: input.number === undefined ? null : requireNumber(input.number),
    createdAt: input.createdAt === undefined ? null : requireUtcTimestamp(input.createdAt),
    kind: requireKind(input.kind ?? 'fix'),
    url: input.url === undefined || input.url === null ? null : requireUrl(input.url),
    pageFixId:
      input.pageFixId === undefined || input.pageFixId === null ? null : assertId(input.pageFixId)
  }
}

function requireUrl(value: string): string {
  const text = requireStoredText(value, 'fix page address', URL_MAX)
  if (!/^https?:\/\/\S+$/u.test(text)) throw new StorageError('Invalid fix page address')
  return text
}

function requireKind(value: string): FixKind {
  if (!isFixKind(value)) throw new StorageError('Invalid change kind')
  return value
}

function requireFix(db: SqliteDatabase, id: string): FixFollowUpRecord {
  const row = db.prepare<unknown[], FixSql>(`${FIX_SELECT} WHERE id = ?`).get(id)
  if (row === undefined) throw new StorageError('Unknown follow-up')
  return recordFromSql(db, row)
}

function recordFromSql(db: SqliteDatabase, row: FixSql): FixFollowUpRecord {
  return {
    id: row.id,
    pageId: row.page_id,
    number: requireNumber(row.number),
    kind: requireKind(row.kind),
    description: row.description,
    goLiveAt: requireUtcTimestamp(row.live_on),
    rule: requireRule(row.recheck_rule),
    promptIds: listPromptIds(db, row.id),
    marketIds: readMarketIds(row.markets),
    followUpRunId: row.followup_run_id === null ? null : assertId(row.followup_run_id),
    followUpJobId: row.followup_job_id === null ? null : assertId(row.followup_job_id),
    verdict: row.verdict,
    status: row.followup_run_id === null ? 'planned' : 'completed',
    createdAt: row.created_at === null ? null : requireUtcTimestamp(row.created_at),
    url: row.url,
    pageFixId: row.page_fix_id,
    workedNotedAt: row.worked_noted_at
  }
}

function listPromptIds(db: SqliteDatabase, fixId: string): string[] {
  return db
    .prepare<unknown[], { prompt_id: string }>(
      `SELECT prompt_id FROM fix_prompts WHERE fix_id = ? ORDER BY rowid ASC`
    )
    .all(fixId)
    .map((row) => assertId(row.prompt_id))
}

function readMarketIds(encoded: string): string[] {
  const parsed = readJson(encoded, 'follow-up markets')
  if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === 'string')) {
    throw new StorageError('Invalid follow-up markets')
  }
  return requireIdList(parsed, 'market')
}

function requireOpenPage(db: SqliteDatabase, pageId: string): void {
  const page = db
    .prepare<unknown[], { status: string }>(`SELECT status FROM pages WHERE id = ?`)
    .get(pageId)
  if (page === undefined) throw new StorageError('Unknown page')
  if (page.status === 'removed') throw new StorageError('A removed page cannot store a follow-up')
}

function requirePageMarket(db: SqliteDatabase, pageId: string, marketId: string): void {
  const link = db
    .prepare(`SELECT 1 AS ok FROM page_markets WHERE page_id = ? AND market_id = ?`)
    .get(pageId, marketId)
  if (link === undefined) throw new StorageError('Unknown page market')
}

/** A fix's searches may come from any page or topic of the project (migration 054). */
function requireProjectPrompt(db: SqliteDatabase, promptId: string): void {
  const prompt = db
    .prepare(
      `SELECT 1 AS ok FROM prompts
       JOIN prompt_sets ON prompt_sets.id = prompts.prompt_set_id
       WHERE prompts.id = ?`
    )
    .get(promptId)
  if (prompt === undefined) throw new StorageError('Unknown prompt')
}

/** The number the next fix logged on this page gets. Numbers are per page and start at 1. */
export function nextFixNumber(db: SqliteDatabase, pageId: string): number {
  const row = db
    .prepare<unknown[], { n: number | null }>(
      `SELECT MAX(number) AS n FROM fixes WHERE page_id = ?`
    )
    .get(pageId)
  return requireNumber((row?.n ?? 0) + 1)
}

function requireIdList(values: readonly string[], label: 'prompt' | 'market'): string[] {
  if (values.length === 0) {
    throw new StorageError(
      label === 'prompt'
        ? 'A follow-up needs at least one prompt'
        : 'A follow-up needs at least one market'
    )
  }
  const ids = values.map((value) => assertId(value))
  if (new Set(ids).size !== ids.length) {
    throw new StorageError(
      label === 'prompt' ? 'Duplicate follow-up prompt' : 'Duplicate follow-up market'
    )
  }
  return ids
}

function requireRule(value: string): FixFollowUpRule {
  if (!isFixFollowUpRule(value)) throw new StorageError('Invalid follow-up rule')
  return value
}

function isFixFollowUpRule(value: string): value is FixFollowUpRule {
  return FIX_FOLLOW_UP_RULES.some((rule) => rule === value)
}

function requireNumber(value: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 1_000_000) {
    throw new StorageError('Invalid fix number')
  }
  return value
}

function requireDescription(value: string): string {
  const text = requireStoredText(value, 'fix description', DESCRIPTION_MAX)
  if (text.trim() !== text) throw new StorageError('Invalid fix description')
  return text
}

function requireVerdict(value: string | null): string | null {
  if (value === null) return null
  const text = requireStoredText(value, 'fix verdict', VERDICT_MAX)
  if (text.trim() !== text) throw new StorageError('Invalid fix verdict')
  return text
}

function saveError(error: unknown): StorageError {
  if (error instanceof StorageError) return error
  if (isSqliteError(error)) {
    if (error.message.includes('fixes.id') || error.message.includes('PRIMARY KEY')) {
      return new StorageError('A follow-up with this id already exists')
    }
    if (error.message.includes('UNIQUE')) return new StorageError('Fix number already used')
    return new StorageError('Could not save follow-up')
  }
  if (error instanceof Error) throw error
  return new StorageError('Could not save follow-up')
}
