// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TrackingChange } from '@shared/ipc'
import type { ChartEvent } from './markers'
import { dayStartIso } from './scale'
import { TrackingChangesContext } from './tracking'
import { TrendChart, type TrendSeries } from './TrendChart'

afterEach(() => {
  cleanup()
  window.history.replaceState(null, '', '#/')
})

const series: TrendSeries = {
  id: 'rate',
  label: 'Page cited',
  color: 'var(--chart-cited)',
  points: [
    { key: 'r1', at: '2026-09-01T10:00:00.000Z', value: 0.25 },
    { key: 'r2', at: '2026-09-15T10:00:00.000Z', value: 0.3, hollow: true },
    { key: 'r3', at: '2026-10-01T10:00:00.000Z', value: null },
    { key: 'r4', at: '2026-10-20T10:00:00.000Z', value: 0.58 }
  ]
}

const fix: ChartEvent = {
  id: 'fix:f1',
  kind: 'fix',
  at: dayStartIso('2026-09-10'),
  title: 'Fix 1 · Rewrote the intro',
  line: '8 questions',
  number: 1,
  fixId: 'f1',
  beforeNow: '1 of 8 → 5 of 8',
  verdict: 'Worked',
  verdictTone: 'good'
}

function draw(props: Partial<Parameters<typeof TrendChart>[0]> = {}): ReturnType<typeof render> {
  return render(
    <TrendChart
      label="Right page cited over time"
      series={[series]}
      yTicks={[0, 0.25, 0.5, 0.75]}
      yFormat={(value) => `${Math.round(value * 100)}%`}
      events={[fix]}
      {...props}
    />
  )
}

