// CiteFox's own "soft sparkle" (4.4 s), synthesised by scripts/sounds/make_jingles.py (CiteFox Source-Available License).
// A WAV, not an MP3: an MP3 starts with encoder silence, so the sound lagged the card.
import jingle from '../assets/sounds/cited-soft-sparkle.wav'

/** Loud enough to notice, soft enough not to startle. */
export const CELEBRATE_VOLUME = 0.6

let loaded: HTMLAudioElement | null = null

/**
 * The jingle, loaded once ahead of time so it starts with the card instead of after a
 * load. Null where there is no audio (tests without media).
 */
function preloaded(): HTMLAudioElement | null {
  if (loaded !== null) return loaded
  try {
    loaded = new Audio(jingle)
    loaded.preload = 'auto'
    loaded.volume = CELEBRATE_VOLUME
    loaded.load()
  } catch {
    loaded = null
  }
  return loaded
}

/** Loads the jingle now, so the first celebration plays without a delay. */
export function preloadCelebrationSound(): void {
  preloaded()
}

/**
 * Plays the celebration jingle once, from the start. Any failure (autoplay rules, no
 * audio device, a test environment without media) is silent: the moment still shows.
 */
export function playCelebrationSound(): void {
  try {
    const audio = preloaded()
    if (audio === null) return
    audio.currentTime = 0
    void audio.play().catch(() => undefined)
  } catch {
    // No sound, no fuss.
  }
}
