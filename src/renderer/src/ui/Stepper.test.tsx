// @vitest-environment happy-dom
import { cleanup, fireEvent, render, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { axeViolations } from './axe.test-helper'
import { stepStates } from './componentModels'
import { Stepper } from './Stepper'

afterEach(cleanup)

const STEPS = [
  { id: 'seed', label: 'Seed' },
  { id: 'profile', label: 'Buyer profile' },
  { id: 'questions', label: 'Questions' },
  { id: 'keywords', label: 'Keywords' },
  { id: 'pages', label: 'Pages' },
  { id: 'estimate', label: 'Estimate' }
]

describe('Stepper', () => {
  it('marks steps done, current and to do from the current id', () => {
    expect(stepStates(STEPS, 'keywords')).toEqual([
      'done',
      'done',
      'done',
      'current',
      'todo',
      'todo'
    ])
    const view = render(<Stepper label="New topic steps" steps={STEPS} current="keywords" />)
    const list = view.getByRole('list', { name: 'New topic steps' })
    const items = within(list).getAllByRole('listitem')
    expect(items).toHaveLength(6)
    expect(items[3]?.getAttribute('aria-current')).toBe('step')
    expect(items[3]?.querySelector('.ui-step-current')?.textContent).toBe('4')
    expect(items[0]?.textContent).toContain('(done)')
    expect(items[5]?.querySelector('.ui-step-todo')?.textContent).toBe('6')
    expect(view.queryAllByRole('button')).toHaveLength(0)
  })

  it('makes done steps buttons that go back when onStep is given', () => {
    const onStep = vi.fn()
    const view = render(<Stepper steps={STEPS} current="questions" onStep={onStep} />)
    const buttons = view.getAllByRole('button')
    expect(buttons).toHaveLength(2)
    fireEvent.click(view.getByRole('button', { name: /Buyer profile/ }))
    expect(onStep).toHaveBeenCalledWith('profile')
  })

  it('shows an incomplete earlier step numbered, with no check, and still a button', () => {
    const onStep = vi.fn()
    const view = render(
      <Stepper steps={STEPS} current="keywords" incomplete={['profile']} onStep={onStep} />
    )
    const items = view.getAllByRole('listitem')
    expect(items[1]?.querySelector('.ui-step-done')).toBeNull()
    expect(items[1]?.querySelector('.ui-step-incomplete')?.textContent).toBe('2')
    expect(items[1]?.textContent).toContain('(not done)')
    expect(items[1]?.textContent).not.toContain('(done)')
    expect(items[0]?.textContent).toContain('(done)')
    fireEvent.click(view.getByRole('button', { name: /Buyer profile/ }))
    expect(onStep).toHaveBeenCalledWith('profile')
    // A later step in the list is still just to do.
    const later = render(<Stepper steps={STEPS} current="seed" incomplete={['profile']} />)
    expect(later.container.querySelector('.ui-step-incomplete')).toBeNull()
  })

  it('is axe clean', async () => {
    const view = render(<Stepper steps={STEPS} current="profile" onStep={() => {}} />)
    expect(await axeViolations(view.container)).toEqual([])
  })
})
