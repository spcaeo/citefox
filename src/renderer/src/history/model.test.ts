import { describe, expect, it } from 'vitest'
import type { DiffLine, HistoryEvent } from '@shared/domain'
import {
  changeText,
  collapseDiff,
  cycleHistorySort,
  eventMonth,
  eventSearchText,
  filterByKind,
  isValidNoteDate,
  kindCounts,
  monthsNewestFirst,
  newestFirst,
  noteDateIso,
  scoreText,
  sortEvents,
  statusLine,
  todayLocal,
  typeLabel
} from './model'

function event(
  patch: Partial<HistoryEvent> & Pick<HistoryEvent, 'id' | 'primary' | 'at'>
): HistoryEvent {
  return {
    kinds: [patch.primary],
    title: patch.id,
    detail: null,
    check: null,
    content: null,
    note: null,
    fix: null,
    promptSet: null,
    ...patch
  }
}

function check(id: string, at: string, score: number | null, change: number | null): HistoryEvent {
  return event({
    id,
    primary: 'check',
    at,
    check: {
      runId: id,
      marketId: 'us',
      kind: 'scheduled',
      partial: false,
      promptsChecked: 10,
      promptsTotal: 10,
      score,
      scoreChange: change,
      promptSetVersion: 2,
      contentChanged: change === null ? null : false
    }
  })
}

const events: HistoryEvent[] = [
  check('c1', '2026-09-21T10:00:00.000Z', 24, null),
  { ...check('c3', '2026-10-19T10:00:00.000Z', 50, 12), kinds: ['check', 'content'] },
  check('c2', '2026-10-05T10:00:00.000Z', 38, 14),
  event({
    id: 'n1',
    primary: 'note',
    at: '2026-10-08T12:00:00.000Z',
    note: { id: 'n1', date: '2026-10-08', text: 'Added 5 FAQs' }
  }),
  event({
    id: 'f1',
    primary: 'fix',
    at: '2026-10-08T00:00:00.000Z',
    fix: { id: 'f1', number: 1, verdict: null, planned: false, promptPositions: [4, 6, 9] }
  }),
  event({
    id: 'p2',
    primary: 'prompt_set',
    at: '2026-09-20T10:00:00.000Z',
    promptSet: { id: 'p2', version: 2, promptCount: 10, active: true }
  })
]

describe('history kinds', () => {
  it('counts every kind, listing a check with changed content under both', () => {
    expect(kindCounts(events)).toEqual({
      all: 6,
      check: 3,
      content: 1,
      note: 1,
      fix: 1,
      prompt_set: 1
    })
  })

  it('filters by kind and keeps all for "all"', () => {
    expect(filterByKind(events, 'all')).toHaveLength(6)
    expect(filterByKind(events, 'content').map((item) => item.id)).toEqual(['c3'])
    expect(filterByKind(events, 'check').map((item) => item.id)).toEqual(['c1', 'c3', 'c2'])
  })

  it('orders newest first, ties by id', () => {
    expect(newestFirst(events).map((item) => item.id)).toEqual(['c3', 'n1', 'f1', 'c2', 'c1', 'p2'])
  })

  it('names each type', () => {
    expect(events.map(typeLabel)).toEqual([
      'Check',
      'Check',
      'Check',
      'Note',
      'Fix',
      'Question set'
    ])
    expect(typeLabel(event({ id: 'x', primary: 'content', at: events[0]!.at }))).toBe(
      'Content change'
    )
  })
})

describe('history table sorting', () => {
  it('starts each column in its natural direction and cycles off', () => {
    expect(cycleHistorySort([], 'date', false)).toEqual([{ key: 'date', dir: 'desc' }])
    expect(cycleHistorySort([], 'type', false)).toEqual([{ key: 'type', dir: 'asc' }])
    expect(cycleHistorySort([{ key: 'date', dir: 'desc' }], 'date', false)).toEqual([
      { key: 'date', dir: 'asc' }
    ])
    expect(cycleHistorySort([{ key: 'date', dir: 'asc' }], 'date', false)).toEqual([])
  })

  it('adds a second sort with Shift', () => {
    expect(cycleHistorySort([{ key: 'type', dir: 'asc' }], 'score', true)).toEqual([
      { key: 'type', dir: 'asc' },
      { key: 'score', dir: 'desc' }
    ])
  })

  it('sorts by score with blanks last, then by type and date', () => {
    expect(sortEvents(events, [{ key: 'score', dir: 'desc' }]).map((item) => item.id)).toEqual([
      'c3',
      'c2',
      'c1',
      'n1',
      'f1',
      'p2'
    ])
    expect(
      sortEvents(events, [
        { key: 'type', dir: 'asc' },
        { key: 'date', dir: 'asc' }
      ]).map((item) => item.id)
    ).toEqual(['c1', 'c2', 'c3', 'f1', 'n1', 'p2'])
    expect(sortEvents(events, []).map((item) => item.id)[0]).toBe('c3')
  })
})

