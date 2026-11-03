import { useEffect } from 'react'
import { bridgeSubscribe, type ResultsChangedSubscribe } from '../shell/resultsRevision'
import { playEventSound, preloadEventSounds, type EventSound } from './eventSounds'
import { getCelebrate, getCelebrateSound, loadCelebrate } from './setting'

function windowActive(): boolean {
  return document.visibilityState === 'visible' && document.hasFocus()
}

/**
 * Mounted once by the shell. A short sound when a check starts and when it finishes,
 * under the same Settings › Appearance switches as the citation jingle: silent when
 * "Celebrate citations" or "Play a sound" is off.
 * Only while the window is in front: a check the schedule starts in the background is
 * silent. A stopped check makes no sound (a stop is the user's own choice).
 */
export function CheckSounds({
  subscribe = bridgeSubscribe,
  play = playEventSound,
  isActive = windowActive
}: {
  subscribe?: ResultsChangedSubscribe
  /** Tests pass fakes for the sound and the window state. */
  play?: (kind: EventSound) => void
  isActive?: () => boolean
}): null {
  useEffect(() => {
    loadCelebrate()
    if (play === playEventSound) preloadEventSounds()
    const started = new Set<string>()
    const stop = subscribe((event) => {
      const first = event.state === 'running' && !started.has(event.jobId)
      if (first) started.add(event.jobId)
      if (event.state === 'finished') started.delete(event.jobId)
      if (event.state === 'stopped') started.delete(event.jobId)
      if (!getCelebrate() || !getCelebrateSound() || !isActive()) return
      if (first) play('check-started')
      else if (event.state === 'finished') play('check-done')
    })
    return stop
  }, [subscribe, play, isActive])
  return null
}
