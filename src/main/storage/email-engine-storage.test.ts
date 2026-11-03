import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import type { EmailMode } from '@shared/domain'
import { openAppDatabase } from './app-database'
import { closeDatabase, isUniqueConstraintError, type SqliteDatabase } from './database'
import { StorageError } from './errors'
import { getEmailMode, setEmailMode } from './email-mode'
import { hasEmailThrottle, markEmailThrottle } from './email-throttle'
import {
  addPendingClientPdf,
  listPendingClientPdfs,
  readPendingClientPdf,
  removePendingClientPdf,
  type NewPendingClientPdf
} from './pending-client-pdfs'
import { deleteProject, insertProject, type ProjectRecord } from './records'
import { projectDatabaseRelativePath } from './slug'

const databases: SqliteDatabase[] = []
const directories: string[] = []

afterEach(() => {
  for (const db of databases.splice(0)) closeDatabase(db)
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('email mode', () => {
  test('defaults to smtp and round-trips the mail app', () => {
    const db = appDb()
    expect(getEmailMode(db)).toBe('smtp')
    setEmailMode(db, 'mail_app')
    expect(getEmailMode(db)).toBe('mail_app')
    setEmailMode(db, 'smtp')
    expect(getEmailMode(db)).toBe('smtp')
    expect(() => setEmailMode(db, 'imap' as EmailMode)).toThrow(/email mode/)
    expect(getEmailMode(db)).toBe('smtp')
  })
})

describe('email throttle', () => {
  test('mark keeps the first time and a second mark does not fail', () => {
    const db = appDb()
    const key = 'slack:project-1:check-1'
    expect(hasEmailThrottle(db, key)).toBe(false)
    markEmailThrottle(db, key, '2026-10-01T00:00:00.000Z')
    expect(hasEmailThrottle(db, key)).toBe(true)
    markEmailThrottle(db, key, '2026-10-02T00:00:00.000Z')
    const row = db
      .prepare<unknown[], { marked_at: string; n: number }>(
        `SELECT marked_at, (SELECT COUNT(*) FROM email_throttle) AS n FROM email_throttle WHERE key = ?`
      )
      .get(key)
    expect(row).toEqual({ marked_at: '2026-10-01T00:00:00.000Z', n: 1 })
    expect(() => markEmailThrottle(db, key, 'not-a-time')).toThrow(/timestamp/)
    expect(() => hasEmailThrottle(db, '')).toThrow(/throttle key/)
    expect(() =>
      markEmailThrottle(
        db,
        'https://hooks.slack.com/services/T00/B00/secret',
        '2026-10-01T00:00:00.000Z'
      )
    ).toThrow(/secret/)
  })
})

describe('pending client pdfs', () => {
  test('adds, lists, reads, and removes the file', () => {
    const db = appDb()
    insertProject(db, project())
    const dir = tempDir()
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])
    addPendingClientPdf(db, dir, pdf({ bytes }))
    const listed = listPendingClientPdfs(db, dir)
    expect(listed).toEqual([
      {
        id: 'pdf-1',
        projectId: 'project-1',
        projectName: 'TextBolt',
        dueDate: '2026-04-01',
        filename: 'textbolt-2026-04-01.pdf',
        bytes: bytes.byteLength,
        createdAt: '2026-04-01T00:00:00.000Z',
        path: resolve(dir, 'pdf-1.pdf')
      }
    ])
    expect(readPendingClientPdf(db, dir, 'pdf-1')).toEqual(bytes)
    if (process.platform !== 'win32') expect(statSync(listed[0]!.path).mode & 0o777).toBe(0o600)
    const dumped = JSON.stringify(
      db.prepare(`SELECT id, filename, bytes FROM pending_client_pdfs`).all()
    )
    expect(dumped).not.toContain('PDF-')
    removePendingClientPdf(db, dir, 'pdf-1')
    expect(listPendingClientPdfs(db, dir)).toEqual([])
    expect(readdirSync(dir)).toEqual([])
    expect(() => readPendingClientPdf(db, dir, 'pdf-1')).toThrow(/missing/)
  })

  test('writes no file when the insert is rejected', () => {
    const db = appDb()
    const dir = tempDir()
    expect(() => addPendingClientPdf(db, dir, pdf())).toThrow(/referenced row is missing/)
    expect(readdirSync(dir)).toEqual([])
    expect(() => addPendingClientPdf(db, dir, pdf({ dueDate: '2026-02-31' }))).toThrow(/local date/)
    expect(readdirSync(dir)).toEqual([])
  })

  test('stores a passed createdAt and defaults an omitted one to now', () => {
    const db = appDb()
    insertProject(db, project())
    const dir = tempDir()
    addPendingClientPdf(db, dir, pdf())
    expect(listPendingClientPdfs(db, dir)[0]?.createdAt).toBe('2026-04-01T00:00:00.000Z')
    const before = new Date().toISOString()
    const omitted = pdf({ id: 'pdf-now', dueDate: '2026-05-01' })
    delete omitted.createdAt
    addPendingClientPdf(db, dir, omitted)
    const after = new Date().toISOString()
    const createdAt = listPendingClientPdfs(db, dir).find((row) => row.id === 'pdf-now')?.createdAt
    expect(createdAt !== undefined && createdAt >= before && createdAt <= after).toBe(true)
  })

  test('rejects a duplicate id and leaves the original file', () => {
    const db = appDb()
    insertProject(db, project())
    const dir = tempDir()
    const bytes = new Uint8Array([9, 8, 7])
    addPendingClientPdf(db, dir, pdf({ bytes }))
    const original = readFileSync(resolve(dir, 'pdf-1.pdf'))
    let caught: unknown
    try {
      addPendingClientPdf(db, dir, pdf({ bytes: new Uint8Array([1]), filename: 'other.pdf' }))
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(StorageError)
    expect(isUniqueConstraintError(caught)).toBe(true)
    expect(readdirSync(dir)).toEqual(['pdf-1.pdf'])
    expect(readFileSync(resolve(dir, 'pdf-1.pdf'))).toEqual(original)
  })

  test('rejects the same project and due date without touching the original file', () => {
    const db = appDb()
    insertProject(db, project())
    const dir = tempDir()
    const bytes = new Uint8Array([4, 5, 6])
    addPendingClientPdf(db, dir, pdf({ bytes, filename: 'report-2026-10.pdf' }))
    const original = readFileSync(resolve(dir, 'pdf-1.pdf'))
    let caught: unknown
    try {
      addPendingClientPdf(
        db,
        dir,
        pdf({
          id: 'pdf-2',
          filename: 'report-2026-10.pdf',
          bytes: new Uint8Array([1, 1, 1])
        })
      )
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(StorageError)
    expect(isUniqueConstraintError(caught)).toBe(true)
    expect(readdirSync(dir)).toEqual(['pdf-1.pdf'])
    expect(readFileSync(resolve(dir, 'pdf-1.pdf'))).toEqual(original)
    const rows = db
      .prepare<unknown[], { n: number }>(`SELECT COUNT(*) AS n FROM pending_client_pdfs`)
      .get()
    expect(rows?.n).toBe(1)
  })

  test('allows the same due date and display filename in another project', () => {
    const db = appDb()
    insertProject(db, project())
    insertProject(
      db,
      project({
        id: 'project-2',
        name: 'Other',
        slug: 'other',
        domain: 'other.example',
        dbPath: projectDatabaseRelativePath('other')
      })
    )
    const dir = tempDir()
    addPendingClientPdf(db, dir, pdf({ filename: 'report-2026-10.pdf' }))
    addPendingClientPdf(
      db,
      dir,
      pdf({
        id: 'pdf-2',
        projectId: 'project-2',
        projectName: 'Other',
        filename: 'report-2026-10.pdf'
      })
    )
    expect(readdirSync(dir).sort()).toEqual(['pdf-1.pdf', 'pdf-2.pdf'])
    const listed = listPendingClientPdfs(db, dir)
    expect(listed.map((row) => row.filename)).toEqual(['report-2026-10.pdf', 'report-2026-10.pdf'])
    expect(listed.map((row) => row.path).sort()).toEqual([
      resolve(dir, 'pdf-1.pdf'),
      resolve(dir, 'pdf-2.pdf')
    ])
  })

  test('rolls back the row when the file write fails', () => {
    const db = appDb()
    insertProject(db, project())
    const dir = tempDir()
    mkdirSync(join(dir, 'pdf-1.pdf'))
    expect(() => addPendingClientPdf(db, dir, pdf())).toThrow(/pending PDF/)
    const rows = db
      .prepare<unknown[], { n: number }>(`SELECT COUNT(*) AS n FROM pending_client_pdfs`)
      .get()
    expect(rows?.n).toBe(0)
    expect(readdirSync(dir).some((name) => name.endsWith('.tmp'))).toBe(false)
  })

  test('removes that project pdf file when the project is deleted', () => {
    const db = appDb()
    insertProject(db, project())
    insertProject(
      db,
      project({
        id: 'project-2',
        name: 'Other',
        slug: 'other',
        domain: 'other.example',
        dbPath: projectDatabaseRelativePath('other')
      })
    )
    const dir = tempDir()
    addPendingClientPdf(db, dir, pdf())
    addPendingClientPdf(
      db,
      dir,
      pdf({ id: 'pdf-2', projectId: 'project-2', projectName: 'Other', dueDate: '2026-05-01' })
    )
    deleteProject(db, 'project-1', dir)
    expect(readdirSync(dir)).toEqual(['pdf-2.pdf'])
    expect(listPendingClientPdfs(db, dir).map((row) => row.id)).toEqual(['pdf-2'])
    expect(
      db.prepare<unknown[], { id: string }>(`SELECT id FROM projects WHERE id = 'project-1'`).get()
    ).toBeUndefined()
  })

  test('rejects a filename that leaves the outbox', () => {
    const db = appDb()
    insertProject(db, project())
    const dir = tempDir()
    for (const filename of [
      '../escape.pdf',
      'nested/file.pdf',
      '..',
      '/tmp/x.pdf',
      'foo\\bar.pdf'
    ]) {
      expect(() => addPendingClientPdf(db, dir, pdf({ filename }))).toThrow(/filename/)
    }
    expect(readdirSync(dir)).toEqual([])
    const rows = db
      .prepare<unknown[], { n: number }>(`SELECT COUNT(*) AS n FROM pending_client_pdfs`)
      .get()
    expect(rows?.n).toBe(0)
  })
})

function appDb(): SqliteDatabase {
  const db = openAppDatabase(':memory:')
  databases.push(db)
  return db
}

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'citefox-outbox-'))
  directories.push(dir)
  return dir
}

function project(overrides: Partial<ProjectRecord> = {}): ProjectRecord {
  return {
    id: 'project-1',
    name: 'TextBolt',
    slug: 'textbolt',
    domain: 'textbolt.example',
    dbPath: projectDatabaseRelativePath('textbolt'),
    clientName: null,
    status: 'active',
    ...overrides
  }
}

function pdf(overrides: Partial<NewPendingClientPdf> = {}): NewPendingClientPdf {
  return {
    id: 'pdf-1',
    projectId: 'project-1',
    projectName: 'TextBolt',
    dueDate: '2026-04-01',
    filename: 'textbolt-2026-04-01.pdf',
    bytes: new Uint8Array([1, 2, 3, 4]),
    createdAt: '2026-04-01T00:00:00.000Z',
    ...overrides
  }
}
