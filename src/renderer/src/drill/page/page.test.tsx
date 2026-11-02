// @vitest-environment happy-dom
import { act, cleanup, render, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DrillFilters, DrillShowing } from './DrillFilters'
import {
  drillHref,
  drillNames,
  drillValue,
  hasDrillFilters,
  readDrillFilters,
  withoutDrillFilter,
  withoutDrillFilters
} from './drillUrl'
import { drillSummary, showingText } from './model'
import { useDrillFilters } from './useDrillFilters'

afterEach(cleanup)
beforeEach(() => {
  window.history.replaceState(null, '', '#/topics/t1?view=tree')
})

describe('drill URLs', () => {
  it('writes filters as f.<name>, keeps other values, and reads them back', () => {
    const href = drillHref('#/topics/t1?view=tree', { stage: 'problem', result: 'not_cited' })
    expect(href).toBe('#/topics/t1?view=tree&f.stage=problem&f.result=not_cited')
    expect(readDrillFilters(href, ['stage', 'result', 'type'])).toEqual({
      stage: 'problem',
      result: 'not_cited',
      type: null
    })
    expect(drillNames(href)).toEqual(['stage', 'result'])
    expect(hasDrillFilters(href)).toBe(true)
    expect(hasDrillFilters('#/topics/t1?view=tree')).toBe(false)
  })

  it('drops one filter for a chip ✕, or all of them for "Back to all"', () => {
    const href = '#/topics/t1?view=tree&f.stage=problem&f.result=not_cited'
    expect(withoutDrillFilter(href, 'stage')).toBe('#/topics/t1?view=tree&f.result=not_cited')
    expect(withoutDrillFilters(href)).toBe('#/topics/t1?view=tree')
    expect(drillHref(href, { result: null })).toBe('#/topics/t1?view=tree&f.stage=problem')
  })

  it('turns free text into an opaque value', () => {
    const value = drillValue('/blog/nagios-setup/')
    expect(value).toMatch(/^v[a-z0-9]+$/)
    expect(value).toBe(drillValue('/blog/nagios-setup/'))
    expect(drillHref('#/pages', { folder: value })).not.toContain('blog')
  })
})

describe('DrillFilters', () => {
  it('draws a chip per filter with a ✕ link, a result chip in its colour, and Back to all', () => {
    const view = render(
      <DrillFilters
        chips={[
          { name: 'stage', label: 'Stage: Problem', removeHref: '#/topics/t1?f.result=not_cited' },
          {
            name: 'result',
            label: 'Not cited',
            result: 'not_cited',
            removeHref: '#/topics/t1?f.stage=problem'
          }
        ]}
        backHref="#/topics/t1"
        total={240}
      />
    )
    const remove = view.getByRole('link', { name: 'Remove Stage: Problem' })
    expect(remove.getAttribute('href')).toBe('#/topics/t1?f.result=not_cited')
    expect(view.getByRole('link', { name: 'Remove Not cited' })).toBeTruthy()
    const result = view.container.querySelector<HTMLElement>('[data-filter="result"]')
    expect(result?.style.background).toContain('--result-not-cited-tint')
    expect(result?.querySelector('.ui-rdot')).not.toBeNull()
    expect(view.getByRole('link', { name: 'Back to all 240' }).getAttribute('href')).toBe(
      '#/topics/t1'
    )
  })

  it('says how many show', () => {
    expect(showingText(14, 14)).toBe('Showing all 14')
    expect(showingText(3, 14)).toBe('Showing 3 of 14')
    expect(drillSummary({ first: 1, last: 14, matching: 14, total: 14, groups: 0 })).toBe(
      'Showing all 14'
    )
    expect(drillSummary({ first: 1, last: 25, matching: 118, total: 118, groups: 0 })).toBe(
      '1–25 of 118'
    )
    const view = render(<DrillShowing count={1200} />)
    expect(view.getByText('Showing all 1,200')).toBeTruthy()
  })
})

describe('useDrillFilters', () => {
  it('follows the URL and builds each link from it', () => {
    const { result } = renderHook(() => useDrillFilters(['stage', 'result'] as const))
    expect(result.current.active).toBe(false)
    expect(result.current.hrefWith({ result: 'target' })).toBe(
      '#/topics/t1?view=tree&f.result=target'
    )
    act(() => result.current.set({ stage: 'problem', result: 'not_cited' }))
    act(() => {
      window.dispatchEvent(new HashChangeEvent('hashchange'))
    })
    expect(result.current.values).toEqual({ stage: 'problem', result: 'not_cited' })
    expect(result.current.active).toBe(true)
    expect(result.current.hrefWithout('stage')).toBe('#/topics/t1?view=tree&f.result=not_cited')
    expect(result.current.allHref).toBe('#/topics/t1?view=tree')
  })
})
