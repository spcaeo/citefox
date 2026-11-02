import { describe, expect, it } from 'vitest'
import { formatMoment } from '../../utils/dates'
import {
  changeText,
  checkedText,
  DEFAULT_TOPICS_VIEW,
  parseTopicsView,
  splitPreview,
  topicLines,
  topicsViewQuery
} from './model'
import { topicsList, topicsSummaries } from './topics.fixtures.test-helper'

const list = topicsList()

describe('topicLines', () => {
  const lines = topicLines(topicsSummaries(), list)

  it('lists tracked topics only, with origin and cadence', () => {
    expect(lines.map((line) => line.id)).toEqual(['topic-a', 'topic-b'])
    expect(lines[0]?.origin).toBe('From a buyer problem · every 14 days')
    expect(lines[1]?.origin).toBe('From my own questions · every 30 days')
  })

  it('scores buyer questions only: cited ÷ with an overview, against the band', () => {
    const a = lines[0]
    expect(a?.questionRows).toHaveLength(4)
    expect(a?.rows).toHaveLength(5)
    expect(a?.stats).toMatchObject({ questions: 4, withAio: 3, cited: 2, rate: 67, band: 'in' })
    expect(lines[1]?.stats).toMatchObject({ withAio: 1, cited: 0, rate: 0, band: 'below' })
  })

  it('lists target pages, most questions first, and the last check', () => {
    expect(lines[0]?.targets.map((target) => [target.path, target.questions])).toEqual([
      ['/email-to-text/', 2],
      ['/pricing/', 1]
    ])
    expect(lines[0]?.checkedAt).toBe('2026-10-23T09:00:00.000Z')
    expect(lines[0]?.stages).toBe(3)
    expect(lines[1]?.stages).toBe(1)
  })
})

describe('splitPreview', () => {
  it('keeps the biggest stage and makes one topic per other stage', () => {
    const [a] = topicLines(topicsSummaries(), list)
    if (a === undefined) throw new Error('no line')
    const split = splitPreview(a)
    expect(split.keep).toBe('problem')
    expect(split.topics.map((topic) => [topic.name, topic.questions])).toEqual([
      ['Replacing a carrier email-to-text gateway · Options', 1],
      ['Replacing a carrier email-to-text gateway · Compare', 1]
    ])
    expect(split.kept).toBe(3)
  })
})

describe('the Topics URL', () => {
  it('reads and writes the view, keeping keys it does not own', () => {
    expect(parseTopicsView('')).toEqual(DEFAULT_TOPICS_VIEW)
    const view = parseTopicsView('results=stage&action=rename&topic=topic-a&row=topic-a&suggest=1')
    expect(view).toEqual({
      results: 'stage',
      action: 'rename',
      topic: 'topic-a',
      row: 'topic-a',
      suggest: true,
      create: false
    })
    expect(topicsViewQuery(view, 'dialog=new-topic')).toBe(
      'dialog=new-topic&results=stage&action=rename&topic=topic-a&row=topic-a&suggest=1'
    )
    expect(topicsViewQuery(DEFAULT_TOPICS_VIEW, 'results=target&dialog=x')).toBe('dialog=x')
  })

  it('drops an action without its topic, and unknown values', () => {
    expect(parseTopicsView('action=merge').action).toBeNull()
    expect(parseTopicsView('topic=topic-a').topic).toBeNull()
    expect(parseTopicsView('results=bogus&action=explode&topic=x')).toMatchObject({
      results: 'topic',
      action: null,
      topic: null
    })
  })
})

describe('text helpers', () => {
  it('formats change and dates', () => {
    expect(changeText(8)).toBe('+8 pts')
    expect(changeText(-3)).toBe('−3 pts')
    expect(changeText(0)).toBe('0 pts')
    expect(changeText(null)).toBe('—')
    expect(checkedText('2026-10-23T09:00:00.000Z')).toBe(formatMoment('2026-10-23T09:00:00.000Z'))
    expect(checkedText(null)).toBe('Not checked yet')
  })
})
