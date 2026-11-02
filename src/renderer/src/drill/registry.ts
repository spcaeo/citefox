import type { DrillRequest } from './types'

/** Screens whose drills are kept, so Back to a recent screen reopens its drill at once. */
const KEPT_SCREENS = 12

/**
 * The drills the numbers on screen stand for, by screen and id, so a link
 * with `drawer=drill&drill=<id>` reopens the list: at once when Back returns
 * to a recent screen, or once the screen has drawn that number again
 * (DrillNumber and DrillButton register what they open). Drill ids repeat
 * across screens ("cited" on two pages), so each screen keeps its own map.
 *
 * Only a first registration of an id tells listeners: numbers re-register
 * on every render, and that must not re-render the host each time.
 */
export class DrillRegistry {
  private readonly screens = new Map<string, Map<string, DrillRequest>>()
  private readonly listeners = new Set<() => void>()
  private screen = ''

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** The screen new registrations belong to (the shell passes the route). */
  setScreen(key: string): void {
    if (key === this.screen) return
    this.screen = key
    const kept = this.screens.get(key)
    if (kept) {
      // Most recent last, so the oldest screen is the first one dropped.
      this.screens.delete(key)
      this.screens.set(key, kept)
    }
    while (this.screens.size > KEPT_SCREENS) {
      const oldest = this.screens.keys().next().value
      if (oldest === undefined) break
      this.screens.delete(oldest)
    }
  }

  register(drill: DrillRequest): void {
    let drills = this.screens.get(this.screen)
    if (!drills) {
      drills = new Map()
      this.screens.set(this.screen, drills)
    }
    const known = drills.has(drill.id)
    drills.set(drill.id, drill)
    if (!known) for (const listener of this.listeners) listener()
  }

  /** The drill `id` on the current screen, or null. */
  get(id: string): DrillRequest | null {
    return this.screens.get(this.screen)?.get(id) ?? null
  }
}
