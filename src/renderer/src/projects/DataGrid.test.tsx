// @vitest-environment happy-dom
import { cleanup, fireEvent, render } from '@testing-library/react'
import { useState, type JSX } from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { VirtualWindow } from './DataGrid'

afterEach(() => cleanup())

function List({
  onActivate,
  onEdit,
  initialFocus = 0
}: {
  onActivate?: (index: number) => void
  onEdit?: (index: number) => void
  initialFocus?: number
}): JSX.Element {
  const [focus, setFocus] = useState(initialFocus)
  return (
    <VirtualWindow
      count={4}
      rowHeight={40}
      viewport={400}
      focusIndex={focus}
      onFocusIndex={setFocus}
      {...(onActivate ? { onActivate } : {})}
      label="Rows"
    >
      {(start, end) => (
        <>
          <div role="row">
            <span role="columnheader">
              <button type="button">Sort</button>
            </span>
          </div>
          {Array.from({ length: end - start }, (_, offset) => {
            const index = start + offset
            return (
              <div key={index} role="row" data-row={index} tabIndex={-1}>
                <span role="gridcell">Row {index}</span>
                <span role="gridcell">
                  <button type="button" onClick={() => onEdit?.(index)}>
                    Edit {index}
                  </button>
                </span>
              </div>
            )
          })}
        </>
      )}
    </VirtualWindow>
  )
}

function row(view: ReturnType<typeof render>, index: number): HTMLElement {
  const found = view.container.querySelector<HTMLElement>(`[data-row="${index}"]`)
  if (!found) throw new Error(`row ${index}`)
  return found
}

describe('VirtualWindow keys and clicks', () => {
  test('Enter on a row opens that row, not the last arrow-focused one', () => {
    const onActivate = vi.fn()
    const view = render(<List onActivate={onActivate} />)
    const third = row(view, 2)
    third.focus()
    fireEvent.keyDown(third, { key: 'Enter' })
    expect(onActivate).toHaveBeenCalledWith(2)
  })

  test('Enter on a button inside a row is left to the button', () => {
    const onActivate = vi.fn()
    const view = render(<List onActivate={onActivate} />)
    const edit = view.getByRole('button', { name: 'Edit 3' })
    edit.focus()
    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    edit.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
    expect(onActivate).not.toHaveBeenCalled()
  })

  test('Enter on a header button does not open a row', () => {
    const onActivate = vi.fn()
    const view = render(<List onActivate={onActivate} />)
    const sort = view.getByRole('button', { name: 'Sort' })
    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    sort.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
    expect(onActivate).not.toHaveBeenCalled()
  })

  test('Enter without an activate handler is not swallowed', () => {
    const view = render(<List />)
    const first = row(view, 0)
    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    first.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
  })

  test('a click on a row opens it; a click on a control inside does not', () => {
    const onActivate = vi.fn()
    const onEdit = vi.fn()
    const view = render(<List onActivate={onActivate} onEdit={onEdit} />)
    fireEvent.click(view.getByText('Row 1'))
    expect(onActivate).toHaveBeenCalledWith(1)
    fireEvent.click(view.getByRole('button', { name: 'Edit 2' }))
    expect(onEdit).toHaveBeenCalledWith(2)
    expect(onActivate).toHaveBeenCalledTimes(1)
  })

  test('arrow keys move from the focused row, and leave controls alone', () => {
    const view = render(<List onActivate={() => undefined} />)
    const second = row(view, 1)
    second.focus()
    fireEvent.focus(second)
    fireEvent.keyDown(second, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(row(view, 2))
    const edit = view.getByRole('button', { name: 'Edit 2' })
    edit.focus()
    const event = new KeyboardEvent('keydown', {
      key: 'ArrowDown',
      bubbles: true,
      cancelable: true
    })
    edit.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
    expect(document.activeElement).toBe(edit)
  })
})
