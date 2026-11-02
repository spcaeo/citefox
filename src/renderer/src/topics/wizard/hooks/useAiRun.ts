import { useCallback, useRef, useState } from 'react'
import type { TopicCallInfo } from '@shared/ipc'
import { assistErrorText } from '../../../assist/model'
import { useAssistProgress, type AssistProgressView } from '../../../ui/useAssistProgress'

export type AiPhase = 'idle' | 'running' | 'ready' | 'error'

/** What the progress and result lines say a step reads. */
export const READS_SITE = 'uses your site, no searches'
export const READS_SAVED = 'no new searches'

type Call<T> = (instruction: string | null) => Promise<T>

export interface AiRunState<T> {
  phase: AiPhase
  /** Which action ran, such as `fill_gaps`. */
  actionId: string | null
  title: string
  /** Expected seconds of the running call, for the progress line. */
  seconds: number
  reads: string
  result: T | null
  error: string | null
  run: (options: {
    id: string
    title: string
    seconds: number
    reads?: string
    call: Call<T>
  }) => void
  retry: (instruction?: string) => void
  close: () => void
  /** Live steps of the running call (`assist:progress` from any `topics:` channel). */
  progress: AssistProgressView
}

/**
 * One Claude step at a time for a section: running, its answer, or its error.
 * A newer run replaces an older one (a late answer is dropped). Nothing is
 * written here; the screen applies the answer on Apply.
 */
export function useAiRun<T>(): AiRunState<T> {
  const [phase, setPhase] = useState<AiPhase>('idle')
  const [actionId, setActionId] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [seconds, setSeconds] = useState(0)
  const [reads, setReads] = useState(READS_SAVED)
  const [result, setResult] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const token = useRef(0)
  const lastCall = useRef<Call<T> | null>(null)

  const start = useCallback((call: Call<T>, instruction: string | null) => {
    token.current += 1
    const mine = token.current
    lastCall.current = call
    setPhase('running')
    setError(null)
    call(instruction).then(
      (answer) => {
        if (token.current !== mine) return
        setResult(answer)
        setPhase('ready')
      },
      (cause: unknown) => {
        if (token.current !== mine) return
        setError(assistErrorText(cause))
        setPhase('error')
      }
    )
  }, [])

  const run = useCallback<AiRunState<T>['run']>(
    (options) => {
      setActionId(options.id)
      setTitle(options.title)
      setSeconds(options.seconds)
      setReads(options.reads ?? READS_SAVED)
      setResult(null)
      start(options.call, null)
    },
    [start]
  )

  const retry = useCallback(
    (instruction?: string) => {
      if (lastCall.current) start(lastCall.current, instruction ?? null)
    },
    [start]
  )

  const close = useCallback(() => {
    token.current += 1
    lastCall.current = null
    setPhase('idle')
    setActionId(null)
    setResult(null)
    setError(null)
  }, [])

  const progress = useAssistProgress(phase === 'running', 'topics:')

  return { phase, actionId, title, seconds, reads, result, error, run, retry, close, progress }
}

/** "Claude · about 20 s · no searches" for a finished call. */
export function aiFootnote(info: TopicCallInfo | null | undefined, reads: string): string {
  if (!info) return `CiteFox AI · ${reads}`
  const seconds = Math.max(1, Math.round(info.durationMs / 1000))
  return `CiteFox AI · about ${seconds} s · ${reads}`
}

/** "Claude is working · about 20 s · no searches" while a call runs. */
export function aiProgress(seconds: number, reads: string): string {
  return `CiteFox AI is working · about ${seconds} s · ${reads}`
}
