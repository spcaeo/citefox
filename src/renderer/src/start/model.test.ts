import { describe, expect, test } from 'vitest'
import type { TopicResultRow } from '@shared/domain'
import type { StartStepItem } from '@shared/ipc'
import { parseHash } from '../shell/routes'
import { setupSubtitle, soFar, stepCounts, stepLine, targetsFromHash, targetsHash } from './model'
import { isPlainLanding } from './useStartRedirect'

function item(id: StartStepItem['id'], state: StartStepItem['state'], subs = 0): StartStepItem {
  return {
    id,
    label: id,
    state,
    detail: null,
    durationMs: null,
    estimateSeconds: 1,
    subItems: Array.from({ length: subs }, (_, index) => ({
      label: `/p${index}`,
      state: index === 0 ? 'retried' : 'skipped',
      detail: ''
    })),
    progress: null
  }
}

describe('setup step line', () => {
  test('counts the running step, done steps, retries and skips', () => {
    const counts = stepCounts([
      item('home', 'ok'),
      item('sitemap', 'ok'),
      item('sections', 'ok'),
      item('key_pages', 'ok', 2),
      item('pick', 'running'),
      item('rivals', 'pending')
    ])
    expect(stepLine(counts)).toBe('Step 5 of 6 · 4 done · 1 retried · 1 skipped')
  })

  test('the subtitle follows the running step', () => {
    expect(setupSubtitle(null)).toMatch(/Reading your site/u)
  })
})

describe('plan targets in the URL', () => {
  test('round-trips ticked rows and ignores junk', () => {
    expect(targetsHash([2, 0])).toBe('#/start/plan?t=0.2')
    expect(targetsFromHash('#/start/plan?t=0.2.9.x', 5)).toEqual([0, 2])
    expect(targetsFromHash('#/start/plan?t=', 5)).toEqual([])
    expect(targetsFromHash('#/start/plan', 5)).toBeNull()
  })
})

describe('first check so far', () => {
  const row = (
    state: TopicResultRow['state'],
    cited: string | null,
    instead: string[]
  ): TopicResultRow =>
    ({
      kind: 'question',
      state,
      citedOwnUrl: cited,
      citedInstead: instead
    }) as unknown as TopicResultRow
  test('overviews shown, cited, and who is cited instead', () => {
    const counts = soFar([
      row('right_page', 'https://x.com/a', ['b.com']),
      row('not_cited', null, ['b.com', 'c.com']),
      row('no_aio', null, []),
      row('not_checked', null, [])
    ])
    expect(counts).toMatchObject({ checked: 3, total: 4, shown: 2, cited: 1 })
    expect(counts.domains[0]).toMatchObject({ own: true, count: 1 })
    expect(counts.domains[1]).toMatchObject({ domain: 'b.com', count: 2 })
  })
})

describe('empty project landing', () => {
  test('only the plain landing is redirected', () => {
    expect(isPlainLanding(parseHash('#/pages'))).toBe(true)
    expect(isPlainLanding(parseHash('#/'))).toBe(true)
    expect(isPlainLanding(parseHash('#/overview'))).toBe(true)
    expect(isPlainLanding(parseHash('#/overview?period=7d'))).toBe(false)
    expect(isPlainLanding(parseHash('#/questions'))).toBe(false)
    expect(isPlainLanding(parseHash('#/pages?view=tracked'))).toBe(false)
    expect(isPlainLanding(parseHash('#/structure'))).toBe(false)
  })
})
