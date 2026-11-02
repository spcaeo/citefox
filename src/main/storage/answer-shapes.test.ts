import { createHash } from 'node:crypto'
import { afterEach, describe, expect, test } from 'vitest'
import { openSqliteDatabase } from './database'
import { getAnswerShapes, listAnswerShapeHashes, saveAnswerShape } from './answer-shapes'
import { migrate } from './migrate'
import { closeTracked, track } from './migrate.test-helper'
import { PROJECT_MIGRATIONS } from './project-schema'

const NOW = '2026-10-20T09:00:00.000Z'
const TEMPLATE = sha('template')

afterEach(() => {
  closeTracked()
})

describe('answer shape storage', () => {
  test('saves, reads, and replaces one classification per overview hash', () => {
    const db = projectDb()
    const hash = sha('overview one')
    saveAnswerShape(db, {
      overviewHash: hash,
      templateHash: TEMPLATE,
      blocks: [
        { code: 'A1', excerpt: ' You can text employees ' },
        { code: 'C4', excerpt: 'Forward the alert email' }
      ],
      classifiedAt: NOW
    })
    expect(getAnswerShapes(db, [hash, sha('missing')])).toEqual(
      new Map([
        [
          hash,
          {
            overviewHash: hash,
            templateHash: TEMPLATE,
            blocks: [
              { code: 'A1', excerpt: 'You can text employees' },
              { code: 'C4', excerpt: 'Forward the alert email' }
            ],
            classifiedAt: NOW
          }
        ]
      ])
    )
    saveAnswerShape(db, {
      overviewHash: hash,
      templateHash: sha('edited template'),
      blocks: [{ code: 'F2', excerpt: 'Other' }],
      classifiedAt: '2026-10-21T09:00:00.000Z'
    })
    expect(getAnswerShapes(db, [hash]).get(hash)?.blocks).toEqual([
      { code: 'F2', excerpt: 'Other' }
    ])
    expect(listAnswerShapeHashes(db)).toEqual([hash])
  })

  test('reads more hashes than one query can bind', () => {
    const db = projectDb()
    const hashes = Array.from({ length: 1205 }, (_, index) => sha(`overview ${index}`))
    for (const hash of hashes.filter((_, index) => index % 2 === 0)) {
      saveAnswerShape(db, {
        overviewHash: hash,
        templateHash: TEMPLATE,
        blocks: [{ code: 'D1', excerpt: 'Example' }],
        classifiedAt: NOW
      })
    }
    const found = getAnswerShapes(db, [...hashes, ...hashes])
    expect(found.size).toBe(603)
    expect(found.has(hashes[1204] ?? '')).toBe(true)
    expect(found.has(hashes[1203] ?? '')).toBe(false)
    expect(getAnswerShapes(db, []).size).toBe(0)
  })

  test('drops blocks with an unknown code on read', () => {
    const db = projectDb()
    const hash = sha('tampered')
    db.prepare(
      `INSERT INTO answer_shapes (overview_hash, template_hash, blocks_json, classified_at)
       VALUES (?, ?, ?, ?)`
    ).run(
      hash,
      TEMPLATE,
      JSON.stringify([
        { code: 'A1', excerpt: 'Kept' },
        { code: 'Z9', excerpt: 'Dropped' },
        'not a block',
        { code: 'B3' }
      ]),
      NOW
    )
    expect(getAnswerShapes(db, [hash]).get(hash)?.blocks).toEqual([
      { code: 'A1', excerpt: 'Kept' },
      { code: 'B3', excerpt: '' }
    ])
  })

  test('rejects a bad hash, code, excerpt, or timestamp', () => {
    const db = projectDb()
    const good = {
      overviewHash: sha('x'),
      templateHash: TEMPLATE,
      blocks: [{ code: 'A1' as const, excerpt: 'Fine' }],
      classifiedAt: NOW
    }
    expect(() => saveAnswerShape(db, { ...good, overviewHash: 'short' })).toThrow()
    expect(() => saveAnswerShape(db, { ...good, templateHash: 'A'.repeat(64) })).toThrow()
    expect(() =>
      saveAnswerShape(db, {
        ...good,
        blocks: [{ code: 'Z9' as unknown as 'A1', excerpt: 'Bad code' }]
      })
    ).toThrow('Invalid answer shape code')
    expect(() => saveAnswerShape(db, { ...good, blocks: [{ code: 'A1', excerpt: ' ' }] })).toThrow(
      'Invalid answer shape excerpt'
    )
    expect(() =>
      saveAnswerShape(db, { ...good, blocks: [{ code: 'A1', excerpt: 'x'.repeat(161) }] })
    ).toThrow('Invalid answer shape excerpt')
    expect(() => saveAnswerShape(db, { ...good, classifiedAt: 'yesterday' })).toThrow()
    expect(() => getAnswerShapes(db, ['not-a-hash'])).toThrow()
    expect(listAnswerShapeHashes(db)).toEqual([])
  })
})

function projectDb(): ReturnType<typeof openSqliteDatabase> {
  const db = track(openSqliteDatabase(':memory:'))
  migrate(db, PROJECT_MIGRATIONS)
  return db
}

function sha(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}
