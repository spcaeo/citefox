// @vitest-environment happy-dom
import { cleanup, fireEvent, render, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AiMenu } from './AiMenu'
import { aiMenuItems } from './componentModels'
import { axeViolations } from './axe.test-helper'

afterEach(cleanup)

function actions(spy: (id: string) => void): Parameters<typeof AiMenu>[0]['actions'] {
  return [
    {
      id: 'discover',
      label: 'Discover more',
      icon: 'compass',
      seconds: 15,
      onSelect: () => spy('discover')
    },
    { id: 'rewrite', label: 'Rewrite', icon: 'wand', seconds: 5, onSelect: () => spy('rewrite') },
    {
      id: 'explain',
      label: 'Explain',
      icon: 'bulb',
      seconds: 5,
      onSelect: () => spy('explain'),
      disabled: true
    },
    {
      id: 'prioritise',
      label: 'Prioritise',
      icon: 'prioritise',
      seconds: 8,
      onSelect: () => spy('prioritise')
    }
  ]
}

describe('AiMenu', () => {
  it('opens a menu with time estimates and the plan footer', () => {
    const view = render(<AiMenu actions={actions(() => {})} />)
    const button = view.getByRole('button', { name: 'AI actions' })
    expect(button.getAttribute('aria-haspopup')).toBe('menu')
    expect(button.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(button)
    expect(button.getAttribute('aria-expanded')).toBe('true')
    expect(button.className).toContain('ui-ai-on')
    const menu = view.getByRole('menu', { name: 'AI actions' })
    const items = within(menu).getAllByRole('menuitem')
    expect(items.map((item) => item.textContent)).toEqual([
      'Discover more15 s',
      'Rewrite5 s',
      'Explain5 s',
      'Prioritise8 s'
    ])
    expect(menu.textContent).toContain('Runs on your AI plan. Uses no searches.')
    expect(document.activeElement).toBe(items[0])
  })

  it('moves with the keyboard, skips disabled items, selects and returns focus', () => {
    const spy = vi.fn()
    const view = render(<AiMenu actions={actions(spy)} />)
    const button = view.getByRole('button', { name: 'AI actions' })
    fireEvent.keyDown(button, { key: 'ArrowDown' })
    const menu = view.getByRole('menu')
    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(document.activeElement?.textContent).toContain('Prioritise')
    fireEvent.keyDown(menu, { key: 'Home' })
    expect(document.activeElement?.textContent).toContain('Discover more')
    fireEvent.keyDown(menu, { key: 'End' })
    fireEvent.click(document.activeElement as HTMLElement)
    expect(spy).toHaveBeenCalledWith('prioritise')
    expect(view.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(button)
  })

  it('closes on Escape and on a press outside', () => {
    const view = render(
      <div>
        <p>Outside</p>
        <AiMenu actions={actions(() => {})} />
      </div>
    )
    const button = view.getByRole('button', { name: 'AI actions' })
    fireEvent.keyDown(button, { key: 'Enter' })
    fireEvent.keyDown(view.getByRole('menu'), { key: 'Escape' })
    expect(view.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(button)
    fireEvent.click(button)
    fireEvent.mouseDown(view.getByText('Outside'))
    expect(view.queryByRole('menu')).toBeNull()
  })

  it('uses a fox sparkle for actions without an icon and has an icon-only size', () => {
    expect(
      aiMenuItems([{ id: 'x', label: 'Draft the fix', seconds: 15, onSelect: () => {} }])[0]
    ).toMatchObject({
      icon: 'sparkle',
      tone: 'ai',
      hint: '15 s'
    })
    const view = render(
      <AiMenu size="sm" label="AI actions for Segments" actions={actions(() => {})} />
    )
    const button = view.getByRole('button', { name: 'AI actions for Segments' })
    expect(button.className).toContain('ui-ai-btn-sm')
    expect(button.textContent).toBe('')
    expect(button.getAttribute('title')).toBe('AI actions for Segments')
  })

  it('is axe clean open and closed', async () => {
    const view = render(<AiMenu actions={actions(() => {})} />)
    expect(await axeViolations(view.container)).toEqual([])
    fireEvent.click(view.getByRole('button', { name: 'AI actions' }))
    expect(await axeViolations(view.container)).toEqual([])
  })
})
