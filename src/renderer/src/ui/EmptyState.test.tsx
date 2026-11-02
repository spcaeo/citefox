// @vitest-environment happy-dom
import { cleanup, fireEvent, render } from '@testing-library/react'
import axe from 'axe-core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Button } from './Button'
import { EmptyState } from './EmptyState'

const RULES = {
  rules: {
    'document-title': { enabled: false },
    'html-has-lang': { enabled: false },
    'landmark-one-main': { enabled: false },
    region: { enabled: false }
  }
}

afterEach(cleanup)

describe('EmptyState', () => {
  it('shows a heading, one helper line and one action', async () => {
    const onCheck = vi.fn()
    const view = render(
      <EmptyState
        icon="inbox"
        title="No AI Overview yet"
        body="CiteFox checks these again on Nov 2."
        action={
          <Button size="sm" onClick={onCheck}>
            Check now
          </Button>
        }
      />
    )
    expect(view.getByRole('heading', { level: 3, name: 'No AI Overview yet' })).toBeTruthy()
    expect(view.getByText('CiteFox checks these again on Nov 2.')).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: 'Check now' }))
    expect(onCheck).toHaveBeenCalledTimes(1)
    expect(view.container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
    expect((await axe.run(view.container, RULES)).violations).toEqual([])
  })

  it('renders only the title when nothing else is given, at the asked level', () => {
    const view = render(<EmptyState title="Nothing here" level={2} compact />)
    expect(view.getByRole('heading', { level: 2, name: 'Nothing here' })).toBeTruthy()
    expect(view.container.querySelector('.ui-empty-compact')).not.toBeNull()
    expect(view.container.querySelector('.ui-empty-body')).toBeNull()
    expect(view.queryByRole('button')).toBeNull()
  })
})
