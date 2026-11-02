import { signed } from './model'

export interface DeltaLine {
  text: string
  className: 'm3-up' | 'm3-down' | 'm3-flat'
}

export function deltaClass(delta: number): DeltaLine['className'] {
  if (delta > 0) return 'm3-up'
  if (delta < 0) return 'm3-down'
  return 'm3-flat'
}

/** Visibility score change line. Colour follows the change since the last check. */
export function scoreDelta(
  sincePrevious: number | null,
  sinceBaseline: number | null,
  since: string
): DeltaLine {
  // The first check is its own baseline: there is nothing to compare with yet.
  if (sincePrevious === null && (sinceBaseline ?? 0) === 0) {
    return { text: 'No earlier check yet', className: 'm3-flat' }
  }
  const main = sincePrevious ?? sinceBaseline ?? 0
  if ((sincePrevious ?? 0) === 0 && (sinceBaseline ?? 0) === 0) {
    return { text: `No change since ${since}`, className: 'm3-flat' }
  }
  const parts: string[] = []
  if (sincePrevious !== null) parts.push(`${signed(sincePrevious)} since ${since}`)
  if (sinceBaseline !== null) parts.push(`${signed(sinceBaseline)} since baseline`)
  return { text: parts.join(' · '), className: deltaClass(main) }
}

/** Page-cited rate line: "60% · was 50%", or "No change since Oct 5 · 50%". */
export function rateDelta(current: number, previous: number | null, since: string): DeltaLine {
  if (previous === null) return { text: `${current}%`, className: 'm3-flat' }
  const change = current - previous
  if (change === 0) return { text: `No change since ${since} · ${current}%`, className: 'm3-flat' }
  return { text: `${current}% · was ${previous}%`, className: deltaClass(change) }
}

/** AI Overview count line: "+2 since Oct 5". Before a second check there is no "since". */
export function countDelta(change: number, hasPrevious: boolean, since: string): DeltaLine {
  if (!hasPrevious) return { text: 'No earlier check yet', className: 'm3-flat' }
  if (change === 0) return { text: `No change since ${since}`, className: 'm3-flat' }
  return { text: `${signed(change)} since ${since}`, className: deltaClass(change) }
}

/** Funnel drop: "−3 lost here · reason", or "None lost here · reason" (never "−0"). */
export function dropText(count: number, reason: string): string {
  return `${count === 0 ? 'None' : `−${count}`} lost here · ${reason}`
}
