import { describe, expect, it } from 'vitest'
import type { MetricsResult } from '../../metrics/types'
import { buildReport } from './build'
import { EMPTY_EXTRAS, type ReportExtras } from './extras'
import { sampleContext, sampleMetrics } from './sample.test-helper'
import { answerExtras } from './sources.test-helper'
import type { AnswerExtras } from './sources-types'
import type { Num, ReviewReport } from './types'

/**
 * The Sources and Answer shape tabs (Docs/REPORT-SPEC.md "Ready reports"): citations from
 * every engine, the split adds up, every count of questions opens exactly that many
 * questions, empty source types stay empty, and journeys carry their page outline.
 */

function report(
  metrics: MetricsResult = sampleMetrics(),
  answers: AnswerExtras | 'none' = answerExtras()
): ReviewReport {
  const extras: ReportExtras = answers === 'none' ? EMPTY_EXTRAS : { ...EMPTY_EXTRAS, answers }
  return buildReport(metrics, sampleContext('visibility'), extras)
}

/** Every Num in a value, wherever it sits. */
function nums(value: unknown, out: Num[] = []): Num[] {
  if (Array.isArray(value)) value.forEach((item) => nums(item, out))
  else if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>
    if (typeof record.n === 'number' && typeof record.drill === 'string')
      out.push(record as unknown as Num)
    else Object.values(record).forEach((item) => nums(item, out))
  }
  return out
}

describe('Sources', () => {
  it('is a Visibility report tab, after Deep dives', () => {
    const ids = report().sections.map((section) => section.id)
    expect(ids).toContain('sources')
    expect(ids.indexOf('sources')).toBe(ids.indexOf('deep') + 1)
    expect(ids.indexOf('shape')).toBe(ids.indexOf('sources') + 1)
  })

  it('opens exactly the questions every count says, each once', () => {
    const built = report()
    const all = [...nums(built.sources), ...nums(built.answerShape)]
    expect(all.length).toBeGreaterThan(20)
    for (const num of all) {
      const drill = built.drills[num.drill]
      expect(drill?.ids.length, num.drill).toBe(num.n)
      expect(new Set(drill?.ids).size, num.drill).toBe(num.n)
      for (const id of drill?.ids ?? []) expect(built.questionsById[id], id).toBeDefined()
    }
  })

  it('splits citations into yours, competitors and other sites that add up', () => {
    const { sources } = report()
    expect(sources.total).toBeGreaterThan(0)
    expect(sources.yours + sources.competitor + sources.other).toBe(sources.total)
    expect(sources.types.reduce((sum, type) => sum + type.citations, 0)).toBe(sources.total)
    expect(sources.types.reduce((sum, type) => sum + type.share, 0)).toBeGreaterThanOrEqual(99)
    expect(sources.types.map((type) => type.type)).toEqual(['web', 'youtube', 'reddit', 'linkedin'])
  })

  it('counts every engine under All engines, one engine on its own', () => {
    const all = report(sampleMetrics({ engine: 'all' })).sources
    const google = report(sampleMetrics({ engine: 'google_aio' })).sources
    const chatgpt = report(sampleMetrics({ engine: 'chatgpt' })).sources
    expect(all.total).toBe(google.total + chatgpt.total)
    expect(chatgpt.total).toBeGreaterThan(0)
  })

  it('lists gaps to win: answers that cite others and not you', () => {
    const built = report(sampleMetrics({ engine: 'google_aio' }))
    const gaps = built.drills[built.sources.gaps.drill]?.ids ?? []
    expect(gaps.length).toBeGreaterThan(0)
    for (const id of gaps) expect(built.questionsById[id]?.now).toBe('not_cited')
  })

  it('shows Reddit threads that take replies first, with upvotes, and no " - Reddit"', () => {
    const { reddit } = report().sources
    expect(reddit.threads[0]?.reply).toBe('open')
    expect(reddit.threads[0]?.upvotes).toBe(42)
    expect(reddit.threads[0]?.title).toBe('Email to SMS now?')
    expect(reddit.threads.at(-1)?.reply).toBe('locked')
    expect(reddit.subreddits.map((sub) => sub.name).sort()).toEqual(['r/sysadmin', 'r/voip'])
    expect(reddit.sentence).toBe('1 of 2 cited Reddit threads take replies. Start with those.')
  })

  it('groups YouTube by video id and channel, with views and the posted day', () => {
    const { youtube } = report().sources
    expect(youtube.videos).toHaveLength(1)
    expect(youtube.videos[0]).toMatchObject({
      videoId: 'dQw4w9WgXcQ',
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      title: 'How to text from email',
      channel: 'SMS Academy',
      views: 1200,
      posted: 'May 1'
    })
    expect(youtube.channels[0]?.channel).toBe('SMS Academy')
    expect(youtube.detailsMissing).toBe(false)
  })

  it('lists LinkedIn pages and the most influential outside pages without your own', () => {
    const { linkedin, influential } = report().sources
    expect(linkedin[0]).toMatchObject({ kind: 'article', title: 'Email to SMS guide' })
    expect(influential.length).toBeGreaterThan(0)
    expect(influential.every((page) => page.who !== 'you')).toBe(true)
    expect(influential[0]?.domain).toBe('twilio.com')
  })

  it('is empty, not zeros, without stored citations', () => {
    const { sources } = report(sampleMetrics(), 'none')
    expect(sources.total).toBe(0)
    expect(sources.types).toEqual([])
    expect(sources.youtube.videos).toEqual([])
    expect(sources.reddit.sentence).toMatch(/nothing to reply to/)
  })
})

describe('Answer shape', () => {
  it('names the blocks plainly and counts the answers that hold them', () => {
    const shape = report(sampleMetrics({ engine: 'google_aio' })).answerShape
    expect(shape.analysed.n).toBeGreaterThan(0)
    const definition = shape.blocks.find((block) => block.code === 'A1')
    expect(definition?.name).toBe('Definition')
    expect(definition?.blocks).toBe(definition ? definition.answers.n * 2 : -1)
    expect(shape.waiting.n).toBe(1)
    expect(shape.withText).toBe(shape.analysed.n + shape.waiting.n)
  })

  it('finds recurring journeys with an outline in the drill', () => {
    const built = report(sampleMetrics({ engine: 'google_aio' }))
    const shape = built.answerShape
    const top = shape.mostCommon
    expect(top?.label).toBe('Definition → Step-by-step → Risks and limits')
    expect(top?.opensWith).toBe('Definition')
    expect(top?.outline[0]).toMatch(/^1\. Definition: /)
    expect(built.drills[top?.answers.drill ?? '']?.outline).toEqual(top?.outline)
    expect(shape.legend.flatMap((group) => group.items)).toHaveLength(19)
  })

  it('counts answers whose shape changed between the two checks', () => {
    const shape = report(sampleMetrics({ engine: 'google_aio' })).answerShape
    expect(shape.changed?.n).toBeGreaterThan(0)
    const latest = report(sampleMetrics({ engine: 'google_aio', from: null })).answerShape
    expect(latest.changed).toBeNull()
  })

  it('has nothing to read without stored answer text', () => {
    const shape = report(sampleMetrics(), 'none').answerShape
    expect(shape.withText).toBe(0)
    expect(shape.journeys).toEqual([])
  })
})
