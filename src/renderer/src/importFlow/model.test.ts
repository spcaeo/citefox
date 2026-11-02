import { describe, expect, test } from 'vitest'
import { summaryParts } from './model'

const ZERO = { new: 0, keyword: 0, similar: 0, duplicate: 0, fix: 0, total: 0 }

describe('summaryParts', () => {
  test('near duplicates merged are counted apart from exact duplicates', () => {
    expect(
      summaryParts({ ...ZERO, new: 100, duplicate: 6, merged: 2, similar: 5, fix: 3, total: 114 })
    ).toEqual([
      '100 to add',
      '4 duplicates skipped',
      '2 similar merged',
      '5 to decide',
      '3 need a fix'
    ])
  })

  test('only merged rows, or counts without a merged field, read as before', () => {
    expect(summaryParts({ ...ZERO, new: 1, duplicate: 1, merged: 1, total: 2 })).toEqual([
      '1 to add',
      '1 similar merged'
    ])
    expect(summaryParts({ ...ZERO, new: 2, duplicate: 1, total: 3 })).toEqual([
      '2 to add',
      '1 duplicate skipped'
    ])
  })
})
