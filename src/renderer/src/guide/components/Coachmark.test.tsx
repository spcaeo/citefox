// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, type RenderResult } from '@testing-library/react'
import { afterEach, describe, expect, test, vi, type Mock } from 'vitest'
import { axeViolations } from '../../ui/axe.test-helper'
import { ANCHOR_WAIT_MS, stepById } from '../constants'
import type { GuideStep } from '../types'
import { NO_FACTS } from '../utils/facts'
import { pressSelectors } from '../utils/press'
import { Coachmark } from './Coachmark'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

function step(id: string): GuideStep {
  const found = stepById(id)
  if (!found) throw new Error(id)
  return found
}

type Calls = Record<'onBack' | 'onSkip' | 'onDone' | 'onNext' | 'onPause', Mock<() => void>>

function show(
  target: GuideStep,
  options: { reviewing?: boolean; onSet?: () => void } = {}
): { view: RenderResult; calls: Calls } {
  const calls: Calls = {
    onBack: vi.fn(),
    onSkip: vi.fn(),
    onDone: vi.fn(),
    onNext: vi.fn(),
    onPause: vi.fn()
  }
  const view = render(
    <>
      <button type="button">Before</button>
      <p className="tr-source" data-guide="topic-target-page">
        Target page Not set{' '}
        <button type="button" onClick={options.onSet}>
          Set target page
        </button>
      </p>
      <div data-guide="topic-kpis">Tiles</div>
      <Coachmark
        step={target}
        index={1}
        total={1}
        lessonTitle="A topic page"
        target={pressSelectors(target, NO_FACTS)}
        reviewing={options.reviewing ?? false}
        canBack
        {...calls}
      />
    </>
  )
  return { view, calls }
}

describe('Coachmark', () => {
  test('an explanation step: title, what it is, Step n of m, and Got it', async () => {
    const { calls } = show(step('topic-kpis'))
    const dialog = screen.getByRole('dialog', { name: 'How this topic is doing' })
    expect(dialog.textContent).toContain('Step 1 of 1 · A topic page')
    expect(dialog.textContent).toContain('Searches where Google cites your target page')
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }))
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }))
    expect(
      [calls.onDone, calls.onBack, calls.onSkip].map((call) => call.mock.calls.length)
    ).toEqual([1, 1, 1])
    expect(await axeViolations(document.body)).toEqual([])
  })

  test('a step that waits for the real action says so, and "Open it for me" really clicks it', async () => {
    const onSet = vi.fn()
    show(step('set-target-page'), { onSet })
    expect(screen.queryByRole('button', { name: 'Got it' })).toBeNull()
    expect(screen.getByText(/Click Set target page and pick a page\./).textContent).toContain(
      'Or use “Open it for me”. The guide moves on by itself.'
    )
    fireEvent.click(screen.getByRole('button', { name: 'Open it for me' }))
    expect(onSet).toHaveBeenCalledTimes(1)
    expect(await axeViolations(document.body)).toEqual([])
  })

  test('the button to click pulses inside a still spotlight', () => {
    const rect = (top: number, left: number, width: number, height: number): DOMRect =>
      ({
        top,
        left,
        width,
        height,
        right: left + width,
        bottom: top + height,
        x: left,
        y: top
      }) as DOMRect
    const spy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: Element
    ) {
      if (this.matches('[data-guide="topic-target-page"]')) return rect(100, 100, 400, 32)
      if (this.matches('[data-guide="topic-target-page"] button')) return rect(104, 380, 110, 24)
      return rect(0, 0, 0, 0)
    })
    show(step('set-target-page'))
    expect(document.querySelector('.gd-ring-still')).not.toBeNull()
    const press = document.querySelector<HTMLElement>('.gd-ring-press')
    expect(press?.style.left).toBe('377px')
    spy.mockRestore()
  })

  test('a step reached again by Back: done, Next instead of the action, no Skip', () => {
    const { calls } = show(step('set-target-page'), { reviewing: true })
    expect(screen.getByTestId('guide-reviewing').textContent).toContain('You’ve done this one')
    expect(screen.queryByRole('button', { name: 'Skip' })).toBeNull()
    expect(screen.queryByText(/The guide moves on by itself/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(calls.onNext).toHaveBeenCalledTimes(1)
    // The action can still be done again.
    expect(screen.getByRole('button', { name: 'Open it for me' })).toBeTruthy()
  })

  test('a choice only the user can make (a competitor) has no "do it for me"', () => {
    show(step('mark-competitor'))
    expect(screen.queryByRole('button', { name: /for me/ })).toBeNull()
    expect(screen.getByRole('button', { name: 'Skip' })).toBeTruthy()
  })

  test('focus moves to the step title, Esc pauses, and focus goes back after', () => {
    const before = document.createElement('button')
    document.body.append(before)
    before.focus()
    const { view, calls } = show(step('topic-kpis'))
    expect(document.activeElement).toBe(
      screen.getByRole('heading', { name: 'How this topic is doing' })
    )
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(calls.onPause).toHaveBeenCalledTimes(1)
    view.unmount()
    expect(document.activeElement).toBe(before)
    before.remove()
  })

  test('the step names its place for screen readers', () => {
    show(step('topic-kpis'))
    expect(
      screen.getByText('Step 1 of 1: How this topic is doing.').getAttribute('aria-live')
    ).toBe('polite')
  })

  test('an element that never shows: a note, Skip becomes the main button', () => {
    vi.useFakeTimers()
    const { calls } = show(step('summary'))
    expect(screen.queryByRole('note')).toBeNull()
    act(() => {
      vi.advanceTimersByTime(ANCHOR_WAIT_MS + 300)
    })
    expect(screen.getByRole('note').textContent).toContain('isn’t on the screen right now')
    expect(screen.queryByRole('button', { name: 'Got it' })).toBeNull()
    const skip = screen.getByRole('button', { name: 'Skip' })
    expect(skip.className).toContain('primary')
    fireEvent.click(skip)
    expect(calls.onSkip).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('dialog').getAttribute('data-side')).toBe('center')
  })
})
