// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ResultsChanged } from '@shared/ipc'
import { CELEBRATE_FADE_MS, CELEBRATE_HOLD_MS, CelebrationHost } from './CelebrationHost'
import { previewCelebration } from './preview'
import { setCelebrate, setCelebrateSound } from './setting'

const listeners = new Set<(event: ResultsChanged) => void>()
const subscribe = (listener: (event: ResultsChanged) => void): (() => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function push(citation: ResultsChanged['citation'], jobId = 'job-1'): void {
  act(() => {
    for (const listener of listeners) {
      listener({
        projectId: 'p1',
        jobId,
        pageId: 'g1',
        marketId: 'm1',
        promptId: 'q1',
        state: 'running',
        done: 1,
        total: 12,
        citation
      })
    }
  })
}

const CITED = {
  kind: 'cited' as const,
  brand: 'TextBolt',
  promptText: 'nagios email to sms replacement',
  position: 1,
  engine: 'google_aio' as const,
  url: 'https://textbolt.com/nagios-sms/',
  firstEver: false
}

function advance(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms)
  })
}

function setup(options: { active?: () => boolean; reducedMotion?: boolean } = {}): {
  fired: number[]
  played: number[]
} {
  const fired: number[] = []
  const played: number[] = []
  render(
    <CelebrationHost
      subscribe={subscribe}
      fire={() => fired.push(1)}
      play={() => played.push(1)}
      isActive={options.active ?? (() => true)}
      reducedMotion={() => options.reducedMotion ?? false}
    />
  )
  return { fired, played }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  listeners.clear()
  setCelebrate(true)
  setCelebrateSound(true)
})

describe('CelebrationHost', () => {
  it('shows the card with confetti and the jingle, holds ~3 s, then fades out', () => {
    const { fired, played } = setup()
    push(CITED)
    expect(fired).toHaveLength(1)
    expect(played).toHaveLength(1)
    const dialog = screen.getByRole('dialog', { name: 'TextBolt was cited!' })
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(dialog.contains(document.activeElement)).toBe(true)
    expect(dialog.textContent).toContain('Google AI Overview linked your page as link #1')
    expect(dialog.textContent).toContain('“nagios email to sms replacement”')
    expect(dialog.textContent).toContain('/nagios-sms/')
    expect(screen.getByRole('status').textContent).toBe(
      'TextBolt was cited! Google AI Overview linked your page as link #1. “nagios email to sms replacement”'
    )
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Nice!' }))

    advance(CELEBRATE_HOLD_MS - 1)
    expect(document.querySelector('.celebrate-moment')?.hasAttribute('data-leaving')).toBe(false)
    advance(1)
    expect(document.querySelector('.celebrate-moment')?.hasAttribute('data-leaving')).toBe(true)
    advance(CELEBRATE_FADE_MS)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('keeps the card open when Copy or Open on the cited page is used', () => {
    setup()
    push(CITED)
    fireEvent.click(document.querySelector('.celebrate-page') as HTMLElement)
    advance(CELEBRATE_FADE_MS)
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('Preview plays the sample moment every time, even with celebrations off', () => {
    setCelebrate(false)
    const { fired, played } = setup()
    act(() => previewCelebration({ brand: 'TextBolt', site: 'textbolt.com' }))
    const dialog = screen.getByRole('dialog', { name: 'TextBolt was cited!' })
    expect(dialog.textContent).toContain('Google AI Overview linked your page as link #1')
    expect(dialog.textContent).toContain('A sample question your buyers ask')
    advance(CELEBRATE_HOLD_MS)
    advance(CELEBRATE_FADE_MS)
    act(() => previewCelebration({ brand: null, site: null }))
    expect(screen.getByRole('dialog', { name: 'Your site was cited!' })).toBeTruthy()
    expect(fired).toHaveLength(2)
    expect(played).toHaveLength(2)
  })

  it('celebrates only once per check', () => {
    const { fired, played } = setup()
    push(CITED)
    push({ ...CITED, promptText: 'second' })
    expect(fired).toHaveLength(1)
    expect(played).toHaveLength(1)
    expect(screen.getByRole('dialog').textContent).not.toContain('second')
  })

  it('closes early on Esc, on "Nice!" and on a click anywhere', () => {
    setup()
    push(CITED, 'job-1')
    fireEvent.keyDown(window, { key: 'Escape' })
    advance(CELEBRATE_FADE_MS)
    expect(screen.queryByRole('dialog')).toBeNull()

    push(CITED, 'job-2')
    fireEvent.click(screen.getByRole('button', { name: 'Nice!' }))
    advance(CELEBRATE_FADE_MS)
    expect(screen.queryByRole('dialog')).toBeNull()

    push(CITED, 'job-3')
    fireEvent.click(document.querySelector('.celebrate-scrim') as HTMLElement)
    advance(CELEBRATE_FADE_MS)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('does not take focus from a field the user is typing in', () => {
    setup()
    const field = document.createElement('input')
    document.body.appendChild(field)
    field.focus()
    push(CITED)
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(document.activeElement).toBe(field)
    field.remove()
  })

  it('gives focus back to where it was when the card goes', () => {
    setup()
    const opener = document.createElement('button')
    document.body.appendChild(opener)
    opener.focus()
    push(CITED)
    expect(document.activeElement).not.toBe(opener)
    advance(CELEBRATE_HOLD_MS)
    advance(CELEBRATE_FADE_MS)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(opener)
    opener.remove()
  })

  it('with reduced motion shows the card without confetti and goes without a fade', () => {
    const { fired, played } = setup({ reducedMotion: true })
    push(CITED)
    expect(fired).toEqual([])
    expect(played).toHaveLength(1)
    expect(document.querySelector('.celebrate-moment')?.getAttribute('data-motion')).toBe('off')
    advance(CELEBRATE_HOLD_MS)
    advance(0)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('plays no sound with "Play a sound" off', () => {
    setCelebrateSound(false)
    const { fired, played } = setup()
    push(CITED)
    expect(fired).toHaveLength(1)
    expect(played).toEqual([])
  })

  it('stays quiet with "Celebrate citations" off, and for named-only', () => {
    const { fired, played } = setup()
    push({ ...CITED, kind: 'named', position: null, engine: null }, 'job-1')
    setCelebrate(false)
    push(CITED, 'job-2')
    expect(fired).toEqual([])
    expect(played).toEqual([])
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('plays what came in while away once, when the window gets focus back', () => {
    let active = false
    const { fired } = setup({ active: () => active })
    push(CITED)
    push({ ...CITED, promptText: 'second' })
    expect(fired).toEqual([])
    active = true
    act(() => {
      window.dispatchEvent(new Event('focus'))
    })
    act(() => {
      window.dispatchEvent(new Event('focus'))
    })
    expect(fired).toHaveLength(1)
    expect(screen.getByRole('dialog').textContent).toContain('nagios email to sms replacement')
  })
})
