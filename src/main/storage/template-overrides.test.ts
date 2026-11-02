import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { DEFAULT_TEMPLATE_SETTINGS, type TemplateSettings } from '@shared/domain'
import { templateHash } from '../pipeline/templates'
import { closeDatabase, type SqliteDatabase } from './database'
import { createProjectDatabase } from './project-files'
import {
  findOverrideByHash,
  getCurrentOverride,
  insertTemplateOverride,
  listCurrentOverrides,
  listOverrideVersions,
  resetTemplateOverrides
} from './template-overrides'

const NOW = '2026-10-19T12:00:00.000Z'

const databases: SqliteDatabase[] = []
const directories: string[] = []

afterEach(() => {
  for (const db of databases.splice(0)) closeDatabase(db)
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function projectDb(): SqliteDatabase {
  const directory = mkdtempSync(join(tmpdir(), 'citefox-overrides-'))
  directories.push(directory)
  const db = createProjectDatabase(directory, 'textbolt')
  databases.push(db)
  return db
}

function save(
  db: SqliteDatabase,
  id: string,
  kind: string,
  body: string,
  settings: TemplateSettings = DEFAULT_TEMPLATE_SETTINGS,
  createdAt = NOW
): ReturnType<typeof insertTemplateOverride> {
  return insertTemplateOverride(db, {
    id,
    kind,
    baseTemplateId: `tpl-${kind.replace(/_/g, '-')}`,
    body,
    hash: templateHash(body),
    settings,
    createdAt
  })
}

describe('template_overrides', () => {
  test('saves numbered versions and the newest is current', () => {
    const db = projectDb()
    expect(getCurrentOverride(db, 'aio_gap')).toBeNull()
    const first = save(db, 'ovr-1', 'aio_gap', 'One {{ page.url }}')
    const settings: TemplateSettings = {
      model: 'claude-opus-5-5',
      language: 'es',
      promptCount: null,
      tone: null
    }
    const second = save(db, 'ovr-2', 'aio_gap', 'Two {{ page.url }}', settings)
    expect([first.version, second.version]).toEqual([1, 2])
    expect(getCurrentOverride(db, 'aio_gap')).toEqual({
      id: 'ovr-2',
      kind: 'aio_gap',
      version: 2,
      baseTemplateId: 'tpl-aio-gap',
      body: 'Two {{ page.url }}',
      hash: templateHash('Two {{ page.url }}'),
      settings,
      createdAt: NOW,
      resetAt: null
    })
  })

  test('reset marks every version, keeps them, and the next save continues the numbers', () => {
    const db = projectDb()
    save(db, 'ovr-1', 'coverage', 'One')
    save(db, 'ovr-2', 'coverage', 'Two')
    expect(resetTemplateOverrides(db, 'coverage', '2026-10-19T13:00:00.000Z')).toBe(2)
    expect(getCurrentOverride(db, 'coverage')).toBeNull()
    const kept = listOverrideVersions(db, 'coverage')
    expect(kept.map((item) => [item.version, item.resetAt])).toEqual([
      [2, '2026-10-19T13:00:00.000Z'],
      [1, '2026-10-19T13:00:00.000Z']
    ])
    expect(resetTemplateOverrides(db, 'coverage', '2026-10-19T14:00:00.000Z')).toBe(0)
    const third = save(db, 'ovr-3', 'coverage', 'Three')
    expect(third.version).toBe(3)
    expect(getCurrentOverride(db, 'coverage')?.id).toBe('ovr-3')
    expect(listOverrideVersions(db, 'coverage').map((item) => item.resetAt)).toEqual([
      null,
      '2026-10-19T13:00:00.000Z',
      '2026-10-19T13:00:00.000Z'
    ])
  })

  test('lists current overrides by kind, leaving out a reset kind', () => {
    const db = projectDb()
    save(db, 'ovr-1', 'aio_gap', 'Gap one')
    save(db, 'ovr-2', 'aio_gap', 'Gap two')
    save(db, 'ovr-3', 'run_summary', 'Summary')
    save(db, 'ovr-4', 'buyer_profile', 'Profile')
    resetTemplateOverrides(db, 'buyer_profile', NOW)
    const current = listCurrentOverrides(db)
    expect([...current.keys()].sort()).toEqual(['aio_gap', 'run_summary'])
    expect(current.get('aio_gap')?.id).toBe('ovr-2')
    expect(current.get('run_summary')?.version).toBe(1)
  })

  test('finds any version by hash, current or reset', () => {
    const db = projectDb()
    save(db, 'ovr-1', 'aio_gap', 'Old wording')
    save(db, 'ovr-2', 'aio_gap', 'New wording')
    resetTemplateOverrides(db, 'aio_gap', NOW)
    expect(findOverrideByHash(db, 'aio_gap', templateHash('Old wording'))?.id).toBe('ovr-1')
    expect(findOverrideByHash(db, 'run_summary', templateHash('Old wording'))).toBeNull()
    expect(findOverrideByHash(db, 'aio_gap', 'f'.repeat(64))).toBeNull()
  })

  test('unreadable stored settings become the defaults', () => {
    const db = projectDb()
    save(db, 'ovr-1', 'aio_gap', 'Body')
    db.prepare(`UPDATE template_overrides SET settings_json = ? WHERE id = 'ovr-1'`).run(
      '{"model":"bad model!","tone":"shouty","promptCount":99}'
    )
    expect(getCurrentOverride(db, 'aio_gap')?.settings).toEqual(DEFAULT_TEMPLATE_SETTINGS)
  })

  test('rejects a bad kind, a bad hash, an empty body, and a body with a key', () => {
    const db = projectDb()
    expect(() => save(db, 'ovr-1', 'Bad Kind', 'Body')).toThrow(/kind/)
    expect(() => getCurrentOverride(db, 'drop table')).toThrow(/kind/)
    expect(() =>
      insertTemplateOverride(db, {
        id: 'ovr-2',
        kind: 'aio_gap',
        baseTemplateId: 'tpl-aio-gap',
        body: 'Body',
        hash: 'not-a-hash',
        settings: DEFAULT_TEMPLATE_SETTINGS,
        createdAt: NOW
      })
    ).toThrow(/hash/)
    expect(() =>
      insertTemplateOverride(db, {
        id: 'ovr-3',
        kind: 'aio_gap',
        baseTemplateId: 'tpl-aio-gap',
        body: '',
        hash: templateHash(''),
        settings: DEFAULT_TEMPLATE_SETTINGS,
        createdAt: NOW
      })
    ).toThrow(/body/)
    expect(() => save(db, 'ovr-4', 'aio_gap', 'Use sk-ant-api03-abcdefghijklmnop here')).toThrow(
      /secret/
    )
    expect(listOverrideVersions(db, 'aio_gap')).toEqual([])
  })
})
