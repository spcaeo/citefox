// @vitest-environment happy-dom
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { axeViolations } from './axe.test-helper'
import { SectionMenu } from './SectionMenu'

afterEach(cleanup)

describe('SectionMenu', () => {
  it('opens its items from an always-visible ⋯ with a tooltip', () => {
    const onAdd = vi.fn()
    const view = render(
      <SectionMenu
        label="More actions for Questions"
        items={[
          { id: 'add', label: 'Add questions', onSelect: onAdd },
          { id: 'all', label: 'All questions', onSelect: vi.fn() }
        ]}
      />
    )
    const button = view.getByRole('button', { name: 'More actions for Questions' })
    expect(button.className).toContain('ui-section-menu')
    expect(button.className).not.toContain('ui-row-menu')
    expect(button.getAttribute('data-tip')).toBe('More actions for Questions')
    fireEvent.click(button)
    fireEvent.click(view.getByRole('menuitem', { name: 'Add questions' }))
    expect(onAdd).toHaveBeenCalledTimes(1)
  })

  it('is axe clean', async () => {
    const view = render(
      <SectionMenu label="More actions" items={[{ id: 'a', label: 'A', onSelect: vi.fn() }]} />
    )
    expect(await axeViolations(view.container)).toEqual([])
  })
})