describe('labels', () => {
  it('formats score and change', () => {
    expect(scoreText(50)).toBe('Score 50')
    expect(scoreText(null)).toBe('No score')
    expect(changeText(12)).toBe('+12')
    expect(changeText(-3)).toBe('−3')
    expect(changeText(0)).toBe('0')
    expect(changeText(null)).toBe('—')
  })

  it('states how many events are shown', () => {
    expect(statusLine('all', 7, 7, 'timeline')).toBe('All 7 events · newest first')
    expect(statusLine('note', 2, 7, 'timeline')).toBe('2 events of 7 · Notes · newest first')
    expect(statusLine('note', 1, 7, 'table')).toBe('1 event of 7 · Notes')
    expect(statusLine('all', 1, 1, 'table')).toBe('All 1 event')
  })
})

describe('note dates', () => {
  it('accepts real calendar dates only', () => {
    expect(isValidNoteDate('2026-10-19')).toBe(true)
    expect(isValidNoteDate('2026-02-30')).toBe(false)
    expect(isValidNoteDate('2026-1-9')).toBe(false)
    expect(isValidNoteDate('')).toBe(false)
  })

  it('defaults to the local day and maps a date to local noon', () => {
    expect(todayLocal(new Date(2026, 9, 5, 23, 30))).toBe('2026-10-05')
    expect(new Date(noteDateIso('2026-10-08')).getDate()).toBe(8)
  })
})

describe('diff folding', () => {
  const same = (n: number): DiffLine[] =>
    Array.from({ length: n }, (_, i) => ({ op: 'same' as const, text: `line ${i}` }))

  it('folds long unchanged runs and keeps context around changes', () => {
    const lines: DiffLine[] = [
      ...same(10),
      { op: 'removed', text: 'old' },
      { op: 'added', text: 'new' },
      ...same(10)
    ]
    const items = collapseDiff(lines, 2)
    expect(items[0]).toEqual({ kind: 'fold', count: 8 })
    expect(items.filter((item) => item.kind === 'line')).toHaveLength(6)
    expect(items.at(-1)).toEqual({ kind: 'fold', count: 8 })
  })

  it('keeps short runs and an all-same diff folds once', () => {
    expect(collapseDiff(same(3), 2)).toEqual([{ kind: 'fold', count: 3 }])
    const short: DiffLine[] = [{ op: 'added', text: 'a' }, ...same(3), { op: 'added', text: 'b' }]
    expect(collapseDiff(short, 2).every((item) => item.kind === 'line')).toBe(true)
    expect(collapseDiff([], 2)).toEqual([])
  })
})

describe('grid grouping and search', () => {
  it('groups by local month, newest month first, and notes by their own date', () => {
    const october = event({ id: 'a', primary: 'check', at: '2026-10-19T12:00:00.000Z' })
    const september = event({ id: 'b', primary: 'prompt_set', at: '2026-09-20T12:00:00.000Z' })
    const note = event({
      id: 'n',
      primary: 'note',
      at: '2026-10-01T12:00:00.000Z',
      note: { id: 'n', date: '2026-08-15', text: 'Rewrote the FAQ' }
    })
    expect(eventMonth(october)).toEqual({ key: '2026-10', label: 'October 2026' })
    expect(eventMonth(note)).toEqual({ key: '2026-08', label: 'August 2026' })
    expect(monthsNewestFirst([september, note, october])).toEqual(['2026-10', '2026-09', '2026-08'])
    expect(eventSearchText(note)).toContain('rewrote the faq')
    expect(eventSearchText(note)).toContain('note')
  })
})
