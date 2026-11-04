import { describe, expect, test } from 'vitest'
import { fix, outcome } from './fixtures'
import {
  cleanError,
  daysBetween,
  filterCounts,
  filterStatus,
  fixMarkers,
  fixRows,
  fixSummaryLine,
  localMidnightIso,
  othersLine,
  planFixHash,
  promptList,
  promptMarks,
  readFixDraft,
  ruleOption,
  savedLine,
  searchCostLine,
  shortText,
  stateLabel,
  todayInput
} from './model'

const NOW = new Date('2026-10-20T12:00:00.000Z')

describe('fix labels', () => {
  test('state, question list and summary line read like the mock-up', () => {
    expect(stateLabel({ status: 'page_cited', position: 3 })).toBe('Page cited · 3')
    expect(stateLabel({ status: 'brand_mentioned', position: null })).toBe('Brand mentioned')
    expect(stateLabel(null)).toBe('Not checked')
    expect(promptList([9, 4, 6])).toBe('questions 4, 6 and 9')
    expect(promptList([5])).toBe('question 5')
    expect(daysBetween('2026-10-08T12:00:00.000Z', '2026-10-12T09:00:00.000Z')).toBe(4)
    expect(daysBetween('2026-10-12T09:00:00.000Z', '2026-10-08T12:00:00.000Z')).toBe(0)
    expect(fixSummaryLine(fix(), outcome(), [4, 6, 9], '🇺🇸 US · EN', NOW)).toBe(
      'Live Oct 8, 12:00 PM · targets questions 4, 6 and 9 · checked Oct 19, 12:00 PM, 11 days later · 🇺🇸 US · EN'
    )
    const planned = fix({
      status: 'planned',
      goLiveAt: '2026-10-21T12:00:00.000Z',
      followUpAt: '2026-10-24T12:00:00.000Z',
      markets: [outcome({ verdict: 'waiting', afterAt: null, afterRunId: null })]
    })
    expect(fixSummaryLine(planned, planned.markets[0], [4, 5], '🇺🇸 US · EN', NOW)).toBe(
      'Goes live Oct 21, 12:00 PM · targets questions 4 and 5 · follow-up check planned for Oct 24, 12:00 PM · 🇺🇸 US · EN'
    )
  })

  test('the comparison line never claims a cause', () => {
    expect(othersLine(outcome().others)).toBe(
      '3 of the 7 questions you didn’t target also moved in the same period. Google’s overviews shift on their own, so treat one check as a signal, not proof.'
    )
    expect(othersLine(null)).toContain('nothing to compare yet')
  })

  test('search cost and the recheck options state their dates', () => {
    expect(searchCostLine({ searchesMin: 8, searchesMax: 16, samples: 1 }, 2, 4)).toBe(
      'The follow-up uses 8–16 searches (2 questions × 4 markets).'
    )
    expect(searchCostLine(null, 0, 2)).toContain('Pick at least one question')
    const preview = {
      nextFixNumber: 2,
      samples: 1,
      searchesMin: 2,
      searchesMax: 4,
      followUpAt: {
        after_3_days: '2026-10-24T12:00:00.000Z',
        after_7_days: '2026-10-28T12:00:00.000Z',
        next_scheduled: null
      }
    }
    expect(ruleOption('after_3_days', preview)).toBe('3 days after it goes live (Oct 24, 12:00 PM)')
    expect(ruleOption('next_scheduled', preview)).toBe(
      'At the next scheduled check (none planned for this page)'
    )
  })
})

describe('fix filters', () => {
  test('counts targeted questions by result and waiting questions as planned', () => {
    const planned = fix({
      id: 'fix-2',
      number: 2,
      status: 'planned',
      promptIds: ['p4', 'p5'],
      markets: [outcome({ verdict: 'waiting' })]
    })
    const rows = fixRows([fix(), planned], 'mkt-us')
    const counts = filterCounts(rows)
    expect(counts).toEqual({ all: 5, worked: 1, no_change: 1, got_worse: 1, planned: 2 })
    expect(filterStatus('all', counts)).toBe(
      'Showing all 5 targeted questions: 3 checked after a fix, 2 waiting for a follow-up.'
    )
    expect(filterStatus('worked', counts)).toBe('Showing 1 of 5 targeted questions · Worked')
  })
})

