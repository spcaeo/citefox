import { describe, expect, test } from 'vitest'
import { DEFAULT_TOPIC_BANDS } from './domain'
import type { TopicMeta } from './ipc/topics'
import { assembleTopicResults, type TopicPromptMeta, type TopicRunOutcomes } from './topic-results'
import type { TopicOutcome } from './topic-scoring'

function meta(n: number): TopicPromptMeta {
  return {
    promptId: `p${n}`,
    stableKey: `k${n}`,
    number: n,
    kind: 'question',
    text: `Question ${n}`,
    stage: null,
    kwGroup: null,
    kwGroupKind: null,
    intent: null,
    funnel: null,
    pageType: null,
    targetPageId: null,
    targetUrl: null,
    targetNormalizedUrl: null,
    matchConfidence: null,
    matchReason: null,
    targetConfirmed: false
  }
}

function outcome(runId: string, cited: boolean): TopicOutcome {
  return {
    status: cited ? 'other_own_page' : 'not_cited',
    references: cited
      ? [
          {
            url: 'https://example.com/a',
            normalizedUrl: 'example.com/a',
            domain: 'example.com',
            position: 1,
            classification: 'own'
          }
        ]
      : [],
    named: false,
    runId,
    checkedAt: '2026-10-29T08:00:00.000Z',
    aioSummary: null
  }
}

function run(
  runId: string,
  finishedAt: string,
  cited: readonly boolean[],
  state?: TopicRunOutcomes['state']
): TopicRunOutcomes {
  return {
    runId,
    finishedAt,
    partial: state !== undefined && state !== 'finished',
    ...(state ? { state } : {}),
    outcomes: new Map(cited.map((value, index) => [`k${index + 1}`, outcome(runId, value)]))
  }
}

function assemble(runs: readonly TopicRunOutcomes[]): ReturnType<typeof assembleTopicResults> {
  return assembleTopicResults({
    topic: {} as TopicMeta,
    bands: DEFAULT_TOPIC_BANDS,
    metas: [meta(1), meta(2), meta(3)],
    runs,
    pinnedRunId: null,
    savedSummary: null,
    builtAt: '2026-10-29T09:00:00.000Z'
  })
}

/**
 * Comparisons wait for a running check to end: a half-done check is neither a
 * Progress point nor a side of "since last check", so a question still waiting
 * never reads as lost. Its answers so far still count for the current numbers.
 */
describe('a running check in topic results', () => {
  const first = run('a', '2026-10-01T00:00:00.000Z', [true, false, false])
  const second = run('b', '2026-10-15T00:00:00.000Z', [true, true, false])

  test('counts its answers now and leaves Progress and the trend to the end', () => {
    const running = run('c', '2026-10-29T08:00:00.000Z', [false], 'running')
    const results = assemble([first, second, running])
    expect(results.rows.map((row) => row.runId)).toEqual(['c', 'b', 'b'])
    expect(results.goals.questions.cited).toBe(1)
    expect(results.progress.map((point) => point.runId)).toEqual(['a', 'b'])
    expect(results.questionsTrend).toEqual({ change: null, sinceAt: null })
    expect(results.summaryInputs.gained).toEqual([])
    expect(results.summaryInputs.lost).toEqual([])
  })

  test('the same checks without one running compare the last two whole checks', () => {
    const results = assemble([first, second])
    expect(results.questionsTrend.change).toBe(1)
    expect(results.summaryInputs.gained).toEqual(['p2'])
  })

  test('a stopped check stays a partial point and never the previous check', () => {
    const stopped = run('c', '2026-10-29T08:00:00.000Z', [false], 'stopped')
    const results = assemble([first, second, stopped])
    expect(results.progress.map((point) => [point.runId, point.partial])).toEqual([
      ['a', false],
      ['b', false],
      ['c', true]
    ])
    expect(results.questionsTrend.change).toBe(1)
  })
})
