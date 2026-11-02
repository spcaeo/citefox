import { describe, expect, test } from 'vitest'
import {
  textboltTopicDraft,
  textboltTopicMetas,
  textboltTopicResults,
  TEXTBOLT_TOPIC_CHECKS
} from './textbolt-topic'

describe('TextBolt topic fixture', () => {
  test('28 questions across six stages and 118 keywords in 22 groups', () => {
    const metas = textboltTopicMetas()
    const questions = metas.filter((meta) => meta.kind === 'question')
    const keywords = metas.filter((meta) => meta.kind === 'keyword')
    expect(questions).toHaveLength(28)
    expect(new Set(questions.map((meta) => meta.stage)).size).toBe(6)
    expect(keywords).toHaveLength(118)
    expect(new Set(keywords.map((meta) => meta.kwGroup)).size).toBe(22)
    expect(textboltTopicDraft().prompts).toHaveLength(146)
  })

  test('results agree with themselves on every count', () => {
    const results = textboltTopicResults()
    const q = results.goals.questions
    expect(q.prompts).toBe(28)
    expect(q.withAio + q.noAio + q.failed + q.notChecked).toBe(28)
    expect(q.cited).toBe(q.rightPage + q.otherPage)
    for (const group of results.todo) expect(group.promptIds).toHaveLength(group.count)
    const states = new Set(results.rows.map((row) => row.state))
    for (const state of ['right_page', 'other_page', 'not_cited', 'no_page', 'no_aio']) {
      expect(states.has(state as never)).toBe(true)
    }
    expect(results.progress.map((point) => point.finishedAt)).toEqual(
      TEXTBOLT_TOPIC_CHECKS.map((check) => check.finishedAt)
    )
    const universe = results.keywords
    expect(universe.keywords).toBe(118)
    expect(universe.byGroup.reduce((sum, row) => sum + row.keywords, 0)).toBe(118)
    expect(universe.byIntent.reduce((sum, row) => sum + row.aioShown, 0)).toBe(universe.aioShown)
    for (const stage of results.byStage) {
      expect(stage.citedIds).toHaveLength(stage.cited)
      expect(stage.cited + stage.notCited + stage.noAio + stage.failed).toBe(stage.prompts)
    }
  })

  test('the numbers match the mock-up shape', () => {
    const results = textboltTopicResults()
    // Snapshot of the headline numbers so a fixture edit is deliberate.
    expect({
      q: [results.goals.questions.cited, results.goals.questions.withAio],
      k: [
        results.goals.keywords.cited,
        results.goals.keywords.withAio,
        results.goals.keywords.named
      ],
      reach: results.goals.questions.toReachBand
    }).toMatchInlineSnapshot(`
      {
        "k": [
          18,
          77,
          26,
        ],
        "q": [
          11,
          26,
        ],
        "reach": 2,
      }
    `)
  })
})
