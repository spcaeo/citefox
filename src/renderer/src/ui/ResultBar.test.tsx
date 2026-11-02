// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ResultBar, ResultDot } from './ResultBar'
import {
  addResults,
  bucketOfCheck,
  bucketOfResult,
  countResults,
  isResultBucket,
  RESULT_BUCKETS,
  resultBarText,
  totalResults,
  whatToDo,
  type ResultCounts
} from './resultTones'

afterEach(cleanup)

const TOPIC: ResultCounts = { not_cited: 96, other_page: 38, target: 72, no_overview: 34 }

describe('the four results', () => {
  it('has one order, word, colour and "What to do" line each', () => {
    expect(RESULT_BUCKETS.map((bucket) => [bucket.key, bucket.label])).toEqual([
      ['not_cited', 'Not cited'],
      ['other_page', 'Your other page'],
      ['target', 'Right page'],
      ['no_overview', 'No AI Overview']
    ])
    expect(RESULT_BUCKETS[0]?.colour).toBe('var(--result-not-cited)')
    expect(whatToDo('not_cited')).toBe('Improve the target page, highest win odds first.')
    expect(whatToDo('other_page')).toMatch(/Keep that page as the owner/)
    expect(whatToDo('target')).toBe('Done.')
    expect(whatToDo('no_overview')).toBe('Nothing to do.')
    expect(whatToDo('no_overview', { nextCheckAt: '2026-10-30T10:27:00.000Z' })).toMatch(
      /^Nothing to do; checked again Oct 30, \d{1,2}:27/
    )
    for (const bucket of RESULT_BUCKETS) expect(bucket.label).not.toMatch(/to do/i)
  })

  it('maps check results onto the four, leaving failed checks out', () => {
    expect(bucketOfResult('cited')).toBe('target')
    expect(bucketOfResult('named')).toBe('not_cited')
    expect(bucketOfResult('failed')).toBeNull()
    expect(bucketOfCheck('other_own_page')).toBe('other_page')
    expect(bucketOfCheck('no_aio')).toBe('no_overview')
    expect(isResultBucket('target')).toBe(true)
    expect(isResultBucket('cited')).toBe(false)
    expect(isResultBucket(null)).toBe(false)
  })

  it('counts, adds and totals', () => {
    const counts = countResults(
      ['page_cited', 'not_cited', 'error', 'no_aio'] as const,
      bucketOfCheck
    )
    expect(counts).toEqual({ not_cited: 1, other_page: 0, target: 1, no_overview: 1 })
    expect(addResults(counts, counts).target).toBe(2)
    expect(totalResults(TOPIC)).toBe(240)
  })
})

describe('ResultBar', () => {
  it('draws a 120px row bar with each part as its share, in the shared order', () => {
    const view = render(<ResultBar counts={TOPIC} label="Problem searches" />)
    const bar = view.getByRole('img')
    expect(bar.getAttribute('aria-label')).toBe(
      'Problem searches: 96 not cited, 38 your other page, 72 right page cited, 34 no AI Overview'
    )
    const parts = [...bar.querySelectorAll<HTMLElement>('.ui-rbar-part')]
    expect(parts.map((part) => part.dataset.result)).toEqual([
      'not_cited',
      'other_page',
      'target',
      'no_overview'
    ])
    expect(parts[0]?.style.width).toBe('40%')
    expect(parts[0]?.style.background).toContain('--result-not-cited')
    expect(view.container.querySelector('.ui-rbar-legend')).toBeNull()
  })

  it('leaves out empty parts and draws an empty track for no searches', () => {
    const one = render(<ResultBar counts={{ ...TOPIC, other_page: 0, target: 0 }} />)
    expect(one.container.querySelectorAll('.ui-rbar-part')).toHaveLength(2)
    cleanup()
    const none = render(
      <ResultBar counts={{ not_cited: 0, other_page: 0, target: 0, no_overview: 0 }} />
    )
    expect(none.container.querySelectorAll('.ui-rbar-part')).toHaveLength(0)
  })

  it('adds a legend in the header, with counts that drill', () => {
    const view = render(
      <ResultBar
        counts={{ ...TOPIC, other_page: 0 }}
        size="header"
        hrefFor={(bucket) => `#/topics/t1?result=${bucket}`}
      />
    )
    expect(view.container.querySelector('.ui-rbar-header')).not.toBeNull()
    const links = view.getAllByRole('link')
    expect(links.map((link) => link.textContent)).toEqual([
      '96 not cited',
      '72 right page cited',
      '34 no AI Overview'
    ])
    expect(links[0]?.getAttribute('href')).toBe('#/topics/t1?result=not_cited')
    // A zero count is text, not a link to an empty list.
    expect(view.getByText('your other page', { exact: false }).closest('a')).toBeNull()
  })

  it('writes the counts as text and draws a dot in a result colour', () => {
    expect(resultBarText(TOPIC)).toMatch(/^96 not cited, 38 your other page/)
    const view = render(<ResultDot result="other_page" />)
    const dot = view.container.querySelector<HTMLElement>('.ui-rdot')
    expect(dot?.style.background).toContain('--result-other')
    expect(dot?.getAttribute('aria-hidden')).toBe('true')
  })
})
