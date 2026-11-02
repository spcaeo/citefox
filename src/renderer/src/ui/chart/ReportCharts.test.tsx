// @vitest-environment happy-dom
import { cleanup, fireEvent, render } from '@testing-library/react'
import axe from 'axe-core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FunnelChart, HistoryStripChart, RankedBarsChart } from './ReportCharts'

afterEach(cleanup)

const ITEMS = [
  { id: 'd:a', label: 'reddit.com', value: 12, previous: 8 },
  { id: 'd:b', label: 'textbolt.com', value: 9, previous: 2, highlight: true },
  { id: 'd:c', label: 'g2.com', value: 4, previous: 7 }
]

function marks(container: HTMLElement): SVGGElement[] {
  return [...container.querySelectorAll<SVGGElement>('[data-drill]')]
}

describe('report charts in the app', () => {
  it('draws the shared SVG with a drill button per mark and no native titles', () => {
    const view = render(
      <RankedBarsChart label="Most cited sites" items={ITEMS} previousLabel="Sep 16" />
    )
    const svg = view.container.querySelector('svg.cfc-ranked')
    expect(svg?.getAttribute('aria-label')).toBe('Most cited sites')
    expect(marks(view.container)).toHaveLength(3)
    expect(view.getByRole('button', { name: 'textbolt.com: 9, before 2' })).toBeTruthy()
    expect(view.container.querySelector('title')).toBeNull()
  })

  it('shows a readout on hover and focus, and hides it on leave', () => {
    const view = render(
      <RankedBarsChart label="Most cited sites" items={ITEMS} previousLabel="Sep 16" />
    )
    const first = marks(view.container)[0] as SVGGElement
    fireEvent.pointerOver(first)
    const card = view.container.querySelector('.ui-rchart-card')
    expect(card?.textContent).toContain('reddit.com')
    expect(card?.textContent).toContain('Change: +4')
    fireEvent.pointerLeave(view.container.firstElementChild as Element)
    expect(view.container.querySelector('.ui-rchart-card')).toBeNull()
    fireEvent.focus(marks(view.container)[2] as SVGGElement)
    expect(view.container.querySelector('.ui-rchart-card')?.textContent).toContain('g2.com')
  })

  it('drills on click, Enter and Space, and moves focus with the arrow keys', () => {
    const onDrill = vi.fn()
    const view = render(
      <RankedBarsChart
        label="Most cited sites"
        items={ITEMS}
        previousLabel="Sep 16"
        onDrill={onDrill}
      />
    )
    const [a, b, c] = marks(view.container) as [SVGGElement, SVGGElement, SVGGElement]
    fireEvent.click(b.querySelector('rect') as Element)
    expect(onDrill).toHaveBeenLastCalledWith('d:b')
    fireEvent.keyDown(c, { key: 'Enter' })
    expect(onDrill).toHaveBeenLastCalledWith('d:c')
    fireEvent.keyDown(a, { key: ' ' })
    expect(onDrill).toHaveBeenLastCalledWith('d:a')
    a.focus()
    fireEvent.keyDown(a, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(b)
    fireEvent.keyDown(b, { key: 'End' })
    expect(document.activeElement).toBe(c)
    fireEvent.keyDown(c, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(a)
  })

  it('a history strip sits inline, and charts pass axe', async () => {
    const view = render(
      <div>
        <HistoryStripChart
          label="History"
          cells={[
            { date: 'Sep 16', state: 'not-cited' },
            { date: 'Oct 28', state: 'target', id: 'run:2' }
          ]}
        />
        <FunnelChart
          label="Where visibility falls away"
          steps={[
            { id: 't', label: 'Tracked', value: 10 },
            { id: 'c', label: 'Cited', value: 4, lostId: 'l' }
          ]}
        />
      </div>
    )
    expect(view.container.querySelector('.ui-rchart-inline svg.cfc-history')).toBeTruthy()
    expect(view.getByRole('button', { name: '6 lost between Tracked and Cited' })).toBeTruthy()
    const results = await axe.run(view.container, { rules: { region: { enabled: false } } })
    expect(results.violations).toEqual([])
  })
})
