import { containsSecret } from '../logging/redact'
import { lstatSync, mkdirSync, readdirSync, readFileSync, unlinkSync } from 'node:fs'
import { basename, isAbsolute, relative, resolve } from 'node:path'
import { atomicWriteBytes } from './atomic-file'
import type { SqliteDatabase } from './database'
import { isSqliteError } from './database'
import { StorageError } from './errors'
import { assertId, requireLabel, requireLocalDate, requireUtcTimestamp } from './values'

/**
 * FR-23.13. Index of monthly client PDFs in app.sqlite.
 * The bytes are a file under `outboxDir` (`<userData>/outbox/`), never a blob.
 * `dueDate` is a local `YYYY-MM-DD`. One row per project and due date.
 * `filename` is the name shown to the user. The file on disk is `<id>.pdf`.
 * `createdAt` is ISO-8601 UTC (NFR-15) and defaults to now when omitted.
 * `path` is resolved under `outboxDir` when listing. This module does not
 * import electron, so the caller passes the directory.
 */
export interface NewPendingClientPdf {
  id: string
  projectId: string
  projectName: string
  dueDate: string
  filename: string
  bytes: Uint8Array
  /** UTC ISO-8601. Omitted means now. */
  createdAt?: string
}

export interface PendingClientPdf {
  id: string
  projectId: string
  projectName: string
  dueDate: string
  filename: string
  /** Byte length. Column `bytes`. The file at `path` holds the PDF. */
  bytes: number
  createdAt: string
  path: string
}

const SELECT = `SELECT id, project_id, project_name, due_date, filename, bytes, created_at
  FROM pending_client_pdfs`

