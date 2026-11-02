import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AssistDescription, AssistInputs, AssistResult } from '@shared/ipc'
import { useLatest } from '../components/useLatest'
import { currentClientMode } from '../onboarding/flags'
import { createAssistClient, type AssistClient } from './client'
import { useAssistProgress, type AssistProgressView } from '../ui/useAssistProgress'
import { assistErrorText } from './model'

export interface UseAssistOptions {
  assistId: string
  projectId: string | null
  pageId?: string | null
  marketId?: string | null
  promptId?: string | null
  inputs?: AssistInputs
  client?: AssistClient
  onResult?: (result: AssistResult) => void
}

export type AssistPhase = 'idle' | 'running' | 'done' | 'error'

export interface AssistState {
  /** From `assist:describe`. Null until it answers, or when it failed. */
  description: AssistDescription | null
  phase: AssistPhase
  result: AssistResult | null
  error: string | null
  /** Runs the assist. A non-empty instruction is sent as "Tell Claude what to change…". */
  run: (instruction?: string | null) => void
  /** Drops the result or error and goes back to the button. */
  close: () => void
  /** The live steps of the latest run (`assist:progress`, owner feedback #1). */
  progress: AssistProgressView
}

/**
 * One assist's describe and run state. Nothing here writes to the project:
 * Apply and Add belong to the screen (FR-25.2). A reply that arrives after
 * Close, a newer run, or unmount is dropped.
 */
export function useAssist(options: UseAssistOptions): AssistState {
  const { assistId, projectId } = options
  const client = useMemo(
    () => options.client ?? createAssistClient(currentClientMode()),
    [options.client]
  )
  const latest = useLatest(options)
  const describeKey = `${assistId}\u0000${projectId ?? ''}`
  const [described, setDescribed] = useState<{
    key: string
    value: AssistDescription
  } | null>(null)
  const description = described?.key === describeKey ? described.value : null
  const [phase, setPhase] = useState<AssistPhase>('idle')
  const [result, setResult] = useState<AssistResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const runSeq = useRef(0)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      runSeq.current += 1
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const key = `${assistId}\u0000${projectId ?? ''}`
    client.describe({ assistId, projectId }).then(
      (value) => {
        if (!cancelled) setDescribed({ key, value })
      },
      () => {
        // The button still works without the label; a run reports its own error.
      }
    )
    return () => {
      cancelled = true
    }
  }, [client, assistId, projectId])

  const run = useCallback(
    (instruction?: string | null) => {
      const seq = runSeq.current + 1
      runSeq.current = seq
      const current = latest.current
      const text = instruction?.trim() ?? ''
      setPhase('running')
      setError(null)
      client
        .run({
          assistId: current.assistId,
          projectId: current.projectId,
          pageId: current.pageId ?? null,
          marketId: current.marketId ?? null,
          promptId: current.promptId ?? null,
          inputs: current.inputs ?? {},
          instruction: text.length > 0 ? text : null
        })
        .then(
          (next) => {
            if (!mounted.current || seq !== runSeq.current) return
            setResult(next)
            setPhase('done')
            latest.current.onResult?.(next)
          },
          (cause: unknown) => {
            if (!mounted.current || seq !== runSeq.current) return
            setError(assistErrorText(cause))
            setPhase('error')
          }
        )
    },
    [client, latest]
  )

  const close = useCallback(() => {
    runSeq.current += 1
    setPhase('idle')
    setResult(null)
    setError(null)
  }, [])

  const progress = useAssistProgress(phase === 'running', 'assist:run', assistId)

  return { description, phase, result, error, run, close, progress }
}
