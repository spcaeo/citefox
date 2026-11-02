// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import type { JSX } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MenuButton, type MenuItem } from './Menu'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function Harness({ onSelect }: { onSelect: () => void }): JSX.Element {
  const items: MenuItem[] = [
    { id: 'edit', label: 'Edit keyword', onSelect },
    { id: 'remove', label: 'Remove', tone: 'danger', onSelect: () => undefined }
  ]
  return (
    <div data-testid="scroller" style={{ overflow: 'auto', height: 100 }}>
      <MenuButton
        label="Actions for Q6"
        items={items}
        trigger={(props) => (
          <button type="button" {...props}>
            Actions
          </button>
        )}
      />
    </div>
  )
}

describe('MenuButton placement', () => {
  it('focuses the first item without scrolling the page', () => {
    const focus = vi.spyOn(HTMLElement.prototype, 'focus')
    const view = render(<Harness onSelect={() => undefined} />)
    fireEvent.click(view.getByRole('button', { name: 'Actions' }))
    expect(view.getByRole('menu', { name: 'Actions for Q6' })).toBeTruthy()
    expect(focus).toHaveBeenCalledWith({ preventScroll: true })
  })

  it('stays open when a grid scrolls, and an item can still be picked', () => {
    const onSelect = vi.fn()
    const view = render(<Harness onSelect={onSelect} />)
    fireEvent.click(view.getByRole('button', { name: 'Actions' }))
    act(() => {
      view.getByTestId('scroller').dispatchEvent(new Event('scroll'))
      window.dispatchEvent(new Event('resize'))
    })
    const item = view.getByRole('menuitem', { name: 'Edit keyword' })
    fireEvent.click(item)
    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  it('closes when its button scrolls out of the window', () => {
    const view = render(<Harness onSelect={() => undefined} />)
    const button = view.getByRole('button', { name: 'Actions' })
    fireEvent.click(button)
    vi.spyOn(button, 'getBoundingClientRect').mockReturnValue({
      top: -200,
      bottom: -170,
      left: 0,
      right: 80,
      width: 80,
      height: 30,
      x: 0,
      y: -200,
      toJSON: () => ({})
    })
    act(() => {
      view.getByTestId('scroller').dispatchEvent(new Event('scroll'))
    })
    expect(view.queryByRole('menu')).toBeNull()
  })
})
