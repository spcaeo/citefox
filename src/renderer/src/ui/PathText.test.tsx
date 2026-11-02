// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { announcedText, resetAnnouncerForTests } from './announce'
import { axeViolations } from './axe.test-helper'
import { PathText } from './PathText'
import { revealLabel } from './urlTextModel'
import { COPIED_MS } from './UrlText'

const writeText = vi.fn<(text: string) => Promise<void>>(() => Promise.resolve())
const DB = '/Users/me/Library/Application Support/CiteFox/projects/textbolt.sqlite'

beforeEach(() => {
  writeText.mockClear()
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  resetAnnouncerForTests()
  Reflect.deleteProperty(window, 'citefox')
})

describe('revealLabel', () => {
  it('names the file manager of this system', () => {
    expect(revealLabel('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)')).toBe('Show in Finder')
    expect(revealLabel('Mozilla/5.0 (Windows NT 10.0; Win64)')).toBe('Show in Explorer')
    expect(revealLabel('Mozilla/5.0 (X11; Linux x86_64)')).toBe('Show in folder')
  })
})

describe('PathText', () => {
  it('shows the path with Copy and Show in Finder, never Open in a browser', async () => {
    const view = render(<PathText path={DB} onReveal={() => Promise.resolve({ ok: true })} />)
    expect(view.getByText(DB).getAttribute('title')).toBe(DB)
    expect(view.queryByRole('link')).toBeNull()
    expect(view.getByRole('button', { name: `Copy ${DB}` })).toBeTruthy()
    expect(view.getByRole('button', { name: `${revealLabel()}: ${DB}` })).toBeTruthy()
    expect(view.container.querySelector('.site-icon')).toBeNull()
    expect(await axeViolations(view.container)).toEqual([])
  })

  it('copies the path with the same 1.5 s tick', async () => {
    vi.useFakeTimers()
    const view = render(<PathText path={DB} label="textbolt.sqlite" />)
    const root = view.container.querySelector('.ui-url') as HTMLElement
    await act(async () => {
      fireEvent.click(view.getByRole('button', { name: 'Copy textbolt.sqlite' }))
    })
    expect(writeText).toHaveBeenCalledWith(DB)
    expect(root.classList.contains('ui-url-copied')).toBe(true)
    expect(announcedText()).toBe('Copied')
    act(() => {
      vi.advanceTimersByTime(COPIED_MS)
    })
    expect(root.classList.contains('ui-url-done')).toBe(true)
  })

  it('reveals through the caller, or settings:revealPath by default, and says why it could not', async () => {
    const onReveal = vi.fn(() => Promise.resolve({ ok: true as const }))
    const view = render(<PathText path={DB} onReveal={onReveal} />)
    await act(async () => {
      fireEvent.click(view.getByRole('button', { name: new RegExp(`^${revealLabel()}`) }))
    })
    expect(onReveal).toHaveBeenCalledTimes(1)
    expect(view.container.querySelector('.ui-url')?.classList.contains('ui-url-done')).toBe(true)
    cleanup()

    const bridge = vi.fn(() =>
      Promise.resolve({
        ok: false as const,
        reason: 'CiteFox can only show its own files.',
        nextStep: 'Open the data folder from Settings instead.'
      })
    )
    Object.defineProperty(window, 'citefox', {
      value: { 'settings:revealPath': bridge },
      configurable: true
    })
    const fallback = render(<PathText path={DB} />)
    await act(async () => {
      fireEvent.keyDown(fallback.getByText(DB), { key: 'Enter', metaKey: true })
    })
    expect(bridge).toHaveBeenCalledWith({ path: DB })
    expect(fallback.container.querySelector('.ui-url-note')?.textContent).toBe(
      'CiteFox can only show its own files. Open the data folder from Settings instead.'
    )
    expect(announcedText()).toContain('Open the data folder from Settings instead.')
  })

  it('copies on Enter from the focused text', async () => {
    const view = render(<PathText path={DB} />)
    await act(async () => {
      fireEvent.keyDown(view.getByText(DB), { key: 'Enter' })
    })
    expect(writeText).toHaveBeenCalledWith(DB)
  })
})
