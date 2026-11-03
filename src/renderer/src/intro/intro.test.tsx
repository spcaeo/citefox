// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeTour, openTour, tourOpenInUrl } from './actions'
import { TOUR_CAPTIONS } from './captions'
import { hasSeenIntro, markIntroSeen } from './introFlag'
import { IntroHost } from './IntroHost'
import { IntroScreen } from './IntroScreen'

beforeEach(() => {
  window.localStorage.clear()
  window.location.hash = '#/overview'
  vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('the tour URL', () => {
  it('opens and closes on ?dialog=intro and keeps the rest of the URL', () => {
    window.location.hash = '#/pages?view=tree'
    openTour()
    expect(tourOpenInUrl(window.location.hash)).toBe(true)
    expect(window.location.hash).toContain('view=tree')
    closeTour()
    expect(tourOpenInUrl(window.location.hash)).toBe(false)
    expect(window.location.hash).toBe('#/pages?view=tree')
  })
})

describe('the seen flag', () => {
  it('is remembered, and a blocked store never throws', () => {
    expect(hasSeenIntro()).toBe(false)
    markIntroSeen()
    expect(hasSeenIntro()).toBe(true)
    const store = window.localStorage
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get: () => {
        throw new Error('blocked')
      }
    })
    try {
      expect(hasSeenIntro()).toBe(false)
      expect(() => markIntroSeen()).not.toThrow()
    } finally {
      Object.defineProperty(window, 'localStorage', { configurable: true, value: store })
    }
  })
})

describe('IntroScreen', () => {
  it('has Skip and Mute from the start, and a transcript of every caption', () => {
    const onDone = vi.fn()
    render(<IntroScreen src="tour.mp4" soundOn onDone={onDone} reducedMotion={() => false} />)
    expect(screen.getByRole('dialog', { name: 'Welcome to CiteFox' })).toBeTruthy()
    for (const caption of TOUR_CAPTIONS) {
      expect(document.getElementById('intro-transcript')?.textContent).toContain(caption.text)
    }
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }))
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it('Esc skips, and the film ending finishes the tour', () => {
    const onDone = vi.fn()
    const { container } = render(
      <IntroScreen src="tour.mp4" soundOn onDone={onDone} reducedMotion={() => false} />
    )
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onDone).toHaveBeenCalledTimes(1)
    fireEvent.ended(container.querySelector('video') as HTMLVideoElement)
    expect(onDone).toHaveBeenCalledTimes(2)
  })

  it('starts muted when the sound switch is off, and Mute toggles', () => {
    const { container } = render(
      <IntroScreen src="tour.mp4" soundOn={false} onDone={vi.fn()} reducedMotion={() => false} />
    )
    expect((container.querySelector('video') as HTMLVideoElement).muted).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Unmute' }))
    expect((container.querySelector('video') as HTMLVideoElement).muted).toBe(false)
  })

  it('with reduced motion it waits for Play instead of starting', () => {
    render(<IntroScreen src="tour.mp4" soundOn onDone={vi.fn()} reducedMotion={() => true} />)
    expect(window.HTMLMediaElement.prototype.play).not.toHaveBeenCalled()
    act(() => screen.getByRole('button', { name: 'Play the welcome tour' }).click())
    expect(window.HTMLMediaElement.prototype.play).toHaveBeenCalled()
  })

  it('a film that cannot play leaves at once', () => {
    const onDone = vi.fn()
    const { container } = render(
      <IntroScreen src="tour.mp4" soundOn onDone={onDone} reducedMotion={() => false} />
    )
    fireEvent.error(container.querySelector('video') as HTMLVideoElement)
    expect(onDone).toHaveBeenCalled()
  })

  it('names no provider in its captions', () => {
    const text = TOUR_CAPTIONS.map((caption) => caption.text).join(' ')
    expect(text).not.toMatch(/cloro|serpapi|claude|jina/i)
    for (const caption of TOUR_CAPTIONS) {
      expect(caption.text.split(/\s+/).length).toBeLessThanOrEqual(8)
    }
  })
})

describe('IntroHost', () => {
  it('shows on a first run, once, and not after it was seen', () => {
    const markSeen = vi.fn()
    const { unmount } = render(
      <IntroHost firstRun src="tour.mp4" seen={() => false} markSeen={markSeen} />
    )
    expect(screen.getByRole('dialog')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }))
    expect(markSeen).toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
    unmount()
    render(<IntroHost firstRun src="tour.mp4" seen={() => true} markSeen={markSeen} />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('shows nothing when the build has no film, and never on a normal start', () => {
    render(<IntroHost firstRun src={null} seen={() => false} />)
    expect(screen.queryByRole('dialog')).toBeNull()
    cleanup()
    render(<IntroHost firstRun={false} src="tour.mp4" seen={() => false} />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('opens from ?dialog=intro and closes back to the same screen', async () => {
    render(<IntroHost firstRun={false} src="tour.mp4" />)
    act(() => openTour())
    expect(await screen.findByRole('dialog')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }))
    expect(window.location.hash).toBe('#/overview')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })
})
