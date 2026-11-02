import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { closeDatabase, type SqliteDatabase } from './database'
import { StorageError } from './errors'
import {
  closeProjectDatabase,
  createProjectDatabase,
  listProjectSlugs,
  openProjectDatabase
} from './project-files'
import { projectDatabasePath } from './slug'

const databases: SqliteDatabase[] = []
const directories: string[] = []

afterEach(() => {
  for (const db of databases.splice(0)) closeDatabase(db)
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('project sqlite files', () => {
  test('creates, lists, closes, and reopens a project file', () => {
    const root = tempDir()
    const projects = join(root, 'projects')
    const created = track(createProjectDatabase(projects, 'textbolt'))
    created.exec('CREATE TABLE marker (id INTEGER)')
    created.prepare('INSERT INTO marker (id) VALUES (1)').run()
    closeProjectDatabase(created)

    expect(listProjectSlugs(projects)).toEqual(['textbolt'])
    const opened = track(openProjectDatabase(projects, 'textbolt'))
    const row = opened.prepare<unknown[], { id: number }>('SELECT id FROM marker').get()
    expect(row?.id).toBe(1)
    expect(tableNames(opened)).not.toContain('projects')
    expect(tableNames(opened)).not.toContain('api_keys')
  })

  test('lists only safe sqlite slugs and sorts them', () => {
    const root = tempDir()
    const projects = join(root, 'projects')
    track(createProjectDatabase(projects, 'client-2'))
    track(createProjectDatabase(projects, 'alpha'))
    writeFileSync(join(projects, 'notes.txt'), 'ignore')
    writeFileSync(join(projects, 'Not-A-Slug.sqlite'), 'ignore')
    writeFileSync(join(projects, 'alpha.sqlite-wal'), '')
    expect(listProjectSlugs(projects)).toEqual(['alpha', 'client-2'])
    expect(listProjectSlugs(join(root, 'missing'))).toEqual([])
  })

  test('rejects path traversal and other unsafe slugs', () => {
    const projects = join(tempDir(), 'projects')
    const unsafe = [
      '..',
      '.',
      '../secret',
      'foo/bar',
      'foo\\bar',
      'foo.sqlite',
      '/etc/passwd',
      'foo..bar',
      '-leading',
      'trailing-',
      '',
      'HasCaps',
      'has space',
      'null\0byte',
      'con',
      'aux',
      'a'.repeat(65),
      'a'.repeat(64)
    ]
    for (const slug of unsafe) {
      expect(() => createProjectDatabase(projects, slug)).toThrow(StorageError)
      expect(() => projectDatabasePath(projects, slug)).toThrow(/slug/)
    }
    expect(listProjectSlugs(projects)).toEqual([])
  })

  test('refuses to open a symlink that leaves the projects directory', () => {
    const root = tempDir()
    const projects = join(root, 'projects')
    track(createProjectDatabase(projects, 'kept'))
    const outside = join(root, 'outside.sqlite')
    writeFileSync(outside, 'outside')
    symlinkSync(outside, join(projects, 'evil.sqlite'))
    expect(() => openProjectDatabase(projects, 'evil')).toThrow(/path/)
    expect(listProjectSlugs(projects)).toEqual(['kept'])
  })

  test('refuses to create a duplicate or open a missing project', () => {
    const projects = join(tempDir(), 'projects')
    track(createProjectDatabase(projects, 'alpha'))
    expect(() => createProjectDatabase(projects, 'alpha')).toThrow(/already exists/)
    expect(() => openProjectDatabase(projects, 'missing')).toThrow(/does not exist/)
  })
})

function tempDir(): string {
  const directory = mkdtempSync(join(tmpdir(), 'citefox-projects-'))
  directories.push(directory)
  return directory
}

function track(db: SqliteDatabase): SqliteDatabase {
  databases.push(db)
  return db
}

function tableNames(db: SqliteDatabase): string[] {
  return db
    .prepare<unknown[], { name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all()
    .map((row) => row.name)
}
