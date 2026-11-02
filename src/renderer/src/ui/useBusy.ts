import { useEffect, useRef, useState } from 'react'
import { announce as kitAnnounce } from './announce'

/** The clock for live timers: ticks every second while `running`. */
export function useNow(running: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!running) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [running])
  return now
}

/**
 * Milliseconds since `active` last turned true, ticking every second; 0 while
 * it is false. Each busy row or line keeps its own start.
 */
export function useElapsed(active: boolean): number {
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [now, setNow] = useState(0)
  useEffect(() => {
    if (!active) return
    const start = Date.now()
    const tick = (): void => {
      setStartedAt(start)
      setNow(Date.now())
    }
    // The first tick runs at once (a zero timer), then every second.
    const first = setTimeout(tick, 0)
    const timer = setInterval(tick, 1000)
    return () => {
      clearTimeout(first)
      clearInterval(timer)
      setStartedAt(null)
    }
  }, [active])
  return active && startedAt !== null ? Math.max(0, now - startedAt) : 0
}

export interface BusyAnnounceOptions {
  /** Said once when the job starts, such as "Claude is looking for more competitors…". */
  start: string
  /** Said once when it ends. Leave out when the result is announced elsewhere. */
  end?: string
  /** Said once when the job turns slow. */
  slow?: string | null
  /** Where to say it. Default the kit's one polite live region (ui/announce). */
  announce?: (message: string) => void
}

/**
 * Speaks a busy job's start, its end and "taking longer" once each, through a
 * polite live region, never on every tick. The region lives outside the busy
 * card, so `aria-busy` on the card does not hold the words back.
 */
export function useBusyAnnounce(
  active: boolean,
  slowNow: boolean,
  { start, end, slow = null, announce = kitAnnounce }: BusyAnnounceOptions
): void {
  const words = useRef({ start, end, slow, announce })
  useEffect(() => {
    words.current = { start, end, slow, announce }
  })
  const was = useRef(false)
  useEffect(() => {
    if (active && !was.current) words.current.announce(words.current.start)
    else if (!active && was.current && words.current.end) words.current.announce(words.current.end)
    was.current = active
  }, [active])
  useEffect(() => {
    if (active && slowNow && words.current.slow) words.current.announce(words.current.slow)
  }, [active, slowNow])
}
