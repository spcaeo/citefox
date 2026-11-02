import { useEffect, useState } from 'react'
import type { BuyerPrompt, CoverageMatrix, Market } from '@shared/domain'
import type { PageDetail } from '@shared/ipc'
import type { DrillScope } from '../drill'
import type { ShellClient } from '../projects/client'
import { setupScope } from './drills'

export interface PromptContext {
  /** Null until loaded, or when the prompt set could not be read. */
  prompts: readonly BuyerPrompt[] | null
  /** Null when no coverage matrix is stored. */
  matrix: CoverageMatrix | null
  scope: DrillScope
}

/** The page's default market, else its first. */
export function pageMarket(page: PageDetail): Market | null {
  return (
    page.markets.find((market) => market.id === page.defaultMarketId) ?? page.markets[0] ?? null
  )
}

/**
 * Loads the prompt set and the coverage matrix for a page. A failure leaves
 * the part empty: the screen still works, it just has nothing to drill.
 */
export function usePromptContext(
  client: ShellClient,
  projectId: string,
  page: PageDetail,
  revision: unknown = null
): PromptContext {
  const [prompts, setPrompts] = useState<readonly BuyerPrompt[] | null>(null)
  const [matrix, setMatrix] = useState<CoverageMatrix | null>(null)
  useEffect(() => {
    let cancelled = false
    const request = { projectId, pageId: page.id }
    void client.listPrompts(request).then(
      (view) => {
        if (!cancelled) setPrompts(view.prompts)
      },
      () => {
        if (!cancelled) setPrompts(null)
      }
    )
    void client.getGaps(request).then(
      (next) => {
        if (!cancelled) setMatrix(next)
      },
      () => {
        if (!cancelled) setMatrix(null)
      }
    )
    return () => {
      cancelled = true
    }
  }, [client, projectId, page.id, revision])
  return { prompts, matrix, scope: setupScope(page.id, pageMarket(page)) }
}
