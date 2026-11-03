import { useCallback, useEffect, useRef, useState, type JSX } from 'react'
import type { CitationNews } from '@shared/ipc'
import { EngineLogo } from '../engines/EngineLogo'
import { bridgeSubscribe, type ResultsChangedSubscribe } from '../shell/resultsRevision'
import { Button, UrlText } from '../ui'
import { CelebrationArt } from './CelebrationArt'
import { fireConfetti } from './confetti'
import { onCelebrationPreview } from './preview'
import { celebrationText, createCelebrator } from './rules'
import { getCelebrate, getCelebrateSound, loadCelebrate } from './setting'
import { playCelebrationSound, preloadCelebrationSound } from './sound'
import './celebrate.css'

/**
 * How long the card holds before it fades. Hold and fade together last as long as
 * the 4.4 s jingle, so the window stays masked while the music plays.
 */
export const CELEBRATE_HOLD_MS = 3800
/** The fade out, with the music's own fade; none with reduced motion. */
export const CELEBRATE_FADE_MS = 600

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)'

function windowActive(): boolean {
  return document.visibilityState === 'visible' && document.hasFocus()
}

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(REDUCED_MOTION).matches
}

/** True while the user is typing somewhere: the moment then shows without taking focus. */
function isTyping(element: Element | null): boolean {
  if (!(element instanceof HTMLElement)) return false
  return element.isContentEditable || element.matches('input, textarea, select')
}

interface Moment {
  id: number
  news: CitationNews
  motion: boolean
  leaving: boolean
}

/**
 * Mounted once by the shell. Listens to `results:changed` and, the first time a running
 * check finds the user's site cited (see `rules.ts`), masks the window and deals a big
 * card into the middle (owner: "like a play card") with confetti and the jingle, for
 * as long as the music plays. A click anywhere, Esc or "Nice!" ends it early. The
 * Settings › Appearance Preview plays the same moment (`preview.ts`).
 */
export function CelebrationHost({
  subscribe = bridgeSubscribe,
  fire = fireConfetti,
  play = playCelebrationSound,
  isActive = windowActive,
  reducedMotion = prefersReducedMotion
}: {
  subscribe?: ResultsChangedSubscribe
  /** Tests pass fakes for the confetti, the jingle and the window state. */
  fire?: () => void
  play?: () => void
  isActive?: () => boolean
  reducedMotion?: () => boolean
}): JSX.Element {
  const [moment, setMoment] = useState<Moment | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const button = useRef<HTMLButtonElement>(null)
  /** Where focus was before the card took it; null when it did not. */
  const opener = useRef<HTMLElement | null>(null)

  useEffect(() => {
    loadCelebrate()
    // Load the jingle now, so it starts with the card rather than after a load.
    if (play === playCelebrationSound) preloadCelebrationSound()
    let next = 0
    const show = (news: CitationNews): void => {
      const motion = !reducedMotion()
      if (motion) fire()
      if (getCelebrateSound()) play()
      const text = celebrationText(news)
      setAnnouncement(`${text.headline} ${text.line}. ${text.prompt}`.trim())
      next += 1
      setMoment({ id: next, news, motion, leaving: false })
    }
    const celebrator = createCelebrator({ isActive, enabled: getCelebrate, show })
    const stop = subscribe((event) => celebrator.receive(event))
    const stopPreview = onCelebrationPreview(show)
    const resume = (): void => {
      if (isActive()) celebrator.resume()
    }
    window.addEventListener('focus', resume)
    document.addEventListener('visibilitychange', resume)
    return () => {
      stop()
      stopPreview()
      window.removeEventListener('focus', resume)
      document.removeEventListener('visibilitychange', resume)
    }
  }, [subscribe, fire, play, isActive, reducedMotion])

  const id = moment?.id ?? null
  const leaving = moment?.leaving ?? false
  const motion = moment?.motion ?? false

  const close = useCallback(() => {
    setMoment((current) => (current === null ? null : { ...current, leaving: true }))
  }, [])

  // Take focus to "Nice!" unless the user is typing; give it back when the card goes.
  useEffect(() => {
    if (id === null) return
    const active = document.activeElement
    if (!isTyping(active)) {
      opener.current = active instanceof HTMLElement && active !== document.body ? active : null
      button.current?.focus({ preventScroll: true })
    }
  }, [id])

  // Hold, then fade, then go.
  useEffect(() => {
    if (id === null) return
    const timer = window.setTimeout(
      () => {
        if (!leaving) {
          setMoment((current) => (current?.id === id ? { ...current, leaving: true } : current))
          return
        }
        // Focus goes back only if it is still on "Nice!" (or was lost), not if the user moved it.
        const focused = document.activeElement
        const back = opener.current
        opener.current = null
        if (back?.isConnected && (focused === button.current || focused === document.body))
          back.focus({ preventScroll: true })
        setMoment((current) => (current?.id === id ? null : current))
      },
      leaving ? (motion ? CELEBRATE_FADE_MS : 0) : CELEBRATE_HOLD_MS
    )
    return () => window.clearTimeout(timer)
  }, [id, leaving, motion])

  useEffect(() => {
    if (id === null) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      close()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [id, close])

  const text = moment === null ? null : celebrationText(moment.news)
  return (
    <>
      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>
      {moment !== null && text !== null ? (
        // The dim layer sits under the confetti and the card over it, so the paper never hides the words.
        <div
          className="celebrate-moment"
          data-motion={moment.motion ? 'on' : 'off'}
          data-leaving={moment.leaving ? 'true' : undefined}
        >
          <div className="celebrate-dim" aria-hidden="true" />
          <div className="celebrate-scrim" onClick={close}>
            <section
              className="celebrate-card"
              role="dialog"
              aria-modal="true"
              aria-labelledby="celebrate-headline"
              aria-describedby="celebrate-line"
            >
              <div className="celebrate-face">
                <div className="celebrate-art-window">
                  <CelebrationArt />
                </div>
                <h2 className="celebrate-headline" id="celebrate-headline">
                  {text.headline}
                </h2>
                <p className="celebrate-line" id="celebrate-line">
                  {moment.news.engine === null ? null : (
                    <EngineLogo engine={moment.news.engine} className="celebrate-engine" />
                  )}
                  {text.line}
                </p>
                {text.prompt ? <p className="celebrate-prompt">{text.prompt}</p> : null}
                {moment.news.url === null ? null : (
                  // The cited page; Copy and Open work here without closing the card.
                  <div className="celebrate-page" onClick={(event) => event.stopPropagation()}>
                    <UrlText url={moment.news.url} own />
                  </div>
                )}
                <Button ref={button} variant="primary" className="celebrate-ok" onClick={close}>
                  Nice!
                </Button>
              </div>
              <span className="celebrate-shine" aria-hidden="true" />
            </section>
          </div>
        </div>
      ) : null}
    </>
  )
}
