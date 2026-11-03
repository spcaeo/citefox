// CiteFox's own event sounds, synthesised by scripts/sounds/make_events.py (CiteFox
// Source-Available License). WAV, not MP3: an MP3 starts with encoder silence.
import checkDone from '../assets/sounds/check-done.wav'
import checkProblem from '../assets/sounds/check-problem.wav'
import checkStarted from '../assets/sounds/check-started.wav'

export type EventSound = 'check-started' | 'check-done' | 'check-problem'

const FILES: Record<EventSound, string> = {
  'check-started': checkStarted,
  'check-done': checkDone,
  'check-problem': checkProblem
}

/** Quieter than the citation jingle: these happen often. */
export const EVENT_VOLUME = 0.45

const loaded = new Map<EventSound, HTMLAudioElement | null>()

function audioFor(kind: EventSound): HTMLAudioElement | null {
  const existing = loaded.get(kind)
  if (existing !== undefined) return existing
  let audio: HTMLAudioElement | null
  try {
    audio = new Audio(FILES[kind])
    audio.preload = 'auto'
    audio.volume = EVENT_VOLUME
    audio.load()
  } catch {
    audio = null
  }
  loaded.set(kind, audio)
  return audio
}

/** Loads the sounds now, so the first one starts at once. */
export function preloadEventSounds(): void {
  for (const kind of Object.keys(FILES) as EventSound[]) audioFor(kind)
}

/**
 * Plays one event sound from the start. Any failure (autoplay rules, no audio device, a
 * test without media) is silent: the screen still shows what happened.
 */
export function playEventSound(kind: EventSound): void {
  try {
    const audio = audioFor(kind)
    if (audio === null) return
    audio.currentTime = 0
    void audio.play().catch(() => undefined)
  } catch {
    // No sound, no fuss.
  }
}
