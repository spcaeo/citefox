import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PageDetail, PagePipeline } from '@shared/ipc'
import { errorText } from '../../components/errorText'
import { createPipelineSource, derivedPipeline, type PipelineSource } from './source'

/** Re-read this often while a page is setting up, in case a push was missed. */
export const PIPELINE_POLL_MS = 4000

const LIVE: ReadonlySet<PagePipeline['state']> = new Set(['queued', 'running', 'retrying', 'held'])

export interface PagePipelineState {
  /** Null until the first read. */
  pipeline: PagePipeline | null
  /** Plain words when an action failed. */
  error: string | null
  busy: boolean
  /** Retry, Resume or Start setup. */
  start: () => Promise<void>
  stop: () => Promise<void>
  setCheckWhenReady: (on: boolean) => Promise<void>
}

/**
 * One page's setup, kept live: `setup:progress` for this page re-reads it, and a
 * slow poll covers a missed push. `onSettled` runs once when setup finishes
 * (ready, checked, or failed), so the tab reloads the profile, prompts or gaps.
 */
export function usePagePipeline(
  page: PageDetail,
  options: { source?: PipelineSource | null; onSettled?: () => void } = {}
): PagePipelineState {
  const source = useMemo(
    () => (options.source === undefined ? createPipelineSource() : options.source),
    [options.source]
  )
  const [remote, setPipeline] = useState<PagePipeline | null>(null)
  const derived = useMemo(() => (source === null ? derivedPipeline(page) : null), [source, page])
  const pipeline = source === null ? derived : remote
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const settled = useRef(options.onSettled)
  useEffect(() => {
    settled.current = options.onSettled
  }, [options.onSettled])
  const lastState = useRef<PagePipeline['state'] | null>(null)
  const request = useMemo(
    () => ({ projectId: page.projectId, pageId: page.id }),
    [page.projectId, page.id]
  )

  const accept = useCallback((next: PagePipeline): void => {
    const before = lastState.current
    lastState.current = next.state
    setPipeline(next)
    if (before !== null && LIVE.has(before) && !LIVE.has(next.state)) settled.current?.()
  }, [])

  const read = useCallback(async (): Promise<void> => {
    if (source === null) return
    try {
      accept(await source.page(request))
    } catch (cause) {
      setError(errorText(cause, 'Could not read this page’s setup.'))
    }
  }, [source, request, accept])

  useEffect(() => {
    if (source === null) return
    // The first read runs after this effect (the rule: no state set inside an effect).
    const first = setTimeout(() => void read(), 0)
    const off = source.onProgress((progress) => {
      if (progress.pageId === request.pageId && progress.projectId === request.projectId) {
        void read()
      }
    })
    return () => {
      clearTimeout(first)
      off()
    }
  }, [source, read, request])

  const live = pipeline !== null && LIVE.has(pipeline.state)
  useEffect(() => {
    if (!live || source === null) return
    const timer = setInterval(() => void read(), PIPELINE_POLL_MS)
    return () => clearInterval(timer)
  }, [live, source, read])

  const run = useCallback(
    async (action: (current: PipelineSource) => Promise<PagePipeline>, fallback: string) => {
      if (source === null) return
      setBusy(true)
      setError(null)
      try {
        accept(await action(source))
      } catch (cause) {
        setError(errorText(cause, fallback))
      } finally {
        setBusy(false)
      }
    },
    [source, accept]
  )

  return {
    pipeline,
    error,
    busy,
    start: () => run((current) => current.start(request), 'Could not start setup.'),
    stop: () => run((current) => current.stop(request), 'Could not stop setup.'),
    setCheckWhenReady: async (on: boolean) => {
      if (source === null) return
      setError(null)
      try {
        const saved = await source.checkWhenReady({ projectId: request.projectId, on })
        setPipeline((current) =>
          current === null ? current : { ...current, checkWhenReady: saved.checkWhenReady }
        )
      } catch (cause) {
        setError(errorText(cause, 'Could not save the setting.'))
      }
    }
  }
}
