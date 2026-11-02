import { describe, expect, it } from 'vitest'
import type { FixQuestion, FixQuestionCheck } from '@shared/fix-verdict'
import { fix, outcome } from '../progress/fixtures'
import { fixEvents, fixesFor, subjectLabels, topicSubjectIds } from './chartEvents'

const NOW = new Date('2026-10-30T12:00:00.000Z')

describe('fixEvents', () => {
  it('turns a fix into a numbered marker with before → now and its verdict', () => {
    const [event] = fixEvents([fix()], { marketId: 'mkt-us', now: NOW, pageLabel: () => '/alerts' })
    expect(event).toMatchObject({
      kind: 'fix',
      number: 1,
      fixId: 'fix-1',
      title: 'Fix 1 · Added 5 FAQs',
      line: '/alerts · 3 questions',
      // Before: question 9 cited. Now: question 6 cited.
      beforeNow: '1 of 3 → 1 of 3',
      verdict: 'Partly worked · 1 of 3 questions',
      verdictTone: 'good',
      planned: false
    })
  })

  it('leaves out fixes in another market and marks a future fix as planned', () => {
    const later = fix({ id: 'fix-2', number: 2, goLiveAt: '2026-11-05T12:00:00.000Z' })
    const other = fix({ id: 'fix-3', number: 3, marketIds: ['mkt-uk'] })
    const events = fixEvents([later, other], { marketId: 'mkt-us', now: NOW })
    expect(events.map((event) => event.fixId)).toEqual(['fix-2'])
    expect(events[0]).toMatchObject({ planned: true, verdict: 'Goes live later' })
  })

  it('has no before → now while it waits for its first check after go-live', () => {
    const waiting = fix({
      markets: [
        outcome({ afterRunId: null, afterAt: null, verdict: 'waiting', compared: 0, worked: 0 })
      ]
    })
    const [event] = fixEvents([waiting], { now: NOW })
    expect(event?.beforeNow).toBeUndefined()
    expect(event?.verdictTone).toBe('wait')
  })

  it('uses the Changes status when a fix has no outcome', () => {
    const bare = fix({ markets: [], verdict: null })
    const [event] = fixEvents([bare], { now: NOW, statusOf: () => 'cited' })
    expect(event).toMatchObject({ verdict: 'Cited now', verdictTone: 'good' })
  })
})

describe('fixEvents with a measured fix (Did it work?)', () => {
  function measured(goLiveAt: string, beforeAt: string, nowAt: string): ReturnType<typeof fix> {
    const check = (at: string, cited: boolean): FixQuestionCheck => ({
      runId: `run-${at}`,
      checkedAt: at,
      cited,
      position: cited ? 1 : null
    })
    const question = (id: string, before: boolean, now: boolean): FixQuestion => ({
      promptId: id,
      sourceId: 'topic-1',
      sourceKind: 'topic',
      sourceName: 'Crew alerts',
      marketId: 'mkt-us',
      label: id,
      text: id,
      before: check(beforeAt, before),
      now: check(nowAt, now)
    })
    return fix({
      goLiveAt,
      measure: {
        url: 'https://x.com/alerts',
        questions: [
          question('q1', false, true),
          question('q2', false, true),
          question('q3', true, true)
        ],
        control: null,
        trend: []
      }
    })
  }

  it('says the verdict Changes says, with before → now on the fix searches', () => {
    const [event] = fixEvents(
      [
        measured('2026-09-01T00:00:00.000Z', '2026-08-28T00:00:00.000Z', '2026-09-20T00:00:00.000Z')
      ],
      {
        now: NOW
      }
    )
    expect(event).toMatchObject({
      beforeNow: '1 of 3 → 3 of 3',
      verdict: 'Worked',
      verdictTone: 'good'
    })
  })

  it('names a Google update inside the window as less certain', () => {
    const [event] = fixEvents(
      [
        measured('2026-10-01T00:00:00.000Z', '2026-09-20T00:00:00.000Z', '2026-10-20T00:00:00.000Z')
      ],
      {
        now: NOW
      }
    )
    expect(event?.verdict).toBe('Worked · less certain: September 2026 spam update in this window')
  })

  it('too early under 14 days live', () => {
    const [event] = fixEvents(
      [
        measured('2026-10-25T00:00:00.000Z', '2026-10-20T00:00:00.000Z', '2026-10-28T00:00:00.000Z')
      ],
      {
        now: NOW
      }
    )
    expect(event).toMatchObject({ verdict: 'Too early · 9 days left', verdictTone: 'wait' })
  })
})

describe('project fix lists', () => {
  const list = {
    projectId: 'p',
    markets: [],
    subjects: [
      { id: 'page-1', kind: 'page' as const, label: '/alerts', url: 'https://x.com/alerts' }
    ],
    fixes: [
      { fix: fix(), searchesMin: 1, searchesMax: 2 },
      { fix: fix({ id: 'fix-9', pageId: 'page-2' }), searchesMin: 1, searchesMax: 2 }
    ],
    suggestions: []
  }

  it('keeps the fixes of the subjects a chart covers', () => {
    expect(fixesFor(list, new Set(['page-2'])).map((item) => item.id)).toEqual(['fix-9'])
    expect(fixesFor(list, null)).toHaveLength(2)
    expect(fixesFor(null, null)).toEqual([])
  })

  it('names a page from its subject', () => {
    expect(subjectLabels(list)('page-1')).toBe('/alerts')
    expect(subjectLabels(list)('page-2')).toBeNull()
  })

  it('a topic chart covers the topic and its target page, matched by address', () => {
    const ids = topicSubjectIds(list, 'topic-1', 'https://www.X.com/alerts/')
    expect([...ids].sort()).toEqual(['page-1', 'topic-1'])
    expect([...topicSubjectIds(list, 'topic-1', null)]).toEqual(['topic-1'])
  })
})
