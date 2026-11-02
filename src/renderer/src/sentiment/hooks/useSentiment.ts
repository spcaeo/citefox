import { useCallback, useEffect, useState } from 'react'
import type { SentimentView } from '@shared/domain'
import type { BrandPromptDraft } from '@shared/ipc'
import { checkError } from '../../m3/source'
import { useEngineRevision } from '../../shell/engineRevision'
import type { SentimentSource } from '../source'
import type { ActionResult } from '../types'

interface Loaded {
  key: string
  view: SentimentView | null
  error: string | null
}

export type SentimentAction = 'generate' | 'save' | 'fact' | 'reread'

export interface SentimentState {
  view: SentimentView | null
  error: string | null
  loading: boolean
  /** The action that is running, or null. */
  busy: SentimentAction | null
  generateBrandPrompts: () => Promise<ActionResult>
  saveBrandPrompts: (prompts: readonly BrandPromptDraft[]) => Promise<ActionResult>
  addFact: (text: string, source: string | null) => Promise<ActionResult>
  deleteFact: (factId: string) => Promise<ActionResult>
  reread: () => Promise<ActionResult>
}

/**
 * `sentiment:get` for one page and market. Reloads after engine pushes
 * (`checks:finished`, `queue:status`) and after `sentiment:updated` for this page.
 */
export function useSentiment(
  source: SentimentSource,
  projectId: string,
  pageId: string,
  marketId: string | null
): SentimentState {
  const key = `${projectId}\0${pageId}\0${marketId ?? ''}`
  const revision = useEngineRevision()
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [tick, setTick] = useState(0)
  const [busy, setBusy] = useState<SentimentAction | null>(null)
  const reload = useCallback(() => setTick((current) => current + 1), [])

  useEffect(() => {
    let cancelled = false
    source['sentiment:get']({ projectId, pageId, marketId }).then(
      (view) => {
        if (!cancelled) setLoaded({ key, view, error: null })
      },
      (cause: unknown) => {
        if (!cancelled) {
          setLoaded({ key, view: null, error: checkError(cause, 'Could not load sentiment.') })
        }
      }
    )
    return () => {
      cancelled = true
    }
  }, [source, projectId, pageId, marketId, key, revision, tick])

  useEffect(
    () =>
      source['sentiment:updated']((payload) => {
        if (payload.projectId === projectId && payload.pageId === pageId) reload()
      }),
    [source, projectId, pageId, reload]
  )

  async function run(
    action: SentimentAction,
    fallback: string,
    work: () => Promise<string | null>
  ): Promise<ActionResult> {
    setBusy(action)
    try {
      const message = await work()
      reload()
      return { ok: true, message }
    } catch (cause) {
      return { ok: false, message: checkError(cause, fallback) }
    } finally {
      setBusy(null)
    }
  }

  const current = loaded !== null && loaded.key === key ? loaded : null
  return {
    view: current?.view ?? null,
    error: current?.error ?? null,
    loading: current === null,
    busy,
    generateBrandPrompts: () =>
      run('generate', 'Could not write brand questions.', async () => {
        const set = await source['sentiment:generateBrandPrompts']({ projectId, pageId })
        return `Saved version ${set.version ?? 1} with ${set.prompts.length} brand questions.`
      }),
    saveBrandPrompts: (prompts) =>
      run('save', 'Could not save the brand questions.', async () => {
        const set = await source['sentiment:saveBrandPrompts']({ projectId, pageId, prompts })
        return `Saved version ${set.version ?? 1}. The next check uses these questions.`
      }),
    addFact: (text, factSource) =>
      run('fact', 'Could not add the fact.', async () => {
        await source['sentiment:addFact']({ projectId, text, source: factSource })
        return null
      }),
    deleteFact: (factId) =>
      run('fact', 'Could not remove the fact.', async () => {
        await source['sentiment:deleteFact']({ projectId, factId })
        return null
      }),
    reread: () =>
      run('reread', 'Could not re-read the saved overviews.', async () => {
        const result = await source['sentiment:reread']({ projectId, pageId })
        return result.message
      })
  }
}
