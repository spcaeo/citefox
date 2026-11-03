import { useCallback, useEffect, useRef, useState, type JSX } from 'react'
import { Button } from '../ui'
import { TOUR_CAPTIONS } from './captions'
import './intro.css'

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)'

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(REDUCED_MOTION).matches
}

/**
 * The welcome tour: a short film of the real app with its own music, captions burned into
 * the picture and the same words as a hidden transcript. Skip is there from the first
 * second (Esc too). It starts muted when the sound switch is off, and not at all
 * (a still with Play) when the system asks for reduced motion. It ends by itself, or on
 * Skip, and calls `onDone` either way.
 */
export function IntroScreen({
  src,
  soundOn,
  onDone,
  reducedMotion = prefersReducedMotion
}: {
  src: string
  /** Settings › Appearance › Play a sound. Off starts the film muted. */
  soundOn: boolean
  onDone: () => void
  reducedMotion?: () => boolean
}): JSX.Element {
  const video = useRef<HTMLVideoElement>(null)
  const skip = useRef<HTMLButtonElement>(null)
  const [muted, setMuted] = useState(!soundOn)
  const [waiting] = useState(() => reducedMotion())
  const [playing, setPlaying] = useState(!waiting)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    skip.current?.focus()
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onDone()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onDone])

  const play = useCallback((): void => {
    const element = video.current
    if (element === null) return
    setPlaying(true)
    element.play().catch(() => {
      // The player refused (no audio device, a policy): start it muted, else leave.
      element.muted = true
      setMuted(true)
      element.play().catch(() => setFailed(true))
    })
  }, [])

  useEffect(() => {
    if (!waiting) play()
  }, [waiting, play])

  useEffect(() => {
    if (failed) onDone()
  }, [failed, onDone])

  return (
    <div className="intro" role="dialog" aria-modal="true" aria-label="Welcome to CiteFox">
      <div className="intro-stage">
        <video
          ref={video}
          className="intro-video"
          src={src}
          muted={muted}
          playsInline
          preload="auto"
          onEnded={onDone}
          onError={() => setFailed(true)}
          aria-describedby="intro-transcript"
        />
        {playing ? null : (
          <div className="intro-start">
            <Button variant="primary" onClick={play}>
              Play the welcome tour
            </Button>
          </div>
        )}
      </div>
      <div className="intro-bar">
        <Button
          variant="ghost"
          aria-pressed={muted}
          onClick={() => setMuted((current) => !current)}
        >
          {muted ? 'Unmute' : 'Mute'}
        </Button>
        <Button ref={skip} variant="secondary" onClick={onDone}>
          Skip
        </Button>
      </div>
      <p id="intro-transcript" className="intro-transcript">
        {TOUR_CAPTIONS.map((caption) => caption.text).join(' ')}
      </p>
    </div>
  )
}