describe('TrendChart', () => {
  it('names the chart and breaks the line at a check with no data', () => {
    const view = draw()
    const svg = view.getByRole('img', { name: 'Right page cited over time' })
    // Two runs (r1, then r4) each with one point: no line between them, and the hollow
    // partial check is drawn as a hollow dot, out of the line.
    expect(svg.querySelectorAll('path.ui-chart-line')).toHaveLength(0)
    expect(svg.querySelector('[data-point="r2"]')?.hasAttribute('data-hollow')).toBe(true)
    // The bright end point sits on the latest check with a value.
    expect(svg.querySelector('[data-point="r4"] .ui-chart-halo')).not.toBeNull()
  })

  it('draws a smooth line with a light fill when checks join up', () => {
    const view = draw({
      series: [
        {
          ...series,
          points: series.points.map((p) => ({ ...p, value: p.value ?? 0.4, hollow: false }))
        }
      ]
    })
    const svg = view.getByRole('img')
    expect(svg.querySelectorAll('path.ui-chart-line')).toHaveLength(1)
    expect(svg.querySelector('path[fill^="url(#trend-fill-"]')).not.toBeNull()
  })

  it('shows a fix marker with its number and a card with before → now and the verdict', () => {
    const view = draw()
    const marker = view.getByRole('button', { name: /Your fix: Fix 1 · Rewrote the intro/ })
    expect(marker.textContent).toBe('1')
    fireEvent.focus(marker)
    const card = view.container.querySelector('.ui-chart-card')
    expect(card?.textContent).toContain('Your fix')
    expect(card?.textContent).toContain('1 of 8 → 5 of 8')
    expect(card?.textContent).toContain('Worked')
  })

  it('a click on a lone fix opens it', () => {
    const onOpen = vi.fn()
    const view = draw({ onOpenEvent: onOpen })
    fireEvent.click(view.getByRole('button', { name: /Your fix: Fix 1/ }))
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ fixId: 'f1' }))
  })

  it('stacks a fix and a Google update on one day; the pinned card opens the fix', () => {
    const onOpen = vi.fn()
    const google: ChartEvent = {
      ...fix,
      id: 'g',
      kind: 'google',
      title: 'Core update',
      number: undefined,
      fixId: undefined
    }
    const view = draw({ events: [fix, google], onOpenEvent: onOpen })
    const stack = view.getByRole('button', { name: /2 events/ })
    expect(stack.textContent).toBe('2')
    fireEvent.click(stack)
    const dialog = view.getByRole('dialog', { name: 'Markers on this day' })
    expect(onOpen).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Open fix 1' }))
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ fixId: 'f1' }))
  })

  it('adds the Google updates in range and lets each kind be hidden from the URL', () => {
    const view = draw()
    // The September 2026 spam update started inside this chart's range.
    const google = view.getByRole('button', { name: /Google: September 2026 spam update/ })
    // Its rollout is a light band, and its card gives the days and when it finished.
    expect(view.container.querySelectorAll('.ui-chart-rollout')).toHaveLength(1)
    fireEvent.focus(google)
    const card = view.container.querySelector('.ui-chart-card')
    expect(card?.textContent).toContain('Sep 24 – Oct 8 · Google')
    expect(card?.textContent).toContain('Finished Oct 8, 2026.')
    fireEvent.blur(google)
    const chip = view.getByRole('button', { name: /Google updates/ })
    expect(chip.getAttribute('aria-pressed')).toBe('true')
    act(() => {
      fireEvent.click(chip)
    })
    expect(window.location.hash).toContain('marks.hide=google')
    expect(view.queryByRole('button', { name: /Google: September 2026 spam update/ })).toBeNull()
    expect(view.container.querySelectorAll('.ui-chart-rollout')).toHaveLength(0)
    expect(view.getByRole('button', { name: /Your fix: Fix 1/ })).toBeTruthy()
  })

  it('marks a day of tracking changes in grey, with its card and its own toggle', () => {
    const changes: TrackingChange[] = [
      {
        id: 't1',
        at: '2026-09-20T09:00:00.000Z',
        kind: 'questions_added',
        pageId: 'p1',
        count: 7,
        detail: null
      },
      {
        id: 't2',
        at: '2026-09-20T11:00:00.000Z',
        kind: 'questions_added',
        pageId: 'p1',
        count: 5,
        detail: null
      },
      {
        id: 't3',
        at: '2026-09-20T12:00:00.000Z',
        kind: 'engine_on',
        pageId: null,
        count: 1,
        detail: 'ChatGPT'
      },
      // Another page's questions: not on this page's chart.
      {
        id: 't4',
        at: '2026-10-05T12:00:00.000Z',
        kind: 'questions_added',
        pageId: 'p2',
        count: 3,
        detail: null
      },
      // Before the chart starts: left out.
      {
        id: 't5',
        at: '2026-06-01T12:00:00.000Z',
        kind: 'market_added',
        pageId: null,
        count: 1,
        detail: 'GB · EN'
      }
    ]
    const view = render(
      <TrackingChangesContext.Provider value={changes}>
        <TrendChart
          label="Right page cited over time"
          series={[series]}
          yTicks={[0, 0.25, 0.5, 0.75]}
          yFormat={(value) => `${Math.round(value * 100)}%`}
          events={[fix]}
          trackingPages={new Set(['p1'])}
        />
      </TrackingChangesContext.Provider>
    )
    const marker = view.getByRole('button', { name: /Tracking changed: 2 changes/ })
    expect(marker.getAttribute('data-marker-kind')).toBe('tracking')
    expect(marker.querySelector('.ui-mk-tracking')?.textContent).toBe('±')
    fireEvent.focus(marker)
    const card = view.container.querySelector('.ui-chart-card')
    expect(card?.textContent).toContain('You added 12 questions. ChatGPT turned on.')
    fireEvent.blur(marker)
    expect(view.queryAllByRole('button', { name: /Tracking changed/ })).toHaveLength(1)
    const chip = view.getByRole('button', { name: /Tracking changes/ })
    act(() => {
      fireEvent.click(chip)
    })
    expect(window.location.hash).toContain('marks.hide=tracking')
    expect(view.queryByRole('button', { name: /Tracking changed/ })).toBeNull()
  })

  it('has no markers row when markers are off', () => {
    const view = draw({ markers: false })
    expect(view.queryByRole('group', { name: 'Show on chart' })).toBeNull()
    expect(view.queryByRole('button', { name: /Your fix: Fix 1/ })).toBeNull()
  })

  it('places a drill control on each point, and its focus shows the check’s card', () => {
    const onPick = vi.fn()
    const view = draw({
      pointControl: ({ point, onFocus }) => (
        <button
          type="button"
          aria-label={`Check ${point.key}`}
          onFocus={onFocus}
          onClick={() => onPick(point.key)}
        />
      )
    })
    const point = view.getByRole('button', { name: 'Check r4' })
    expect(view.queryByRole('button', { name: 'Check r3' })).toBeNull()
    fireEvent.focus(point)
    expect(view.container.querySelector('.ui-chart-card')?.textContent).toContain('58%')
    fireEvent.click(point)
    expect(onPick).toHaveBeenCalledWith('r4')
  })

  it('says a gap once in words', () => {
    const view = draw({ gapNote: 'First check was Sep 1' })
    expect(view.getAllByText('First check was Sep 1')).toHaveLength(1)
  })
})
