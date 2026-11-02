// @vitest-environment happy-dom
import { cleanup, fireEvent, render, within } from '@testing-library/react'
import axe from 'axe-core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MenuItem } from './Menu'
import { RowMenu } from './RowMenu'

const RULES = {
  rules: {
    'document-title': { enabled: false },
    'html-has-lang': { enabled: false },
    'landmark-one-main': { enabled: false },
    region: { enabled: false }
  }
}

function items(): {
  list: MenuItem[]
  see: ReturnType<typeof vi.fn>
  draft: ReturnType<typeof vi.fn>
} {
  const see = vi.fn()
  const draft = vi.fn()
  return {
    see,
    draft,
    list: [
      { id: 'see', label: "See who's cited", icon: 'eye', onSelect: see },
      { id: 'off', label: 'Unavailable', disabled: true, onSelect: vi.fn() },
      {
        id: 'draft',
        label: 'Draft the fix',
        icon: 'sparkle',
        hint: '15 s',
        tone: 'ai',
        onSelect: draft
      },
      { id: 'remove', label: 'Remove', icon: 'trash', tone: 'danger', onSelect: vi.fn() }
    ]
  }
}

afterEach(cleanup)

function menuItems(): HTMLElement[] {
  return within(document.body).getAllByRole('menuitem')
}

describe('RowMenu and MenuButton', () => {
  it('names the button after the row and opens a labelled menu on click', async () => {
    const { list } = items()
    const view = render(<RowMenu label="Actions for Q6" items={list} />)
    const button = view.getByRole('button', { name: 'Actions for Q6' })
    expect(button.getAttribute('aria-haspopup')).toBe('menu')
    expect(button.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(button)
    expect(button.getAttribute('aria-expanded')).toBe('true')
    const menu = view.getByRole('menu', { name: 'Actions for Q6' })
    expect(button.getAttribute('aria-controls')).toBe(menu.id)
    expect(menuItems().map((item) => item.textContent)).toEqual([
      "See who's cited",
      'Unavailable',
      'Draft the fix15 s',
      'Remove'
    ])
    expect(document.activeElement).toBe(menuItems()[0])
    expect((await axe.run(view.container, RULES)).violations).toEqual([])
  })

  it('opens from the keyboard, skips disabled items, wraps, and Escape returns focus', () => {
    const { list } = items()
    const view = render(<RowMenu label="Actions for Q6" items={list} />)
    const button = view.getByRole('button', { name: 'Actions for Q6' })
    fireEvent.keyDown(button, { key: 'ArrowDown' })
    const menu = view.getByRole('menu')
    expect(document.activeElement?.textContent).toBe("See who's cited")
    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(document.activeElement?.textContent).toBe('Draft the fix15 s')
    fireEvent.keyDown(menu, { key: 'End' })
    expect(document.activeElement?.textContent).toBe('Remove')
    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(document.activeElement?.textContent).toBe("See who's cited")
    fireEvent.keyDown(menu, { key: 'ArrowUp' })
    expect(document.activeElement?.textContent).toBe('Remove')
    fireEvent.keyDown(menu, { key: 'Home' })
    expect(document.activeElement?.textContent).toBe("See who's cited")
    fireEvent.keyDown(menu, { key: 'Escape' })
    expect(view.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(button)
  })

  it('Enter opens on the first item and ArrowUp on the last', () => {
    const { list } = items()
    const view = render(<RowMenu label="Actions for Q6" items={list} />)
    const button = view.getByRole('button', { name: 'Actions for Q6' })
    fireEvent.keyDown(button, { key: 'Enter' })
    expect(document.activeElement?.textContent).toBe("See who's cited")
    fireEvent.keyDown(view.getByRole('menu'), { key: 'Escape' })
    fireEvent.keyDown(button, { key: 'ArrowUp' })
    expect(document.activeElement?.textContent).toBe('Remove')
  })

  it('selecting an item closes the menu, refocuses the button and calls onSelect', () => {
    const { list, draft, see } = items()
    const onOpenChange = vi.fn()
    const view = render(<RowMenu label="Actions for Q6" items={list} onOpenChange={onOpenChange} />)
    const button = view.getByRole('button', { name: 'Actions for Q6' })
    fireEvent.click(button)
    expect(onOpenChange).toHaveBeenLastCalledWith(true)
    fireEvent.click(view.getByRole('menuitem', { name: /Draft the fix/ }))
    expect(draft).toHaveBeenCalledTimes(1)
    expect(see).not.toHaveBeenCalled()
    expect(view.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(button)
    expect(onOpenChange).toHaveBeenLastCalledWith(false)
  })

  it('a disabled item does nothing and a press outside closes', () => {
    const { list } = items()
    const view = render(
      <div>
        <p>Outside</p>
        <RowMenu label="Actions for Q6" items={list} />
      </div>
    )
    fireEvent.click(view.getByRole('button', { name: 'Actions for Q6' }))
    const disabled = view.getByRole('menuitem', { name: 'Unavailable' })
    expect(disabled.getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(disabled)
    expect(list[1]?.onSelect).not.toHaveBeenCalled()
    expect(view.getByRole('menu')).toBeTruthy()
    fireEvent.mouseDown(view.getByText('Outside'))
    expect(view.queryByRole('menu')).toBeNull()
  })
})
