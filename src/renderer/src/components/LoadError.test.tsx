// @vitest-environment happy-dom
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { axeViolations } from '../ui/axe.test-helper'
import { LoadError } from './LoadError'

afterEach(cleanup)

describe('LoadError', () => {
  it('is an alert built on EmptyState with the cleaned message and a Retry button', async () => {
    const retry = vi.fn()
    const view = render(
      <LoadError
        title="CiteFox could not load this page."
        message="Error invoking remote method 'pages:get': Error: The database is locked"
        onRetry={retry}
      >
        <a href="#/pages">Go to All pages</a>
      </LoadError>
    )
    const alert = view.getByRole('alert')
    expect(alert.className).toBe('load-error')
    expect(alert.querySelector('.ui-empty')).toBeTruthy()
    expect(view.getByRole('heading', { level: 2 }).textContent).toBe(
      'CiteFox could not load this page.'
    )
    expect(view.getByText(/database is locked/).textContent).not.toContain('invoking')
    // The cleaned message gets Copy (never the raw invoke wrapper).
    expect(
      view.getByRole('button', { name: /^Copy .*database is locked/ }).getAttribute('aria-label')
    ).not.toContain('invoking')
    fireEvent.click(view.getByRole('button', { name: 'Try again' }))
    expect(retry).toHaveBeenCalledTimes(1)
    expect(view.getByRole('link', { name: 'Go to All pages' })).toBeTruthy()
    expect(await axeViolations(view.container)).toEqual([])
  })

  it('leaves out a message equal to the title and actions that are not given', () => {
    const view = render(<LoadError title="Could not load." message="Could not load." level={3} />)
    expect(view.getByRole('heading', { level: 3 })).toBeTruthy()
    expect(view.container.querySelector('.ui-empty-body')).toBeNull()
    expect(view.container.querySelector('.ui-empty-action')).toBeNull()
  })

  it('takes its own retry label', () => {
    const view = render(
      <LoadError title="Could not load." onRetry={() => {}} retryLabel="Reload" />
    )
    expect(view.getByRole('button', { name: 'Reload' })).toBeTruthy()
  })
})
