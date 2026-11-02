import { describe, expect, it } from 'vitest'
import { NO_STAGE, NO_TARGET, NOT_IN_TOPIC } from '../topics/clusters'
import {
  destinationKey,
  dropDestination,
  groupCount,
  groupOf,
  groupOrder,
  parseDestination,
  topicChoices
} from './grouping'
import {
  PRICING,
  TOPIC,
  questionRow,
  questionsList,
  topicSummary
} from './questions.fixtures.test-helper'

const SOURCES = new Map([
  [PRICING.id, PRICING],
  [TOPIC.id, TOPIC]
])

const staged = questionRow({
  promptId: 'p-s',
  sourceId: 'topic-1',
  text: 'compare texting apps',
  stage: 'compare',
  targetUrl: 'https://textbolt.com/compare/?ref=x',
  targetPageId: 'page-9'
})

describe('group keys', () => {
  const list = questionsList()

  it('puts topic questions in their topic and page questions in "Not in a topic"', () => {
    expect(groupOf(list.rows[0]!, 'topic', SOURCES)).toEqual({
      key: 'topic-1',
      label: 'Business texting'
    })
    expect(groupOf(list.rows[1]!, 'topic', SOURCES)).toEqual({
      key: NOT_IN_TOPIC,
      label: 'Not in a topic'
    })
    expect(groupOrder('topic', list, list.rows)).toEqual(['topic-1', NOT_IN_TOPIC])
  })

  it('groups by stage in journey order, then "No stage"', () => {
    expect(groupOf(staged, 'stage', SOURCES)).toEqual({ key: 'compare', label: 'Compare' })
    expect(groupOf(list.rows[0]!, 'stage', SOURCES)).toEqual({
      key: NO_STAGE,
      label: 'No stage'
    })
    expect(groupOrder('stage', list, list.rows)).toEqual([
      'problem',
      'options',
      'doubts',
      'fit',
      'compare',
      'decide',
      NO_STAGE
    ])
  })

  it('groups by the target path, then "No page yet" last', () => {
    expect(groupOf(staged, 'target', SOURCES)).toEqual({
      key: 'path:/compare/?ref=x',
      label: '/compare/?ref=x'
    })
    expect(groupOf(list.rows[0]!, 'target', SOURCES)).toEqual({
      key: NO_TARGET,
      label: 'No page yet'
    })
    expect(groupOrder('target', list, [staged, ...list.rows])).toEqual([
      'path:/compare/?ref=x',
      NO_TARGET
    ])
  })

  it('has no groups in the flat list and counts the rest', () => {
    expect(groupOf(staged, 'none', SOURCES)).toBeNull()
    expect(groupCount(list.rows, 'none', SOURCES)).toBe(0)
    expect(groupCount(list.rows, 'topic', SOURCES)).toBe(2)
    expect(groupCount([staged, ...list.rows], 'stage', SOURCES)).toBe(2)
  })
})

describe('moves', () => {
  it('takes drops on topic groups and "Not in a topic", in Topic grouping only', () => {
    expect(dropDestination('topic', 'topic-1')).toEqual({ kind: 'topic', topicId: 'topic-1' })
    expect(dropDestination('topic', NOT_IN_TOPIC)).toEqual({ kind: 'page' })
    expect(dropDestination('stage', 'compare')).toBeNull()
  })

  it('round-trips destination keys and rejects junk', () => {
    for (const to of [
      { kind: 'topic', topicId: 'topic-1' },
      { kind: 'new', name: 'SMS pricing' },
      { kind: 'page' }
    ] as const) {
      expect(parseDestination(destinationKey(to))).toEqual(to)
    }
    expect(parseDestination('topic:')).toBeNull()
    expect(parseDestination('new:  ')).toBeNull()
    expect(parseDestination('folder:x')).toBeNull()
  })

  it('lists topics in the list first, then empty tracked topics, never removed ones', () => {
    const list = questionsList()
    expect(
      topicChoices(list, [
        topicSummary({ id: 'topic-1', name: 'Business texting' }),
        topicSummary({ id: 'topic-2', name: 'Text alerts' }),
        topicSummary({ id: 'topic-3', name: 'Gone', status: 'removed' })
      ])
    ).toEqual([
      { id: 'topic-1', name: 'Business texting', count: 1 },
      { id: 'topic-2', name: 'Text alerts', count: 0 }
    ])
  })
})
