import { describe, expect, it } from 'vitest'
import type { OverviewCompare, OverviewQuestion } from '@shared/ipc'
import {
  compareLabel,
  compareOptions,
  compareValue,
  filterQuestions,
  questionFilterFrom,
  questionFilterOptions,
  wasText
} from './compare'

const PREVIOUS: OverviewCompare = {
  vs: null,
  mode: 'previous',
  at: null,
  unknown: false,
  available: true,
  options: [
    { value: 'run-2', at: '2026-10-12T09:00:00.000Z' },
    { value: 'run-1', at: '2026-10-05T09:00:00.000Z' }
  ]
}

function q(
  change: OverviewQuestion['change'],
  you: OverviewQuestion['you'] = 'not_cited'
): Pick<OverviewQuestion, 'change' | 'you'> {
  return { change, you }
}

describe('overview compare model', () => {
  it('reads the compared check as a sentence, or null when nothing compares', () => {
    const diff = { gained: 1, kept: 0, lost: 0, never: 0, unmatched: 0 }
    expect(compareLabel({ compare: PREVIOUS, diff })).toBe('the previous check')
    expect(
      compareLabel({
        compare: { ...PREVIOUS, vs: 'run-1', mode: 'run', at: '2026-10-05T09:00:00.000Z' },
        diff
      })
    ).toBe('the Oct 5 check')
    expect(
      compareLabel({
        compare: { ...PREVIOUS, vs: '2026-10-07', mode: 'day', at: '2026-10-07T23:59:59.999Z' },
        diff
      })
    ).toBe('Oct 7')
    expect(compareLabel({ compare: PREVIOUS, diff: null })).toBeNull()
    expect(compareLabel({ compare: { ...PREVIOUS, available: false }, diff })).toBeNull()
  })

  it('offers previous, each earlier check, and a day picked in the URL', () => {
    expect(compareOptions(PREVIOUS).map((option) => option.label)).toEqual([
      'Previous check',
      'Oct 12, 2026 check',
      'Oct 5, 2026 check'
    ])
    const day = {
      ...PREVIOUS,
      vs: '2026-10-07',
      mode: 'day' as const,
      at: '2026-10-07T23:59:59.999Z'
    }
    expect(compareOptions(day).at(-1)).toEqual({ value: '2026-10-07', label: 'Oct 7, 2026' })
    expect(compareValue(day)).toBe('2026-10-07')
    // An unknown check shows as Previous check, and is not offered.
    const unknown = { ...PREVIOUS, vs: 'run-gone', unknown: true }
    expect(compareValue(unknown)).toBe('')
    expect(compareOptions(unknown)).toHaveLength(3)
  })

  it('filters questions by change, Changed by default', () => {
    // The second `never` has no AI Overview now: nothing to cite, so not "still not cited".
    const rows = [
      q('gained', 'cited'),
      q('lost'),
      q('kept', 'cited'),
      q('never'),
      q(null),
      q('never', 'no_aio')
    ] as OverviewQuestion[]
    expect(questionFilterFrom(null, true)).toBe('changed')
    expect(questionFilterFrom('kept', true)).toBe('kept')
    expect(questionFilterFrom('nope', true)).toBe('changed')
    expect(questionFilterFrom('kept', false)).toBe('all')
    expect(filterQuestions(rows, 'changed').map((row) => row.change)).toEqual(['gained', 'lost'])
    expect(filterQuestions(rows, 'never')).toHaveLength(1)
    expect(filterQuestions(rows, 'all')).toHaveLength(6)
    expect(questionFilterOptions(rows).map((option) => [option.label, option.count])).toEqual([
      ['Changed', 2],
      ['Gained', 1],
      ['Kept', 1],
      ['Lost', 1],
      ['Still not cited', 1],
      ['All', 6]
    ])
  })

  it('writes an earlier KPI value for its small line', () => {
    expect(wasText(4, PREVIOUS)).toBe('was 4')
    expect(wasText(9, PREVIOUS, '%')).toBe('was 9%')
    expect(
      wasText(1200, { ...PREVIOUS, mode: 'run', vs: 'run-1', at: '2026-10-05T09:00:00.000Z' })
    ).toBe('was 1,200 on Oct 5')
    expect(wasText(null, PREVIOUS)).toBeNull()
  })
})
