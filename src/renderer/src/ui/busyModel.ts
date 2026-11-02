import { formatElapsed } from './assistProgressModel'

/** How long a job usually takes, in seconds: `[5, 10]` reads "usually 5–10 s". */
export type UsualRange = readonly [min: number, max: number]

/** After this many times the usual top end, the line says it is taking longer. */
export const SLOW_FACTOR = 2

/** "usually 5–10 s", "usually 30–90 s", "usually about 3 s". */
export function formatUsual(usual: UsualRange): string {
  const [min, max] = usual
  return min === max ? `usually about ${max} s` : `usually ${min}–${max} s`
}

export interface BusyTiming {
  /** "4 s". */
  elapsed: string
  /** "usually 5–10 s", or null when the caller gave no usual time. */
  usual: string | null
  /** "4 s · usually 5–10 s". */
  text: string
  /** True from twice the usual top end: show "Taking longer than usual…". */
  slow: boolean
}

/** What a busy line shows `elapsedMs` into a job that usually takes `usual`. */
export function busyTiming(elapsedMs: number, usual: UsualRange | null = null): BusyTiming {
  const elapsed = formatElapsed(elapsedMs)
  const said = usual ? formatUsual(usual) : null
  return {
    elapsed,
    usual: said,
    text: said ? `${elapsed} · ${said}` : elapsed,
    slow: usual !== null && elapsedMs >= usual[1] * SLOW_FACTOR * 1000
  }
}

/** The visible and spoken words once a job runs past twice its usual time. */
export const SLOW_TEXT = 'Taking longer than usual…'

/** Which mark a row shows: spinning ring, hollow circle, ✓, ✕, ⚠ or a dash. */
export type BusyState = 'running' | 'waiting' | 'done' | 'failed' | 'warning' | 'skipped'
