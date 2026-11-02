import { describe, expect, it } from 'vitest'
import { computeMetrics } from '@shared/metrics'
import { C1, C2, input, pageRows, row } from '@shared/metrics/fixtures.test-helper'
import type { ChangeLedger } from '@shared/ipc'
import type { FixMeasure } from '@shared/fix-verdict'
import { fixGroupDrills } from './fixGroups'
import { metricRowsDrill, promptIdOf, rowsOf, rowTarget, widgetScope } from './metricDrills'
import { aroundDay, trendSteps } from './trendModel'
import { overview } from '../overviewScreen.test-helper'

const result = computeMetrics(input(pageRows(), { engine: 'google_aio' }))
const scope = widgetScope(overview(), 'all markets')

describe('widget drills over the shared metrics', () => {
  it('opens exactly the rows a count names', () => {
    for (const count of [result.now.cited, result.now.answered, result.now.notCited]) {
      const drill = metricRowsDrill(
        rowsOf(result, count.ids),
        { id: 'x', title: 'X', description: 'X' },
        scope
      )
      expect(drill.items.length).toBe(count.n)
      expect(drill.items.map((item) => item.id)).toEqual(count.ids)
    }
    // Gained and lost too.
    const gained = result.comparison!.movement.gained
    expect(rowsOf(result, gained.ids).map((item) => item.questionId)).toEqual(['q1'])
  })

  it('opens a page question on its page, a topic question on its topic', () => {
    const page = row('q1', C1, 'target', { id: 'chatgpt:run-1:prompt-7', sourceId: 'page-1' })
    expect(promptIdOf(page)).toBe('prompt-7')
    expect(rowTarget(page)).toEqual({
      kind: 'prompt',
      pageId: 'page-1',
      promptId: 'prompt-7',
      marketId: 'us'
    })
    expect(rowTarget({ ...page, sourceKind: 'topic', sourceId: 'topic-1' })).toEqual({
      kind: 'topic',
      topicId: 'topic-1',
      marketId: 'us'
    })
  })

  it('counts each check of a trend from the history, each point with its own rows', () => {
    const steps = trendSteps(result)
    expect(steps.map((step) => step.at)).toEqual([C1, C2])
    // History follows the questions checked now (q8 left), so C1: q2 other, q3 target.
    expect(steps[0]!.cited.map((item) => item.questionId).sort()).toEqual(['q2', 'q3'])
    // C2: q1 gained, q2 kept, q7 new.
    expect(steps[1]!.cited.map((item) => item.questionId).sort()).toEqual(['q1', 'q2', 'q7'])
    for (const step of steps) {
      const drill = metricRowsDrill(
        step.cited,
        { id: step.key, title: 'T', description: 'T' },
        scope
      )
      expect(drill.items.length).toBe(step.cited.length)
    }
  })

  it('reads a Google update against the checks before and after it', () => {
    const steps = trendSteps(result)
    const around = aroundDay(steps, '2026-10-05', '2026-10-10')
    expect(around.before?.at).toBe(C1)
    expect(around.after?.at).toBe(C2)
    expect(aroundDay(steps, '2026-09-01', '2026-09-10').before).toBeNull()
    // Still rolling out: compared with the latest check.
    expect(aroundDay(steps, '2026-10-05', null).after?.at).toBe(C2)
  })

  it('splits fixes by verdict, and each group opens exactly its fixes', () => {
    const measure = (before: boolean, now: boolean): FixMeasure => ({
      url: 'https://textbolt.com/a',
      control: null,
      trend: [],
      questions: [
        {
          promptId: 'p1',
          sourceId: 'page-1',
          sourceKind: 'page' as const,
          sourceName: 'A',
          marketId: 'us',
          label: 'Q1',
          text: 'q',
          before: {
            runId: 'r1',
            checkedAt: '2026-09-01T10:00:00.000Z',
            cited: before,
            position: null
          },
          now: { runId: 'r2', checkedAt: '2026-10-30T10:00:00.000Z', cited: now, position: null }
        }
      ]
    })
    const fix = (
      id: string,
      liveSince: string,
      before: boolean,
      now: boolean
    ): ChangeLedger['rows'][number] =>
      ({
        fixId: id,
        number: Number(id.slice(1)),
        url: `https://textbolt.com/${id}`,
        title: null,
        liveSince,
        measure: measure(before, now)
      }) as unknown as ChangeLedger['rows'][number]
    const ledger = {
      builtAt: '2026-10-31T10:00:00.000Z',
      domain: 'textbolt.com',
      brand: 'TextBolt',
      rows: [
        fix('f1', '2026-09-10T10:00:00.000Z', false, true),
        fix('f2', '2026-10-29T10:00:00.000Z', false, false),
        fix('f3', '2026-09-10T10:00:00.000Z', true, true)
      ]
    } as unknown as ChangeLedger
    const groups = fixGroupDrills(ledger)
    expect(groups.worked.items.map((item) => item.id)).toEqual(['f1'])
    expect(groups.early.items.map((item) => item.id)).toEqual(['f2'])
    expect(groups.none.items.map((item) => item.id)).toEqual(['f3'])
    expect(groups.worked.items[0]?.target).toEqual({
      kind: 'drawer',
      id: 'fix',
      values: { fix: 'f1' }
    })
  })
})
