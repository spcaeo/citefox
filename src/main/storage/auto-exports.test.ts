import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { freshExportPath, usableExportFolder } from '../export/auto/folder'
import {
  AUTO_EXPORT_RUNS_KEPT,
  listAutoExportRows,
  listAutoExportRuns,
  readAutoExportRow,
  recordAutoExportRun,
  writeAutoExportRow
} from './auto-exports'
import { closeDatabase, openSqliteDatabase, type SqliteDatabase } from './database'
import { ensureProjectSchema } from './project-profile'

const databases: SqliteDatabase[] = []
const dirs: string[] = []

afterEach(() => {
  for (const db of databases.splice(0)) closeDatabase(db)
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function projectDb(): SqliteDatabase {
  const db = openSqliteDatabase(':memory:')
  ensureProjectSchema(db)
  databases.push(db)
  return db
}

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'citefox-auto-export-'))
  dirs.push(dir)
  return dir
}

describe('automatic exports (project migration 025)', () => {
  test('round-trips a scope row and keeps scopes apart', () => {
    const db = projectDb()
    expect(readAutoExportRow(db, '')).toBeNull()
    writeAutoExportRow(db, {
      scopeKey: 'page-1',
      enabled: true,
      destination: 'folder',
      folder: '/Users/me/Exports',
      specJson: '{"format":"pdf"}',
      updatedAt: '2026-10-20T12:00:00.000Z'
    })
    writeAutoExportRow(db, {
      scopeKey: '',
      enabled: false,
      destination: 'folder',
      folder: null,
      specJson: null,
      updatedAt: '2026-10-20T12:00:00.000Z'
    })
    expect(readAutoExportRow(db, 'page-1')).toEqual({
      scopeKey: 'page-1',
      enabled: true,
      destination: 'folder',
      folder: '/Users/me/Exports',
      specJson: '{"format":"pdf"}',
      updatedAt: '2026-10-20T12:00:00.000Z'
    })
    expect(listAutoExportRows(db).map((row) => row.scopeKey)).toEqual(['', 'page-1'])
    expect(() =>
      writeAutoExportRow(db, {
        scopeKey: '../x',
        enabled: false,
        destination: 'folder',
        folder: null,
        specJson: null,
        updatedAt: '2026-10-20T12:00:00.000Z'
      })
    ).toThrow('Invalid auto-export scope')
  })

  test('keeps the newest history rows per scope and redacts what it stores', () => {
    const db = projectDb()
    for (let index = 0; index < AUTO_EXPORT_RUNS_KEPT + 5; index += 1) {
      const at = new Date(Date.UTC(2026, 9, 1, 0, index)).toISOString()
      recordAutoExportRun(db, {
        id: `run-${index}`,
        scopeKey: 'page-1',
        startedAt: at,
        finishedAt: at,
        outcome: index % 2 === 0 ? 'ok' : 'failed',
        format: 'pdf',
        filename: index % 2 === 0 ? `file-${index}.pdf` : null,
        bytes: index % 2 === 0 ? 100 : null,
        reason: index % 2 === 0 ? null : 'Failed with key sk-ant-api03-abcdefghijklmnop',
        nextStep: null
      })
    }
    recordAutoExportRun(db, {
      id: 'other-scope',
      scopeKey: '',
      startedAt: '2026-10-01T00:00:00.000Z',
      finishedAt: '2026-10-01T00:00:00.000Z',
      outcome: 'ok',
      format: 'csv',
      filename: 'x.zip',
      bytes: 1,
      reason: null,
      nextStep: null
    })
    const all = listAutoExportRuns(db, 'page-1', AUTO_EXPORT_RUNS_KEPT)
    expect(all).toHaveLength(AUTO_EXPORT_RUNS_KEPT)
    expect(all[0]?.id).toBe(`run-${AUTO_EXPORT_RUNS_KEPT + 4}`)
    expect(all.some((row) => row.id === 'run-0')).toBe(false)
    expect(listAutoExportRuns(db, 'page-1')).toHaveLength(20)
    expect(listAutoExportRuns(db, '')).toHaveLength(1)
    const failed = all.find((row) => row.outcome === 'failed')
    expect(failed?.reason).not.toContain('sk-ant-api03')
  })
})

describe('automatic export folders', () => {
  test('only absolute, normalized, existing, writable folders are usable', () => {
    const dir = tempDir()
    expect(usableExportFolder(dir)).toBe(true)
    expect(usableExportFolder(`${dir}/`)).toBe(true)
    expect(usableExportFolder(join(dir, 'missing'))).toBe(false)
    expect(usableExportFolder(`${dir}/../${dir.split('/').at(-1) ?? ''}`)).toBe(false)
    expect(usableExportFolder(`${dir}/./`)).toBe(false)
    expect(usableExportFolder('relative/path')).toBe(false)
    expect(usableExportFolder(`${dir}\0`)).toBe(false)
    expect(usableExportFolder(42)).toBe(false)
    const file = join(dir, 'file.txt')
    writeFileSync(file, 'x')
    expect(usableExportFolder(file)).toBe(false)
  })

  test('a fresh path never names an existing file and refuses traversal', () => {
    // Paths come back resolved: '/out/…' on Linux and macOS, '<drive>:\\out\\…' on Windows.
    const out = (name: string): string => resolve('/out', name)
    const taken = new Set([out('report.pdf'), out('report (2).pdf')])
    const exists = (path: string): boolean => taken.has(path)
    expect(freshExportPath('/out', 'other.pdf', exists)).toBe(out('other.pdf'))
    expect(freshExportPath('/out', 'report.pdf', exists)).toBe(out('report (3).pdf'))
    expect(freshExportPath('/out', 'README', () => false)).toBe(out('README'))
    expect(freshExportPath('/out', 'report.pdf', () => true)).toBeNull()
    expect(() => freshExportPath('/out', '../escape.pdf', exists)).toThrow('Unsafe export filename')
  })
})
