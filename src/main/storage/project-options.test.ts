import { afterEach, describe, expect, test } from 'vitest'
import { closeDatabase, openSqliteDatabase, type SqliteDatabase } from './database'
import { StorageError } from './errors'
import { ensureProjectSchema } from './project-profile'
import {
  defaultProjectOptions,
  readProjectOptions,
  writeProjectOptions,
  type ProjectOptions
} from './project-options'

const databases: SqliteDatabase[] = []

afterEach(() => {
  for (const db of databases.splice(0)) closeDatabase(db)
})

function projectDb(): SqliteDatabase {
  const db = openSqliteDatabase(':memory:')
  databases.push(db)
  ensureProjectSchema(db)
  return db
}

describe('project options (project migration 017)', () => {
  test('a new project reads the defaults: follow Settings, wait on a limit, app model', () => {
    const db = projectDb()
    expect(readProjectOptions(db)).toEqual(defaultProjectOptions())
    expect(defaultProjectOptions().claude).toEqual({
      connection: 'app_default',
      keyId: null,
      fallback: 'wait',
      fallbackKeyId: null,
      model: null
    })
  })

  test('round-trips a named API key with a switch-to-key fallback, samples, and overrides', () => {
    const db = projectDb()
    const options: ProjectOptions = {
      claude: {
        connection: 'api_key',
        keyId: 'key-client',
        fallback: 'switch_key',
        fallbackKeyId: 'key-mine',
        model: 'claude-opus-5-5'
      },
      defaultSamples: 3,
      templateOverrides: [{ kind: 'buyer_prompts', templateId: 'tpl-custom' }]
    }
    writeProjectOptions(db, options)
    expect(readProjectOptions(db)).toEqual(options)
    writeProjectOptions(db, defaultProjectOptions())
    expect(readProjectOptions(db)).toEqual(defaultProjectOptions())
  })

  test('drops key ids the chosen connection and fallback do not use', () => {
    const db = projectDb()
    writeProjectOptions(db, {
      ...defaultProjectOptions(),
      claude: {
        connection: 'claude_code',
        keyId: 'key-stale',
        fallback: 'retry_later',
        fallbackKeyId: 'key-stale',
        model: null
      }
    })
    expect(readProjectOptions(db).claude).toMatchObject({ keyId: null, fallbackKeyId: null })
  })

  test('refuses an API key connection without a key, a bad model, and duplicate overrides', () => {
    const db = projectDb()
    const base = defaultProjectOptions()
    expect(() =>
      writeProjectOptions(db, { ...base, claude: { ...base.claude, connection: 'api_key' } })
    ).toThrow(StorageError)
    expect(() =>
      writeProjectOptions(db, { ...base, claude: { ...base.claude, model: 'bad model!' } })
    ).toThrow(StorageError)
    expect(() =>
      writeProjectOptions(db, {
        ...base,
        templateOverrides: [
          { kind: 'coverage', templateId: 'tpl-a' },
          { kind: 'coverage', templateId: 'tpl-b' }
        ]
      })
    ).toThrow(StorageError)
    expect(readProjectOptions(db)).toEqual(base)
  })
})
