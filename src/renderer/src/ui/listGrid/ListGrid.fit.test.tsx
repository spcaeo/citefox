// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { grid } from './ListGrid.fixtures'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function headers(): string[] {
  return screen.getAllByRole('columnheader').map((cell) => cell.textContent ?? '')
}

/** The fixture's row needs 560px (padding, Q 48, Question 240, Stage 96, Win odds 96, gaps). */
function at(width: number): void {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(width)
}

describe('ListGrid: narrowDrops', () => {
  it('keeps every column when the row fits', () => {
    at(700)
    render(grid({ narrowDrops: ['stage', 'n'] }))
    expect(headers()).toEqual(['Q', 'Question', 'Stage', 'Win odds'])
  })

  it('leaves out the named columns in order until the row fits', () => {
    at(500)
    render(grid({ narrowDrops: ['stage', 'n'] }))
    expect(headers()).toEqual(['Q', 'Question', 'Win odds'])
    cleanup()
    at(400)
    render(grid({ narrowDrops: ['stage', 'n'] }))
    expect(headers()).toEqual(['Question', 'Win odds'])
    expect(screen.getByRole('grid').getAttribute('aria-colcount')).toBe('2')
  })

  it('without narrowDrops keeps every column and scrolls', () => {
    at(300)
    render(grid())
    expect(headers()).toEqual(['Q', 'Question', 'Stage', 'Win odds'])
  })
})
