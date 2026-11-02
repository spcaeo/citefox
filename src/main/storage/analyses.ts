import { randomUUID } from 'node:crypto'
import type { SqliteDatabase } from './database'
import { StorageError } from './errors'
import { assertId, readJson, requireContentHash, requireJsonDocument } from './values'

/**
 * SRS section 10 `analyses` in the project database (FR-6.6, FR-12.3).
 * One row is one Claude output. Check reports store one row per run and kind.
 * `run_id` and `snapshot_id` are exclusive. A run row also stores `market_id`
 * (not a foreign key; profile writes replace `markets`) and `generation_id`.
 */
export const ANALYSIS_KINDS = ['gap_matrix', 'aio_gap', 'summary'] as const
export type AnalysisKind = (typeof ANALYSIS_KINDS)[number]

export interface NewAnalysis {
  runId: string | null
  snapshotId: string | null
  marketId: string | null
  generationId: string | null
  kind: AnalysisKind
  promptId: string | null
  body: unknown
  templateHash: string
  done: boolean
}

export interface StoredAnalysis {
  id: string
  runId: string | null
  snapshotId: string | null
  marketId: string | null
  generationId: string | null
  kind: AnalysisKind
  promptId: string | null
  body: unknown
  templateHash: string
  done: boolean
}

const SELECT_ANALYSIS = `SELECT id, run_id, snapshot_id, market_id, generation_id, kind, prompt_id,
  body_json, template_hash, done FROM analyses`

/**
 * Insert one analysis. A previous row for the same run and kind is replaced,
 * so rewriting `aio_gap.md` or `run_summary.md` keeps a single row.
 */
export function saveRunAnalysis(db: SqliteDatabase, record: NewAnalysis): StoredAnalysis {
  const row = normalize(record)
  if (row.runId === null) throw new StorageError('Could not save analysis')
  const id = `an-${randomUUID()}`
  const write = db.transaction(() => {
    db.prepare(`DELETE FROM analyses WHERE run_id = ? AND kind = ?`).run(row.runId, row.kind)
    db.prepare(
      `INSERT INTO analyses (
         id, run_id, snapshot_id, kind, prompt_id, body_json, template_hash, done,
         market_id, generation_id
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      row.runId,
      row.snapshotId,
      row.kind,
      row.promptId,
      row.bodyJson,
      row.templateHash,
      row.done ? 1 : 0,
      row.marketId,
      row.generationId
    )
  })
  write()
  const saved = getAnalysis(db, id)
  if (saved === null) throw new StorageError('Could not save analysis')
  return saved
}

/** Analyses for one check run, oldest first. */
export function listAnalysesByRun(db: SqliteDatabase, runId: string): StoredAnalysis[] {
  const id = assertId(runId)
  return db
    .prepare<unknown[], AnalysisSql>(`${SELECT_ANALYSIS} WHERE run_id = ? ORDER BY rowid ASC`)
    .all(id)
    .map(fromSql)
}

/** Analyses linked to one market, oldest first. */
export function listAnalysesByMarket(db: SqliteDatabase, marketId: string): StoredAnalysis[] {
  const id = assertId(marketId)
  return db
    .prepare<unknown[], AnalysisSql>(`${SELECT_ANALYSIS} WHERE market_id = ? ORDER BY rowid ASC`)
    .all(id)
    .map(fromSql)
}

function getAnalysis(db: SqliteDatabase, id: string): StoredAnalysis | null {
  const row = db.prepare<unknown[], AnalysisSql>(`${SELECT_ANALYSIS} WHERE id = ?`).get(id)
  return row === undefined ? null : fromSql(row)
}

interface NormalizedAnalysis {
  runId: string | null
  snapshotId: string | null
  marketId: string | null
  generationId: string | null
  kind: AnalysisKind
  promptId: string | null
  bodyJson: string
  templateHash: string
  done: boolean
}

function normalize(record: NewAnalysis): NormalizedAnalysis {
  const kind = requireAnalysisKind(record.kind)
  const runId = optionalId(record.runId)
  const snapshotId = optionalId(record.snapshotId)
  if ((runId === null) === (snapshotId === null)) {
    throw new StorageError('Could not save analysis')
  }
  const marketId = optionalId(record.marketId)
  if (runId !== null && marketId === null) throw new StorageError('Could not save analysis')
  return {
    runId,
    snapshotId,
    marketId,
    generationId: optionalId(record.generationId),
    kind,
    promptId: optionalId(record.promptId),
    bodyJson: requireJsonDocument(record.body, 'analysis'),
    templateHash: requireContentHash(record.templateHash),
    done: record.done === true
  }
}

function optionalId(value: string | null): string | null {
  if (value === null) return null
  return assertId(value)
}

function requireAnalysisKind(value: string): AnalysisKind {
  if (!(ANALYSIS_KINDS as readonly string[]).includes(value)) {
    throw new StorageError('Invalid analysis kind')
  }
  return value as AnalysisKind
}

interface AnalysisSql {
  id: string
  run_id: string | null
  snapshot_id: string | null
  market_id: string | null
  generation_id: string | null
  kind: string
  prompt_id: string | null
  body_json: string
  template_hash: string
  done: number
}

function fromSql(row: AnalysisSql): StoredAnalysis {
  return {
    id: row.id,
    runId: row.run_id,
    snapshotId: row.snapshot_id,
    marketId: row.market_id,
    generationId: row.generation_id,
    kind: requireAnalysisKind(row.kind),
    promptId: row.prompt_id,
    body: readJson(row.body_json, 'analysis'),
    templateHash: row.template_hash,
    done: row.done === 1
  }
}
