// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ViewsPlayground } from './ViewsPlayground'

afterEach(cleanup)
beforeEach(() => {
  window.history.replaceState(null, '', '#/playground')
})

function go(hash: string): void {
  act(() => {
    window.history.replaceState(null, '', hash)
    window.dispatchEvent(new HashChangeEvent('hashchange'))
  })
}

describe('ViewsPlayground', () => {
  it('shows the result bar, view tabs and a closed tree', () => {
    const view = render(<ViewsPlayground />)
    expect(view.getByRole('tablist', { name: 'Views' })).toBeTruthy()
    expect(view.getByRole('treegrid', { name: 'Searches' })).toBeTruthy()
    expect(view.container.querySelectorAll('[data-group]')).toHaveLength(4)
  })

  it('opens a drill page from a group, with chips, back link and footer', () => {
    const view = render(<ViewsPlayground />)
    fireEvent.click(view.getByRole('button', { name: 'Expand all' }))
    const open = view.getAllByRole('link', { name: /Open all/ })[0] as HTMLAnchorElement
    go(open.getAttribute('href') ?? '')
    expect(view.getByRole('link', { name: 'Back to all 240' })).toBeTruthy()
    expect(view.getByRole('link', { name: 'Remove Stage: Problem' })).toBeTruthy()
    expect(view.getByText(/^Showing all \d+$/)).toBeTruthy()
    expect(view.container.querySelector('.ui-group-hint-block')).not.toBeNull()
  })
})
