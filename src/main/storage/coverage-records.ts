import {
  isCoverageAction,
  isCoverageFindingKind,
  isCoverageLevel,
  isCoveragePriority
} from '@shared/domain'
import type {
  CoverageAction,
  CoverageFinding,
  CoverageMatrix,
  CoveragePriority,
  CoverageRecord,
  CoverageRunRef,
  SuggestedFaq
} from '@shared/domain'
import type { SqliteDatabase } from './database'
import { StorageError } from './errors'
import {
  assertId,
  readJson,
  requireContentHash,
  requireLabel,
  requireStoredText,
  requireUtcTimestamp
} from './values'

/** `coverage_runs`, `coverage_rows`, and `coverage_findings` rows in a project database. */

export function insertCoverage(db: SqliteDatabase, matrix: CoverageMatrix): void {
  const runId = assertId(matrix.runId)
  const pageId = assertId(matrix.pageId)
  const recordedAt = requireUtcTimestamp(matrix.recordedAt)
  const templateId = assertId(matrix.templateId)
  const templateName = requireLabel(matrix.templateName, 'template name', 80)
  const templateHash = requireContentHash(matrix.templateHash)
  const templateUpdatedAt =
    matrix.templateUpdatedAt === null ? null : requireUtcTimestamp(matrix.templateUpdatedAt)
  const contentHash = requireContentHash(matrix.contentHash)
  const rows = matrix.rows.map((row) => normalizeCoverageRow(row, runId, pageId))
  const findings = matrix.findings.map((finding) => normalizeFinding(finding, runId, pageId))
  const write = db.transaction(() => {
    db.prepare(
      `INSERT INTO coverage_runs (
         id, page_id, recorded_at, template_id, template_name, template_hash, template_updated_at,
         content_hash
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      runId,
      pageId,
      recordedAt,
      templateId,
      templateName,
      templateHash,
      templateUpdatedAt,
      contentHash
    )
    const insertRow = db.prepare(
      `INSERT INTO coverage_rows (
         id, run_id, page_id, prompt_id, coverage, where_covered_json, current_content,
         what_to_update, main_gap, priority, actions_json, suggested_faq_json, done
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    for (const row of rows) {
      insertRow.run(
        row.id,
        runId,
        pageId,
        row.promptId,
        row.coverage,
        JSON.stringify(row.whereCovered),
        row.currentContent,
        row.whatToUpdate,
        row.mainGap,
        row.priority,
        JSON.stringify(row.actions),
        row.suggestedFaq === null ? null : JSON.stringify(row.suggestedFaq),
        row.done ? 1 : 0
      )
    }
    const insertFinding = db.prepare(
      `INSERT INTO coverage_findings (id, run_id, page_id, kind, summary, detail)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    for (const finding of findings) {
      insertFinding.run(finding.id, runId, pageId, finding.kind, finding.summary, finding.detail)
    }
  })
  try {
    write()
  } catch (error) {
    if (error instanceof StorageError) throw error
    throw new StorageError('Could not save coverage')
  }
}

export function getLatestCoverage(
  db: SqliteDatabase,
  pageId: string,
  currentHash: string | null
): CoverageMatrix | null {
  assertId(pageId)
  const row = db
    .prepare<unknown[], CoverageSql>(
      `SELECT id, page_id, recorded_at, template_id, template_name, template_hash,
              template_updated_at, content_hash
       FROM coverage_runs WHERE page_id = ? ORDER BY recorded_at DESC, rowid DESC LIMIT 1`
    )
    .get(pageId)
  return row === undefined ? null : coverageFromSql(db, row, currentHash)
}

/** Every stored run for the page, oldest first. Rows are not loaded. */
export function listCoverageRuns(db: SqliteDatabase, pageId: string): CoverageRunRef[] {
  assertId(pageId)
  return db
    .prepare<unknown[], CoverageSql>(
      `SELECT id, page_id, recorded_at, template_id, template_name, template_hash,
              template_updated_at, content_hash
       FROM coverage_runs WHERE page_id = ? ORDER BY recorded_at ASC, rowid ASC`
    )
    .all(pageId)
    .map((row) => ({
      runId: row.id,
      pageId: row.page_id,
      recordedAt: row.recorded_at,
      contentHash: row.content_hash
    }))
}

export function getCoverageRun(
  db: SqliteDatabase,
  pageId: string,
  runId: string,
  currentHash: string | null
): CoverageMatrix | null {
  assertId(pageId)
  const id = assertId(runId)
  const row = db
    .prepare<unknown[], CoverageSql>(
      `SELECT id, page_id, recorded_at, template_id, template_name, template_hash,
              template_updated_at, content_hash
       FROM coverage_runs WHERE id = ? AND page_id = ?`
    )
    .get(id, pageId)
  return row === undefined ? null : coverageFromSql(db, row, currentHash)
}

/** Replaces one stored row in place. The run id and prompt id stay. */
export function updateCoverageRow(db: SqliteDatabase, row: CoverageRecord): void {
  const normalized = normalizeCoverageRow(row, row.runId, row.pageId)
  const result = db
    .prepare(
      `UPDATE coverage_rows SET
         coverage = ?, where_covered_json = ?, current_content = ?, what_to_update = ?,
         main_gap = ?, priority = ?, actions_json = ?, suggested_faq_json = ?, done = ?
       WHERE id = ? AND run_id = ? AND page_id = ? AND prompt_id = ?`
    )
    .run(
      normalized.coverage,
      JSON.stringify(normalized.whereCovered),
      normalized.currentContent,
      normalized.whatToUpdate,
      normalized.mainGap,
      normalized.priority,
      JSON.stringify(normalized.actions),
      normalized.suggestedFaq === null ? null : JSON.stringify(normalized.suggestedFaq),
      normalized.done ? 1 : 0,
      normalized.id,
      normalized.runId,
      normalized.pageId,
      normalized.promptId
    )
  if (result.changes !== 1) throw new StorageError('Could not save coverage')
}

interface CoverageSql {
  id: string
  page_id: string
  recorded_at: string
  template_id: string
  template_name: string
  template_hash: string
  template_updated_at: string | null
  content_hash: string
}

function normalizeCoverageRow(row: CoverageRecord, runId: string, pageId: string): CoverageRecord {
  if (row.runId !== runId || row.pageId !== pageId) throw new StorageError('Invalid coverage row')
  if (!isCoverageLevel(row.coverage)) throw new StorageError('Invalid coverage')
  if (!isCoveragePriority(row.priority)) throw new StorageError('Invalid coverage priority')
  if (row.actions.length === 0 || !row.actions.every((action) => isCoverageAction(action))) {
    throw new StorageError('Invalid coverage action')
  }
  return {
    ...row,
    id: assertId(row.id),
    promptId: assertId(row.promptId),
    whereCovered: row.whereCovered.map((place) => requireLabel(place, 'where covered', 300)),
    currentContent: requireStoredText(row.currentContent, 'current content', 5000),
    // A strong row has nothing to update (Docs/PROMPT-AUDIT.md, P1).
    whatToUpdate:
      row.coverage === 'strong' && row.whatToUpdate === ''
        ? ''
        : requireStoredText(row.whatToUpdate, 'what to update', 5000),
    mainGap: requireStoredText(row.mainGap, 'main gap', 5000),
    actions: row.actions,
    suggestedFaq: row.suggestedFaq === null ? null : normalizeFaq(row.suggestedFaq),
    done: row.done
  }
}

function normalizeFaq(faq: SuggestedFaq): SuggestedFaq {
  if (!Number.isInteger(faq.wordCount) || faq.wordCount < 0) {
    throw new StorageError('Invalid faq word count')
  }
  return {
    question: requireStoredText(faq.question, 'faq question', 500),
    answer: requireStoredText(faq.answer, 'faq answer', 5000),
    wordCount: faq.wordCount
  }
}

function normalizeFinding(
  finding: CoverageFinding,
  runId: string,
  pageId: string
): CoverageFinding {
  if (finding.runId !== runId || finding.pageId !== pageId)
    throw new StorageError('Invalid finding')
  if (!isCoverageFindingKind(finding.kind)) throw new StorageError('Invalid finding')
  return {
    ...finding,
    id: assertId(finding.id),
    summary: requireLabel(finding.summary, 'finding summary', 200),
    detail: requireStoredText(finding.detail, 'finding detail', 2000)
  }
}

function coverageFromSql(
  db: SqliteDatabase,
  row: CoverageSql,
  currentHash: string | null
): CoverageMatrix {
  const rows = db
    .prepare<unknown[], RowSql>(
      `SELECT id, run_id, page_id, prompt_id, coverage, where_covered_json, current_content,
              what_to_update, main_gap, priority, actions_json, suggested_faq_json, done
       FROM coverage_rows WHERE run_id = ? ORDER BY rowid ASC`
    )
    .all(row.id)
  const findings = db
    .prepare<unknown[], FindingSql>(
      `SELECT id, run_id, page_id, kind, summary, detail FROM coverage_findings WHERE run_id = ?`
    )
    .all(row.id)
  return {
    runId: row.id,
    pageId: row.page_id,
    recordedAt: row.recorded_at,
    templateId: row.template_id,
    templateName: row.template_name,
    templateHash: row.template_hash,
    templateUpdatedAt: row.template_updated_at,
    contentHash: row.content_hash,
    reused: false,
    stale: currentHash !== null && currentHash !== row.content_hash,
    rows: rows.map((item) => coverageRowFromSql(item)),
    findings: findings.map((item) => {
      if (!isCoverageFindingKind(item.kind)) throw new StorageError('Invalid finding')
      return {
        id: item.id,
        runId: item.run_id,
        pageId: item.page_id,
        kind: item.kind,
        summary: item.summary,
        detail: item.detail
      }
    })
  }
}

interface RowSql {
  id: string
  run_id: string
  page_id: string
  prompt_id: string
  coverage: string
  where_covered_json: string
  current_content: string
  what_to_update: string
  main_gap: string
  priority: string
  actions_json: string
  suggested_faq_json: string | null
  done: number
}

interface FindingSql {
  id: string
  run_id: string
  page_id: string
  kind: string
  summary: string
  detail: string
}

function coverageRowFromSql(row: RowSql): CoverageRecord {
  if (!isCoverageLevel(row.coverage) || !isCoveragePriority(row.priority)) {
    throw new StorageError('Invalid coverage')
  }
  const whereCovered = readJson(row.where_covered_json, 'where covered')
  const actions = readJson(row.actions_json, 'coverage action')
  if (!Array.isArray(whereCovered) || !Array.isArray(actions) || actions.length === 0) {
    throw new StorageError('Invalid coverage row')
  }
  const typedActions = actions.filter(
    (action): action is CoverageAction => typeof action === 'string' && isCoverageAction(action)
  )
  if (typedActions.length !== actions.length) throw new StorageError('Invalid coverage action')
  const first = typedActions[0]
  if (first === undefined) throw new StorageError('Invalid coverage action')
  return {
    id: row.id,
    runId: row.run_id,
    pageId: row.page_id,
    promptId: row.prompt_id,
    coverage: row.coverage,
    whereCovered: whereCovered.filter((place): place is string => typeof place === 'string'),
    currentContent: row.current_content,
    whatToUpdate: row.what_to_update,
    mainGap: row.main_gap,
    priority: row.priority as CoveragePriority,
    actions: [first, ...typedActions.slice(1)],
    suggestedFaq:
      row.suggested_faq_json === null
        ? null
        : (readJson(row.suggested_faq_json, 'faq') as SuggestedFaq),
    done: row.done === 1
  }
}
