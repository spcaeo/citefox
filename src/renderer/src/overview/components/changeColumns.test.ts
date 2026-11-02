import { describe, expect, it } from 'vitest'
import { gridTemplate } from '../../ui/listGrid/columns'
import { fittedChangeColumns } from './changeColumns'

const ids = (comparing: boolean, width: number): string[] =>
  fittedChangeColumns(comparing, width).map((column) => column.id)

describe('fittedChangeColumns', () => {
  it('leaves out Before and Change when there is nothing to compare', () => {
    expect(ids(false, 2000)).toEqual(['question', 'from', 'you', 'position', 'ask'])
  })

  it('drops From first in a narrow panel (the 683px panel of a 1321 window), then Change, never Before', () => {
    expect(ids(true, 2000)).toEqual([
      'question',
      'from',
      'before',
      'you',
      'position',
      'change',
      'ask'
    ])
    expect(ids(true, 683)).toEqual(['question', 'before', 'you', 'change', 'ask'])
    // Summary's panel beside the rail in a 1280 window: Before and Now still both show.
    expect(ids(true, 653)).toEqual(['question', 'before', 'you', 'change', 'ask'])
    // Narrower still: Change goes (Before → Now says it), and Before → Now stays.
    expect(ids(true, 520)).toEqual(['question', 'before', 'you', 'ask'])
  })

  it('drops From with one source, and names the first column by what it counts', () => {
    const one = fittedChangeColumns(true, 2000, { primary: 'Search', oneSource: true })
    expect(one.map((column) => column.id)).toEqual([
      'question',
      'before',
      'you',
      'position',
      'change',
      'ask'
    ])
    expect(one[0]?.label).toBe('Search')
  })

  it('always fits the width it was given down to the last drop', () => {
    for (const width of [683, 600, 560, 520]) {
      const columns = fittedChangeColumns(true, width)
      expect(gridTemplate(columns, false, false).minWidth).toBeLessThanOrEqual(width)
    }
  })
})
