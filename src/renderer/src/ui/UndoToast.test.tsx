// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { UndoToastHost } from './UndoToast'
import { hideUndo, resetUndoToastForTests, showUndo, UNDO_TOAST_MS } from './undoStore'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  act(() => resetUndoToastForTests())
})

describe('UndoToastHost', () => {
  it('shows the latest message with Undo, runs it, then says Undone', async () => {
    const undo = vi.fn(() => Promise.resolve())
    render(<UndoToastHost />)
    act(() => {
      showUndo({ message: 'Removed 3 questions.', effect: 'Past results stay.', undo })
    })
    expect(screen.getByRole('status').textContent).toContain('Removed 3 questions.')
    expect(screen.getByText('Past results stay.')).toBeTruthy()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
      await Promise.resolve()
    })
    expect(undo).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('status').textContent).toContain('Undone.')
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
  })

  it('a newer toast replaces the older one; a failed undo shows why and stays', async () => {
    render(<UndoToastHost />)
    act(() => {
      showUndo({ message: 'First.', undo: () => Promise.resolve() })
      showUndo({
        message: 'Second.',
        undo: () => Promise.reject(new Error('That topic is gone.'))
      })
    })
    expect(screen.queryByText('First.')).toBeNull()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
      await Promise.resolve()
    })
    expect(screen.getByRole('status').textContent).toContain('That topic is gone.')
  })

  it('hides itself after the timeout and on Close', () => {
    vi.useFakeTimers()
    render(<UndoToastHost />)
    act(() => {
      showUndo({ message: 'Moved 2 questions.' })
    })
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
    act(() => {
      vi.advanceTimersByTime(UNDO_TOAST_MS + 10)
    })
    expect(screen.queryByRole('status')).toBeNull()
    act(() => {
      showUndo({ message: 'Again.' })
    })
    fireEvent.click(screen.getByRole('button', { name: 'Close message' }))
    expect(screen.queryByRole('status')).toBeNull()
    act(() => hideUndo())
  })
})
