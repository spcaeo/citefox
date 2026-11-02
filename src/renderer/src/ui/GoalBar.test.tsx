// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { axeViolations } from './axe.test-helper'
import { clampPercent, goalBarText } from './componentModels'
import { GoalBar } from './GoalBar'

afterEach(cleanup)

describe('GoalBar', () => {
  it('places the band and fill by percent and labels the target', () => {
    const view = render(
      <GoalBar label="Goal bar · buyer questions" value={42} band={{ lo: 50, hi: 70 }} />
    )
    const meter = view.getByRole('meter', { name: '42% cited, target 50–70%' })
    expect(meter.getAttribute('aria-valuenow')).toBe('42')
    const band = view.container.querySelector<HTMLElement>('[data-part="band"]')
    expect(band?.style.left).toBe('50%')
    expect(band?.style.width).toBe('20%')
    expect(view.container.querySelector<HTMLElement>('[data-part="fill"]')?.style.width).toBe('42%')
    expect(view.getByText('target 50–70%')).toBeTruthy()
    const ticks = [...view.container.querySelectorAll('.ui-goal-tick')].map((t) => t.textContent)
    expect(ticks).toEqual(['0', '50', '70', '100'])
  })

  it('clamps values and accepts custom ticks and labels', () => {
    const view = render(
      <GoalBar value={140} band={{ lo: 25, hi: 40 }} ticks={[0, 25, 100]} valueLabel="All cited" />
    )
    expect(view.getByRole('meter', { name: 'All cited' }).getAttribute('aria-valuenow')).toBe('100')
    expect(view.container.querySelector<HTMLElement>('[data-part="fill"]')?.style.width).toBe(
      '100%'
    )
    expect(view.container.querySelectorAll('.ui-goal-tick')).toHaveLength(3)
    expect(clampPercent(-5)).toBe(0)
    expect(clampPercent(Number.NaN)).toBe(0)
    expect(goalBarText(24.6)).toBe('25% cited')
  })

  it('has a bare small form for KPI tiles', () => {
    const view = render(<GoalBar size="sm" value={25} band={{ lo: 25, hi: 40 }} />)
    expect(view.container.querySelector('.ui-goal-sm')).toBeTruthy()
    expect(view.container.querySelector('.ui-goal-head')).toBeNull()
    expect(view.container.querySelector('.ui-goal-ticks')).toBeNull()
  })

  it('is axe clean', async () => {
    const view = render(<GoalBar label="Keywords" value={25} band={{ lo: 25, hi: 40 }} />)
    expect(await axeViolations(view.container)).toEqual([])
  })
})
