// @vitest-environment happy-dom
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { axeViolations } from './axe.test-helper'
import { IconButton } from './IconButton'

afterEach(cleanup)

describe('IconButton', () => {
  it('names the button with its label and hides the icon', () => {
    const onClick = vi.fn()
    const view = render(<IconButton icon="x" label="Close" onClick={onClick} />)
    const button = view.getByRole('button', { name: 'Close' })
    expect(button.className).toBe('ui-icon-btn')
    expect(button.getAttribute('type')).toBe('button')
    expect(button.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
    fireEvent.click(button)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('has a small size for grid rows', () => {
    const view = render(<IconButton icon="dots" label="Actions for Q6" size="sm" />)
    expect(view.getByRole('button', { name: 'Actions for Q6' }).className).toBe(
      'ui-icon-btn ui-icon-btn-sm'
    )
  })

  it('shows its label as a tooltip with tip', () => {
    const view = render(<IconButton icon="plus" label="Add questions" tip />)
    const button = view.getByRole('button', { name: 'Add questions' })
    expect(button.getAttribute('data-tip')).toBe('Add questions')
    cleanup()
    const plain = render(<IconButton icon="plus" label="Add questions" />)
    expect(plain.getByRole('button').hasAttribute('data-tip')).toBe(false)
  })

  it('is axe clean', async () => {
    const view = render(
      <div>
        <IconButton icon="chevron-left" label="Previous page" />
        <IconButton icon="chevron-right" label="Next page" disabled />
      </div>
    )
    expect(await axeViolations(view.container)).toEqual([])
  })
})
