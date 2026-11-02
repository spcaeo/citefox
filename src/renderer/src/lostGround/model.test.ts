import { describe, expect, it } from 'vitest'
import type { AssistResult } from '@shared/ipc'
import { lostView } from '../fixes/fixtures'
import { row } from '../progress/fixtures'
import {
  bucketRows,
  citedBefore,
  currentPlan,
  lostRows,
  lostSinceLast,
  planFromAssist,
  planKey,
  stageRows
} from './model'

describe('Lost ground model', () => {
  it('sorts the questions that cited the page into buckets, as they stand now', () => {
    const view = lostView()
    expect(citedBefore(view)).toHaveLength(5)
    expect(bucketRows(view, 'still_cited').map((item) => item.status)).toEqual(['page_cited'])
    expect(bucketRows(view, 'moved_tracked').map((item) => item.citedUrl)).toEqual([
      'https://textbolt.com/pricing/',
      'https://textbolt.com/pricing/'
    ])
    expect(bucketRows(view, 'moved_own')).toHaveLength(1)
    expect(bucketRows(view, 'not_cited')).toHaveLength(1)
    expect(lostRows(view)).toHaveLength(4)
  })

  it('groups lost questions by stage with the cited-before count of that stage', () => {
    const rows = stageRows(lostView())
    expect(rows.map((item) => [item.label, item.lost.length, item.before.length])).toEqual([
      ['Comparison', 1, 1],
      ['Objection', 1, 1],
      ['Solution', 1, 1],
      ['Trigger', 1, 1]
    ])
  })

  it('shows a cached plan only for the two checks it compares', () => {
    const plan = {
      text: '1. Bring back the sections',
      savedAt: '',
      edited: false,
      inputKey: 'run-alerts-1|run-alerts-2'
    }
    expect(planKey(lostView())).toBe('run-alerts-1|run-alerts-2')
    expect(currentPlan(lostView({ plan }))).toEqual(plan)
    expect(
      currentPlan(lostView({ plan: { ...plan, inputKey: 'run-alerts-0|run-alerts-2' } }))
    ).toBeNull()
  })

  it('turns an assist answer into plan Markdown from the picked items', () => {
    const result = {
      summary: 'Two sections went.',
      items: [
        {
          id: 'a',
          text: 'Restore the comparison section',
          detail: null,
          tag: null,
          verify: null,
          sign: null
        },
        {
          id: 'b',
          text: 'Link to pricing',
          detail: 'From the FAQ.',
          tag: null,
          verify: null,
          sign: null
        }
      ]
    } as unknown as AssistResult
    expect(planFromAssist(result, [])).toBe(
      'Two sections went.\n\n1. Restore the comparison section\n2. Link to pricing From the FAQ.'
    )
    expect(planFromAssist(result, ['b'])).toBe(
      'Two sections went.\n\n1. Link to pricing From the FAQ.'
    )
  })

  it('the Results callout uses the shared lost-ground rule on previous statuses', () => {
    const was = { previousStatus: 'page_cited' as const }
    const rows = [
      row(1, 'page_cited', was),
      row(2, 'not_cited', was),
      row(3, 'other_own_page', was),
      row(4, 'not_cited', was),
      row(5, 'page_cited')
    ]
    expect(lostSinceLast(rows)).toEqual({ citedBefore: 4, lost: 3, lostGround: true })
    expect(lostSinceLast(rows.slice(0, 3)).lostGround).toBe(false)
  })
})
