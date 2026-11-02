// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import type { JSX } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SidebarMode } from '@shared/domain'
import { isSidebarCollapsed, isSidebarShortcut, nextSidebarMode, useSidebar } from './useSidebar'

let listeners: (() => void)[] = []
let narrow = false

function fakeMedia(): void {
  listeners = []
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) =>
      ({
        get matches() {
          return narrow
        },
        media: query,
        addEventListener: (_: string, listener: () => void) => listeners.push(listener),
        removeEventListener: () => undefined
      }) as unknown as MediaQueryList
  )
}

function resize(next: boolean): void {
  narrow = next
  act(() => {
    for (const listener of listeners) listener()
  })
}

function Probe({
  stored,
  save
}: {
  stored: SidebarMode | undefined
  save: (mode: SidebarMode) => Promise<unknown>
}): JSX.Element {
  const sidebar = useSidebar(stored, save)
  return (
    <div>
      <p data-testid="state">{`${sidebar.collapsed ? 'collapsed' : 'expanded'}:${sidebar.mode}`}</p>
      <button type="button" onClick={sidebar.toggle}>
        Toggle
      </button>
      <input aria-label="Field" />
    </div>
  )
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  narrow = false
})

describe('sidebar collapse rules', () => {
  it('collapses on its own only in auto mode on a narrow window', () => {
    expect(isSidebarCollapsed('auto', false)).toBe(false)
    expect(isSidebarCollapsed('auto', true)).toBe(true)
    expect(isSidebarCollapsed('expanded', true)).toBe(false)
    expect(isSidebarCollapsed('collapsed', false)).toBe(true)
  })

  it('pins the sidebar open when expanded on a narrow window, and goes back to auto when wide', () => {
    expect(nextSidebarMode('auto', true)).toBe('expanded')
    expect(nextSidebarMode('collapsed', false)).toBe('auto')
    expect(nextSidebarMode('auto', false)).toBe('collapsed')
    expect(nextSidebarMode('expanded', true)).toBe('collapsed')
  })

  it('takes Cmd+B or Ctrl+B outside text fields only', () => {
    const field = document.createElement('input')
    document.body.append(field)
    const on = (init: KeyboardEventInit, target: EventTarget = document.body): boolean => {
      const event = new KeyboardEvent('keydown', { ...init, bubbles: true })
      Object.defineProperty(event, 'target', { value: target })
      return isSidebarShortcut(event)
    }
    expect(on({ key: 'b', metaKey: true })).toBe(true)
    expect(on({ key: 'B', ctrlKey: true })).toBe(true)
    expect(on({ key: 'b' })).toBe(false)
    expect(on({ key: 'b', metaKey: true, shiftKey: true })).toBe(false)
    expect(on({ key: 'b', metaKey: true }, field)).toBe(false)
    field.remove()
  })
})

describe('useSidebar', () => {
  it('follows the window width in auto mode', () => {
    fakeMedia()
    const view = render(<Probe stored="auto" save={() => Promise.resolve()} />)
    expect(view.getByTestId('state').textContent).toBe('expanded:auto')
    resize(true)
    expect(view.getByTestId('state').textContent).toBe('collapsed:auto')
    resize(false)
    expect(view.getByTestId('state').textContent).toBe('expanded:auto')
  })

  it('saves each toggle so the choice holds after a restart', () => {
    fakeMedia()
    const save = vi.fn(() => Promise.resolve())
    const view = render(<Probe stored={undefined} save={save} />)
    fireEvent.click(view.getByRole('button', { name: 'Toggle' }))
    expect(view.getByTestId('state').textContent).toBe('collapsed:collapsed')
    expect(save).toHaveBeenLastCalledWith('collapsed')
    fireEvent.click(view.getByRole('button', { name: 'Toggle' }))
    expect(view.getByTestId('state').textContent).toBe('expanded:auto')
    expect(save).toHaveBeenLastCalledWith('auto')
  })

  it('starts from the stored choice and toggles with Ctrl+B, not while typing', () => {
    fakeMedia()
    const save = vi.fn(() => Promise.resolve())
    const view = render(<Probe stored="collapsed" save={save} />)
    expect(view.getByTestId('state').textContent).toBe('collapsed:collapsed')
    fireEvent.keyDown(view.getByRole('textbox', { name: 'Field' }), { key: 'b', ctrlKey: true })
    expect(save).not.toHaveBeenCalled()
    fireEvent.keyDown(document.body, { key: 'b', ctrlKey: true })
    expect(view.getByTestId('state').textContent).toBe('expanded:auto')
    expect(save).toHaveBeenCalledWith('auto')
  })

  it('keeps the choice for the session when the save fails', async () => {
    fakeMedia()
    const view = render(<Probe stored="auto" save={() => Promise.reject(new Error('disk'))} />)
    fireEvent.click(view.getByRole('button', { name: 'Toggle' }))
    await act(async () => {
      await Promise.resolve()
    })
    expect(view.getByTestId('state').textContent).toBe('collapsed:collapsed')
  })
})
