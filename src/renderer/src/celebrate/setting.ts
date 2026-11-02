import { useSyncExternalStore } from 'react'
import type { AppSettingsSnapshot } from '@shared/ipc'

/**
 * Settings › Appearance › "Celebrate citations" and "Play a sound", both on by default.
 * Read from main once (`settings:get`); the Settings switches set them here at once
 * and save them.
 */
interface Switch {
  get: () => boolean
  set: (next: boolean) => void
  subscribe: (listener: () => void) => () => void
}

function createSwitch(): Switch {
  let value = true
  const listeners = new Set<() => void>()
  return {
    get: () => value,
    set: (next) => {
      if (next === value) return
      value = next
      for (const listener of listeners) listener()
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    }
  }
}

const celebrate = createSwitch()
const sound = createSwitch()

export const getCelebrate = celebrate.get
export const setCelebrate = celebrate.set
export function useCelebrate(): boolean {
  return useSyncExternalStore(celebrate.subscribe, celebrate.get, () => true)
}

export const getCelebrateSound = sound.get
export const setCelebrateSound = sound.set
export function useCelebrateSound(): boolean {
  return useSyncExternalStore(sound.subscribe, sound.get, () => true)
}

/** Loads the saved choices when the app has a preload bridge. */
export function loadCelebrate(): void {
  const api =
    typeof window === 'undefined'
      ? undefined
      : (window.citefox as unknown as
          { 'settings:get'?: () => Promise<AppSettingsSnapshot> } | undefined)
  const get = api?.['settings:get']
  if (typeof get !== 'function') return
  void get()
    .then(({ settings }) => {
      if (typeof settings.celebrate === 'boolean') setCelebrate(settings.celebrate)
      if (typeof settings.celebrateSound === 'boolean') setCelebrateSound(settings.celebrateSound)
    })
    .catch(() => {
      // Stays on; Settings still shows and saves them.
    })
}
