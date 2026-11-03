import { useCallback, useEffect, useState, type JSX } from 'react'
import { getCelebrate, getCelebrateSound, loadCelebrate } from '../celebrate/setting'
import { closeTour, tourOpenInUrl } from './actions'
import { hasSeenIntro, markIntroSeen } from './introFlag'
import { IntroScreen } from './IntroScreen'
import { TOUR_SRC } from './tourAsset'

/**
 * Mounted once by the app, above "Join CiteFox" and setup. It shows the welcome tour
 * (1) on the first start of a build that registers, before anyone has joined, and
 * (2) whenever the URL says `?dialog=intro` (Help › Watch the welcome tour, Settings).
 * No film in the build, or a film that will not play: nothing shows and nothing waits.
 */
export function IntroHost({
  firstRun,
  src = TOUR_SRC,
  seen = hasSeenIntro,
  markSeen = markIntroSeen
}: {
  /** True while a new person is about to see "Join CiteFox". */
  firstRun: boolean
  src?: string | null
  seen?: () => boolean
  markSeen?: () => void
}): JSX.Element | null {
  const [autoShown, setAutoShown] = useState(() => src !== null && firstRun && !seen())
  const [replay, setReplay] = useState(() => tourOpenInUrl(window.location.hash))

  useEffect(() => {
    loadCelebrate()
    const onHash = (): void => setReplay(tourOpenInUrl(window.location.hash))
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const done = useCallback((): void => {
    markSeen()
    setAutoShown(false)
    closeTour()
    setReplay(false)
  }, [markSeen])

  if (src === null || (!autoShown && !replay)) return null
  return <IntroScreen src={src} soundOn={getCelebrate() && getCelebrateSound()} onDone={done} />
}
