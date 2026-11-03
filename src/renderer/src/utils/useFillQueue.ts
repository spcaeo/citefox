import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

/** Fills that run at once; the rest wait their turn. */
export const FILL_AT_ONCE = 2

export interface FillQueue {
  /** Ids that are waiting or running. */
  pending: ReadonlySet<string>
  /** Queues an id. Ignored when it is already waiting or running. */
  start: (id: string) => void
}

/**
 * A small queue for background "✦ Fill in" jobs: at most `limit` run at once, in the
 * order they were added. `run` returns the job's promise, or null to skip an id that
 * needs nothing now (the row is gone or already has its text). A job that fails is
 * dropped quietly; the caller keeps its own state. Jobs start after the render that
 * follows `start`, so state set in the same event is already visible to `run`.
 */
export function useFillQueue(
  run: (id: string) => Promise<unknown> | null,
  limit: number = FILL_AT_ONCE
): FillQueue {
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set())
  const latest = useRef(run)
  useLayoutEffect(() => {
    latest.current = run
  })
  const live = useRef(true)
  const running = useRef(0)
  const waiting = useRef<string[]>([])
  const known = useRef(new Set<string>())

  useEffect(() => {
    live.current = true
    return () => {
      live.current = false
    }
  }, [])

  const settle = useCallback((id: string) => {
    known.current.delete(id)
    if (!live.current) return
    setPending((now) => {
      if (!now.has(id)) return now
      const next = new Set(now)
      next.delete(id)
      return next
    })
  }, [])

  const pump = useCallback(() => {
    while (running.current < limit && waiting.current.length > 0) {
      const id = waiting.current.shift() as string
      let job: Promise<unknown> | null
      try {
        job = latest.current(id)
      } catch {
        job = null
      }
      if (job === null) {
        settle(id)
        continue
      }
      running.current += 1
      job
        .catch(() => undefined)
        .finally(() => {
          running.current -= 1
          // Leaving `pending` re-runs the effect below, which starts the next waiting id.
          settle(id)
        })
    }
  }, [limit, settle])

  const start = useCallback((id: string) => {
    if (known.current.has(id)) return
    known.current.add(id)
    waiting.current.push(id)
    setPending((now) => new Set(now).add(id))
  }, [])

  useEffect(() => {
    pump()
  }, [pending, pump])

  return { pending, start }
}
