/*
 * "Hide for now" lasts for this run of the app only: the state lives in this
 * module, so the strip is back on the next launch. It cannot be removed for good.
 */
let hidden = false
const listeners = new Set<() => void>()

export function isStripHidden(): boolean {
  return hidden
}

export function setStripHidden(next: boolean): void {
  hidden = next
  for (const listener of listeners) listener()
}

export function subscribeStrip(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Tests only: show the strip again. */
export function resetSponsorStrip(): void {
  setStripHidden(false)
}
