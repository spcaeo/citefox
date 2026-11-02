import { useEffect, useRef, useState } from 'react'
import type { GenerationTemplateKind, Market, PageSummary, TemplateSettings } from '@shared/domain'
import type { TryTemplateResult } from '@shared/ipc'
import type { TemplatesClient } from '../client'
import { readTemplateFailure } from '../name'

export interface TryItState {
  pages: readonly PageSummary[]
  pageId: string
  setPageId: (id: string) => void
  markets: readonly Market[]
  marketId: string
  setMarketId: (id: string) => void
  loadError: string | null
  running: boolean
  result: TryTemplateResult | null
  error: string | null
  run: (body: string, settings: TemplateSettings) => Promise<void>
}

/**
 * Try it (FR-26.6): pick one of the open project's pages and one of its markets,
 * then run the current draft once with `templates:try`. Nothing is saved.
 */
export function useTryIt(input: {
  client: TemplatesClient
  projectId: string
  kind: GenerationTemplateKind
}): TryItState {
  const { client, projectId, kind } = input
  const [pages, setPages] = useState<readonly PageSummary[]>([])
  const [pageId, setPageIdState] = useState('')
  const [markets, setMarkets] = useState<readonly Market[]>([])
  const [marketId, setMarketIdState] = useState('')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<TryTemplateResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const runTick = useRef(0)

  useEffect(() => {
    let cancelled = false
    void client.pages({ projectId }).then(
      (list) => {
        if (cancelled) return
        setPages(list.pages)
        setPageIdState((current) =>
          list.pages.some((page) => page.id === current) ? current : (list.pages[0]?.id ?? '')
        )
        setLoadError(null)
      },
      (cause: unknown) => {
        if (!cancelled) setLoadError(readTemplateFailure(cause))
      }
    )
    return () => {
      cancelled = true
    }
  }, [client, projectId])

  useEffect(() => {
    if (pageId.length === 0) return
    let cancelled = false
    const page = pages.find((item) => item.id === pageId)
    void client.pageMarkets({ projectId, pageId }).then(
      (list) => {
        if (cancelled) return
        setMarkets(list)
        setMarketIdState((current) => {
          if (list.some((market) => market.id === current)) return current
          const preferred = list.find((market) => market.id === page?.defaultMarketId)
          return preferred?.id ?? list[0]?.id ?? ''
        })
      },
      (cause: unknown) => {
        if (!cancelled) setLoadError(readTemplateFailure(cause))
      }
    )
    return () => {
      cancelled = true
    }
  }, [client, projectId, pageId, pages])

  // A new page or market clears the last answer, so a result never describes another target.
  function setPageId(id: string): void {
    setPageIdState(id)
    setResult(null)
    setError(null)
  }

  function setMarketId(id: string): void {
    setMarketIdState(id)
    setResult(null)
    setError(null)
  }

  async function run(body: string, settings: TemplateSettings): Promise<void> {
    if (running || pageId.length === 0) return
    const tick = ++runTick.current
    setRunning(true)
    setError(null)
    setResult(null)
    try {
      const answer = await client.try({
        projectId,
        pageId,
        marketId: marketId.length > 0 ? marketId : null,
        kind,
        body,
        settings
      })
      if (tick === runTick.current) setResult(answer)
    } catch (cause: unknown) {
      if (tick === runTick.current) setError(readTemplateFailure(cause))
    } finally {
      if (tick === runTick.current) setRunning(false)
    }
  }

  return {
    pages,
    pageId,
    setPageId,
    markets,
    marketId,
    setMarketId,
    loadError,
    running,
    result,
    error,
    run
  }
}
