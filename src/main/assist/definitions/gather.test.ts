import { afterEach, describe, expect, test } from 'vitest'
import { closeDatabase, openSqliteDatabase, type SqliteDatabase } from '../../storage/database'
import { ensureProjectSchema } from '../../storage/project-profile'
import { AssistInputError } from '../types'
import { profileOf } from './gather'

const databases: SqliteDatabase[] = []

afterEach(() => {
  for (const db of databases.splice(0)) closeDatabase(db)
})

function emptyDb(): SqliteDatabase {
  const db = openSqliteDatabase(':memory:')
  databases.push(db)
  ensureProjectSchema(db)
  return db
}

function failure(run: () => unknown): AssistInputError {
  try {
    run()
  } catch (error) {
    if (error instanceof AssistInputError) return error
    throw error
  }
  throw new Error('expected a failure')
}

describe('profileOf', () => {
  test('a topic with no buyer profile gets plain copy, not "Invalid buyer profile"', () => {
    const error = failure(() => profileOf(emptyDb(), 'topic-1', 'topic'))
    expect(error.message).toBe('This topic has no buyer profile yet.')
    expect(error.nextStep).toMatch(/buyer profile/u)
  })

  test('a page with no buyer profile keeps the page wording', () => {
    expect(failure(() => profileOf(emptyDb(), 'page-1')).message).toBe(
      'Write the buyer profile first.'
    )
  })
})
