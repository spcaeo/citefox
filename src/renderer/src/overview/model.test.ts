import { describe, expect, it } from 'vitest'
import type { OverviewWeek } from '@shared/ipc'
import {
  addQuestionsHash,
  deltaText,
  firstReportLine,
  kpiTrend,
  needsWork,
  periodFromHash,
  countNoun,
  isNamedOnly,
  positionText,
  questionResult,
  withSummaryGoogle,
  searchesText,
  weeklyTrend,
  withQueryParam,
  youLabel
} from './model'

describe('overview model', () => {
  it('reads and writes the period in the address', () => {
    expect(periodFromHash('#/overview')).toBe('30d')
    expect(periodFromHash('#/overview?period=7d')).toBe('7d')
    expect(periodFromHash('#/overview?period=14d')).toBe('30d')
    expect(withQueryParam('#/p/proj-1/overview?x=1', 'period', '90d')).toBe(
      '#/p/proj-1/overview?x=1&period=90d'
    )
    expect(withQueryParam('#/overview?period=7d', 'period', null)).toBe('#/overview')
    expect(withQueryParam('', 'period', '7d')).toBe('#/?period=7d')
    expect(addQuestionsHash('#/overview?period=7d')).toBe(
      '#/overview?period=7d&drawer=add-questions'
    )
  })

  it('words the deltas, with no chip when there is no history', () => {
    expect(deltaText(2)).toBe('+2')
    expect(deltaText(-1, ' pts')).toBe('−1 pts')
    expect(deltaText(0)).toBe('±0')
    expect(kpiTrend(null)).toBeUndefined()
    expect(kpiTrend(0)).toBeUndefined()
    expect(kpiTrend(-3)).toEqual({ direction: 'down', text: '−3' })
  })

  it('labels the You column in the four result words, the place in its own column', () => {
    expect(youLabel({ you: 'cited' })).toBe('Right page')
    expect(youLabel({ you: 'cited', ownPage: 'other' })).toBe('Your other page')
    expect(youLabel({ you: 'no_aio' })).toBe('No AI Overview')
    // Named is a badge beside "Not cited", never a fifth result.
    expect(youLabel({ you: 'named' })).toBe('Not cited')
    expect(isNamedOnly({ you: 'named' })).toBe(true)
    expect(isNamedOnly({ you: 'cited' })).toBe(false)
    expect(positionText({ you: 'cited', position: 3 })).toBe('#3')
    expect(positionText({ you: 'cited', position: null })).toBe('—')
    expect(positionText({ you: 'not_cited', position: null })).toBe('—')
  })

  it('counts the Google tile by the headline rule', () => {
    const google = {
      engine: 'google_aio' as const,
      label: 'Google AI Overview',
      checked: 9,
      cited: 9,
      named: 0,
      notCited: 0,
      noAnswer: 0,
      unavailable: 0,
      error: 0,
      gained: 1,
      lost: 0,
      lastCheckedAt: null
    }
    const chatgpt = { ...google, engine: 'chatgpt' as const, label: 'ChatGPT' }
    const [g, c] = withSummaryGoogle(
      [google, chatgpt],
      [{ you: 'cited' }, { you: 'named' }, { you: 'not_cited' }, { you: 'no_aio' }]
    )
    expect(g).toMatchObject({ checked: 4, cited: 1, named: 1, notCited: 1, noAnswer: 1, gained: 1 })
    expect(c).toBe(chatgpt)
  })

  it('names the count by what it counts: searches once keywords are tracked', () => {
    expect(countNoun({ kpis: { keywords: 0 } }).many).toBe('questions')
    expect(countNoun({ kpis: { keywords: 3 } }).Many).toBe('Searches')
  })

  it('puts each question in one of the four results; named counts as not cited', () => {
    expect(questionResult({ you: 'cited', ownPage: 'target' })).toBe('target')
    expect(questionResult({ you: 'cited', ownPage: 'other' })).toBe('other_page')
    expect(questionResult({ you: 'named' })).toBe('not_cited')
    expect(questionResult({ you: 'not_cited' })).toBe('not_cited')
    expect(questionResult({ you: 'no_aio' })).toBe('no_overview')
    expect(questionResult({ you: 'error' })).toBeNull()
    expect(needsWork({ not_cited: 96, other_page: 38, target: 72, no_overview: 34 })).toBe(134)
  })

  it('draws cited per week as a line, says the gap once and gives the change', () => {
    const weeks: OverviewWeek[] = [
      { endsAt: '2026-10-02T12:00:00.000Z', cited: null, withAio: null },
      { endsAt: '2026-10-09T12:00:00.000Z', cited: 2, withAio: 10 },
      { endsAt: '2026-10-16T12:00:00.000Z', cited: 5, withAio: 20 },
      { endsAt: '2026-10-23T12:00:00.000Z', cited: 10, withAio: 20 }
    ]
    const trend = weeklyTrend(weeks)
    expect(trend.points.map((point) => point.value)).toEqual([null, 2, 5, 10])
    expect(trend.top).toBe(20)
    expect(trend.latest).toBe(10)
    expect(trend.delta).toEqual({ text: '8 since the first check', direction: 'up' })
    expect(trend.gapNote).toBe('No check before the week to Oct 9')
    expect(trend.described).toContain('Week to Oct 2: not checked yet')
    const once = weeklyTrend(weeks.slice(3))
    expect(once.delta).toBeNull()
    expect(once.gapNote).toBeNull()
  })

  it('words the first check report and the search count', () => {
    expect(
      firstReportLine({
        checkedAt: '2026-10-23T12:00:00.000Z',
        topicId: 't',
        topics: 1,
        questions: 10,
        suggestedPages: 3,
        untrackedSuggested: 3
      })
    ).toBe('From setup on Oct 23: 1 topic, 10 questions checked, 3 pages suggested to track.')
    expect(searchesText({ min: 46, max: 92 })).toBe('about 46–92 searches')
    expect(searchesText({ min: 1, max: 1 })).toBe('about 1 search')
  })
})
