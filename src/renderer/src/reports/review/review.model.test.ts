import { describe, expect, it } from 'vitest'
import { buildReport } from '@shared/report/review'
import { sampleContext, sampleMetrics } from '@shared/report/review/sample.test-helper'
import { drillCsvOf, drillView, questionDetailOf } from './drawerModel'
import {
  checkOptions,
  homeTabOf,
  lensOf,
  reportOf,
  scopeOf,
  scopeValue,
  sectionOf,
  windowOf
} from './urlState'

describe('Reports URL state', () => {
  it('reads the tab, report, section, scope, lens and window', () => {
    expect(homeTabOf({})).toBe('ready')
    expect(homeTabOf({}, false)).toBe('emails')
    expect(homeTabOf({ view: 'history' })).toBe('emails')
    expect(homeTabOf({ report: 'impact' }, false)).toBe('ready')
    expect(reportOf({ report: 'impact' })).toBe('impact')
    expect(reportOf({ report: 'nope' })).toBeNull()
    expect(sectionOf('impact', { section: 'topics' })).toBe('topics')
    expect(sectionOf('visibility', { section: 'verdict' })).toBe('standing')
    expect(scopeOf({ scope: 'topic:t1' })).toEqual({ kind: 'topic', id: 't1' })
    expect(scopeOf({ scope: 'bad' })).toEqual({ kind: 'project' })
    expect(scopeValue({ kind: 'page', id: 'p1' })).toBe('page:p1')
    expect(lensOf({ seg: 'pageType' })).toBe('pageType')
    expect(lensOf({ seg: 'x' })).toBe('topic')
    expect(windowOf('impact', {})).toEqual({ from: 'first', to: null })
    expect(windowOf('changed', { from: 'run-2', to: 'run-9' })).toEqual({
      from: 'run-2',
      to: 'run-9'
    })
    expect(windowOf('visibility', { from: 'run-2' })).toEqual({ from: null, to: null })
  })

  it('offers one check per day, the last of the day', () => {
    const day = (iso: string): string => iso.slice(0, 10)
    expect(
      checkOptions(
        [
          { id: 'a', at: '2026-09-16T15:00:00.000Z' },
          { id: 'b', at: '2026-09-16T15:10:00.000Z' },
          { id: 'c', at: '2026-10-28T15:00:00.000Z' }
        ],
        day
      ).map((option) => option.id)
    ).toEqual(['b', 'c'])
  })
})

describe('Report drawers', () => {
  const metrics = sampleMetrics()
  const report = buildReport(metrics, sampleContext())

  it('lists exactly the drill rows, with its counts and CSV', () => {
    const view = drillView(report, 'gained')
    expect(view?.kind).toBe('questions')
    expect(view?.rows.length).toBe(report.drills.gained?.ids.length)
    expect(view?.stats[0]?.value).toBe(view?.rows.length)
    const csv = view ? drillCsvOf(report, view) : null
    expect(csv?.rows.length).toBe(view?.rows.length)
    expect(drillView(report, 'pages:all')?.rows.length).toBe(3)
    expect(drillView(report, 'no-such')).toBeNull()
  })

  it("opens a question's answers on each engine, at both ends", () => {
    const q8 = Object.values(report.questionsById).find((item) =>
      item.text.startsWith('Question 8:')
    )
    const detail = q8 ? questionDetailOf(report, metrics, q8.id) : null
    expect(detail?.enginesNow.map((answer) => [answer.engine, answer.result])).toEqual([
      ['google_aio', 'not_cited'],
      ['chatgpt', 'other']
    ])
    expect(detail?.history.length).toBe(3)
  })
})