describe('chart markers and question marks (FR-14.3, FR-14.8)', () => {
  test('a live fix is an orange line; a planned fix and its follow-up are planned lines', () => {
    const planned = fix({
      id: 'fix-2',
      number: 2,
      description: 'Add a **Verizon** FAQ and the migration step for txt.att.net',
      status: 'planned',
      goLiveAt: '2026-10-21T12:00:00.000Z',
      followUpAt: '2026-10-24T12:00:00.000Z',
      promptIds: ['p4', 'p5']
    })
    const markers = fixMarkers([planned, fix()], 'mkt-us', 10, NOW)
    expect(markers.map((marker) => [marker.chartTitle, marker.band, marker.planned])).toEqual([
      ['Fix 1 · Oct 8, 12:00 PM', 'fix', false],
      ['Fix 2 · Oct 21, 12:00 PM', 'fix', true],
      ['Follow-up', 'plan', true]
    ])
    expect(markers[0]?.chartDetail).toBe('Added 5 FAQs')
    expect(markers[2]?.promptsLabel).toBe('2 of 10')
    expect(fixMarkers([fix()], 'mkt-uk', 10, NOW)).toEqual([])
    expect(shortText('Add a **Verizon** FAQ and the migration step')).toBe(
      'Add a Verizon FAQ and the m…'
    )
  })

  test('marks targeted and planned questions by fix number', () => {
    const planned = fix({
      id: 'fix-2',
      number: 2,
      goLiveAt: '2026-10-21T12:00:00.000Z',
      promptIds: ['p4', 'p5']
    })
    const marks = promptMarks([planned, fix()], NOW)
    expect(marks.get('p4')).toEqual([
      { number: 1, planned: false },
      { number: 2, planned: true }
    ])
    expect(marks.get('p6')).toEqual([{ number: 1, planned: false }])
    expect(marks.has('p1')).toBe(false)
  })
})

describe('dates and the Plan as Fix N hash', () => {
  test('converts a date input to local midnight and back', () => {
    const iso = localMidnightIso('2026-10-21')
    expect(iso).not.toBeNull()
    expect(todayInput(new Date(String(iso)))).toBe('2026-10-21')
    expect(localMidnightIso('2026-02-30')).toBeNull()
    expect(localMidnightIso('Oct 21')).toBeNull()
  })

  test('Plan as Fix N opens the fix drawer on Progress › Fixes with the draft', () => {
    const hash = planFixHash('page 1', {
      description: '1. Add the txt.att.net migration step\n2. Add a Verizon FAQ',
      promptIds: ['p4', 'p5', 'p4']
    })
    expect(hash.startsWith('#/pages/page%201/progress?view=fixes&drawer=fix&fix=new')).toBe(true)
    const params = new URLSearchParams(hash.split('?')[1])
    expect(params.get('fix.page')).toBe('page 1')
    expect(params.get('fix.prompts')).toBe('p4,p5')
    expect(params.get('fix.text')).toBe(
      '1. Add the txt.att.net migration step\n2. Add a Verizon FAQ'
    )
    // Not an old `plan=1` link.
    expect(readFixDraft(hash)).toBeNull()
  })

  test('reads an old plan=1 link and ignores other hashes', () => {
    expect(
      readFixDraft('#/pages/page-1/progress?plan=1&prompts=p4,p5,p4&text=Add+a+Verizon+FAQ')
    ).toEqual({ description: 'Add a Verizon FAQ', promptIds: ['p4', 'p5'] })
    expect(readFixDraft('#/pages/page-1/progress')).toBeNull()
    expect(readFixDraft('#/pages/page-1/progress?prompts=p1')).toBeNull()
    expect(readFixDraft('#/x?plan=1&prompts=../evil,p2')?.promptIds).toEqual(['p2'])
  })
})

describe('error and saved lines', () => {
  test('strips the IPC prefix from a refusal', () => {
    expect(
      cleanError(
        new Error(
          "Error invoking remote method 'fixes:create': Error: fixes:create: Pick at least one market"
        )
      )
    ).toBe('Pick at least one market.')
    expect(cleanError('nope')).toBe('Could not save the fix.')
  })

  test('says when the follow-up runs', () => {
    expect(savedLine(fix({ followUpAt: '2026-10-24T12:00:00.000Z' }))).toBe(
      'Saved Fix 1 · follow-up check Oct 24, 12:00 PM'
    )
    expect(savedLine(fix({ followUpAt: null }))).toBe(
      'Saved Fix 1 · follow-up at the next scheduled check'
    )
  })
})
