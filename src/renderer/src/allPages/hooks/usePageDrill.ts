import { useCallback, useState } from 'react'
import type { Market } from '@shared/domain'
import type { AllPageRow } from '@shared/ipc'
import { useDrill } from '../../drill'
import { messageOf } from '../../grid/hooks/useSavedViews'
import type { AllPagesSource } from '../source'
import { pageDrill, type PageDrillKind } from '../utils/drills'

export interface PageDrillApi {
  /** Loads the row's check (`row.runId`, default market) and opens the drawer behind one of its numbers. */
  open: (kind: PageDrillKind, row: AllPageRow) => void
  /** Set when the check could not be loaded. */
  error: string | null
}

/**
 * Opens the drawer behind a page's Page cited, Links to this page or Score. The grid
 * holds counts only, so the rows come from `results:get` for exactly the
 * check the counts came from (NFR-14).
 */
export function usePageDrill(
  source: AllPagesSource,
  projectId: string,
  markets: ReadonlyMap<string, Market>
): PageDrillApi {
  const { open: openDrill } = useDrill()
  const [error, setError] = useState<string | null>(null)
  const open = useCallback(
    (kind: PageDrillKind, row: AllPageRow) => {
      setError(null)
      source
        .results({
          projectId,
          pageId: row.id,
          marketId: row.defaultMarketId,
          runId: row.runId ?? null
        })
        .then(
          (results) => {
            const marketId = results.run?.marketId ?? row.defaultMarketId
            const market = marketId === null ? null : (markets.get(marketId) ?? null)
            openDrill(pageDrill(kind, row, results, market))
          },
          (cause: unknown) => setError(messageOf(cause, 'Could not load that check.'))
        )
    },
    [source, projectId, markets, openDrill]
  )
  return { open, error }
}