export function addPendingClientPdf(
  db: SqliteDatabase,
  outboxDir: string,
  item: NewPendingClientPdf
): void {
  const row = normalize(item)
  const root = requireOutbox(outboxDir)
  const filePath = diskPath(root, row.id)
  try {
    mkdirSync(root, { recursive: true, mode: 0o700 })
  } catch {
    throw new StorageError('Could not save pending PDF')
  }
  const save = db.transaction(() => {
    try {
      db.prepare(
        `INSERT INTO pending_client_pdfs (
           id, project_id, project_name, due_date, filename, bytes, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(
        row.id,
        row.projectId,
        row.projectName,
        row.dueDate,
        row.filename,
        row.bytes.byteLength,
        row.createdAt
      )
    } catch (error) {
      throw rejectSave(error)
    }
    try {
      atomicWriteBytes(filePath, row.bytes)
    } catch {
      removePartial(root, filePath)
      throw new StorageError('Could not save pending PDF')
    }
  })
  save()
}

/**
 * Unlinks `<id>.pdf` for each id. A missing file is ignored.
 * An empty `ids` list only checks `outboxDir`.
 */
export function removePendingClientPdfFiles(outboxDir: string, ids: readonly string[]): void {
  const root = requireOutbox(outboxDir)
  for (const id of ids) removeFile(diskPath(root, id))
}

export function listPendingClientPdfs(db: SqliteDatabase, outboxDir: string): PendingClientPdf[] {
  const root = requireOutbox(outboxDir)
  return db
    .prepare<unknown[], PdfSql>(`${SELECT} ORDER BY created_at ASC, id ASC`)
    .all()
    .map((row) => pdfFromSql(root, row))
}

export function readPendingClientPdf(
  db: SqliteDatabase,
  outboxDir: string,
  id: string
): Uint8Array {
  const row = requireRow(db, outboxDir, id)
  let bytes: Buffer
  try {
    if (lstatSync(row.path).isSymbolicLink()) throw new StorageError('Could not read pending PDF')
    bytes = readFileSync(row.path)
  } catch (error) {
    if (error instanceof StorageError) throw error
    throw new StorageError('Could not read pending PDF')
  }
  if (bytes.byteLength !== row.bytes) throw new StorageError('Could not read pending PDF')
  return new Uint8Array(bytes)
}

/** Deletes the row and the file. Used once the user opens the PDF. */
export function removePendingClientPdf(db: SqliteDatabase, outboxDir: string, id: string): void {
  const row = requireRow(db, outboxDir, id)
  removeFile(row.path)
  const result = db.prepare(`DELETE FROM pending_client_pdfs WHERE id = ?`).run(row.id)
  if (result.changes !== 1) throw new StorageError('Could not remove pending PDF')
}

interface PdfSql {
  id: string
  project_id: string
  project_name: string
  due_date: string
  filename: string
  bytes: number
  created_at: string
}

interface NormalizedPdf {
  id: string
  projectId: string
  projectName: string
  dueDate: string
  filename: string
  bytes: Uint8Array
  createdAt: string
}

function normalize(item: NewPendingClientPdf): NormalizedPdf {
  if (!(item.bytes instanceof Uint8Array)) throw new StorageError('Invalid PDF')
  return {
    id: requireId(item.id),
    projectId: requireId(item.projectId),
    projectName: requireLabel(item.projectName, 'project name', 200),
    dueDate: requireLocalDate(item.dueDate),
    filename: requireFilename(item.filename),
    bytes: new Uint8Array(item.bytes),
    createdAt: requireUtcTimestamp(item.createdAt ?? new Date().toISOString())
  }
}

function requireRow(db: SqliteDatabase, outboxDir: string, id: string): PendingClientPdf {
  const pdfId = requireId(id)
  const root = requireOutbox(outboxDir)
  const row = db.prepare<unknown[], PdfSql>(`${SELECT} WHERE id = ?`).get(pdfId)
  if (row === undefined) throw new StorageError('Pending PDF is missing')
  return pdfFromSql(root, row)
}

function pdfFromSql(root: string, row: PdfSql): PendingClientPdf {
  return {
    id: row.id,
    projectId: row.project_id,
    projectName: row.project_name,
    dueDate: row.due_date,
    filename: row.filename,
    bytes: row.bytes,
    createdAt: row.created_at,
    path: diskPath(root, row.id)
  }
}

function requireOutbox(outboxDir: string): string {
  if (typeof outboxDir !== 'string' || outboxDir.trim().length === 0 || outboxDir.includes('\0')) {
    throw new StorageError('Invalid outbox directory')
  }
  return resolve(outboxDir)
}

function diskPath(root: string, id: string): string {
  const name = `${requireId(id)}.pdf`
  const filePath = resolve(root, name)
  const fromRoot = relative(root, filePath)
  if (fromRoot !== name || fromRoot.startsWith('..') || isAbsolute(fromRoot)) {
    throw new StorageError('Invalid id')
  }
  return filePath
}

function rejectSave(error: unknown): StorageError {
  if (error instanceof StorageError) return error
  if (isSqliteError(error)) {
    if (error.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') {
      return new StorageError('Could not save pending PDF: referenced row is missing')
    }
    if (
      error.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
      error.code === 'SQLITE_CONSTRAINT_PRIMARYKEY'
    ) {
      return new StorageError('Could not save pending PDF: rejected by the database', {
        cause: error
      })
    }
    if (error.code.startsWith('SQLITE_CONSTRAINT')) {
      return new StorageError('Could not save pending PDF: rejected by the database')
    }
  }
  return new StorageError('Could not save pending PDF')
}

function removePartial(root: string, filePath: string): void {
  const prefix = `${basename(filePath)}.`
  try {
    for (const name of readdirSync(root)) {
      if (!name.startsWith(prefix) || !name.endsWith('.tmp')) continue
      try {
        unlinkSync(resolve(root, name))
      } catch {
        // Already gone, or not a file this process can remove.
      }
    }
  } catch {
    // The outbox listing failed. The write error is the one to report.
  }
  try {
    unlinkSync(filePath)
  } catch {
    // Missing, or a directory occupying the name. Do not hide the write error.
  }
}

function requireFilename(filename: string): string {
  if (
    typeof filename !== 'string' ||
    filename.length === 0 ||
    filename.length > 200 ||
    filename.trim() !== filename
  ) {
    throw new StorageError('Invalid filename')
  }
  if (filename !== basename(filename) || filename === '.' || filename === '..') {
    throw new StorageError('Invalid filename')
  }
  if (filename.includes('/') || filename.includes('\\') || filename.includes('\0')) {
    throw new StorageError('Invalid filename')
  }
  if (containsSecret(filename)) throw new StorageError('filename cannot contain a secret')
  return filename
}

function requireId(value: string): string {
  const id = assertId(value)
  if (containsSecret(id)) throw new StorageError('id cannot contain a secret')
  return id
}

function removeFile(filePath: string): void {
  try {
    unlinkSync(filePath)
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? error.code : undefined
    if (code !== 'ENOENT') throw new StorageError('Could not remove pending PDF')
  }
}
