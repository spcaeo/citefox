import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Market } from '@shared/domain'
import { errorText } from '../../../components/errorText'
import { marketLabel } from '../../../shell/model'
import { ALL_MARKETS, type ExportMarketChoice } from '../model'

export interface ExportMarketOption {
  id: string
  label: string
}

export interface ExportMarkets {
  markets: readonly ExportMarketOption[]
  choice: ExportMarketChoice
  setChoice: (choice: ExportMarketChoice) => void
  /** Every market, or the one picked. */
  marketIds: readonly string[]
  /** Why the page's markets could not be read (only the default is listed). Null when they were. */
  error: string | null
  /** Reads the page's markets again after an error. */
  retry: () => void
}

/** The URL keeps the choice: the screen passes it in and gets each change back. */
export interface ExportMarketControl {
  choice: ExportMarketChoice
  onChoice: (choice: ExportMarketChoice) => void
}

/**
 * The project's default market plus the page's markets (`pages:get`). With no
 * page (a scope of many pages), `projectMarkets` are listed instead.
 */
export function useExportMarkets(
  project: { defaultMarket: Market | null } | null,
  pageId: string | null,
  readPage?: (pageId: string) => Promise<{ markets: readonly Market[] }>,
  /** The market the page was showing: picked first when it is one of the page's. */
  initialMarketId: string | null = null,
  control: ExportMarketControl | null = null,
  projectMarkets: readonly Market[] | null = null
): ExportMarkets {
  const [markets, setMarkets] = useState<readonly ExportMarketOption[]>([])
  const [ownPick, setOwnPick] = useState<ExportMarketChoice>(initialMarketId ?? ALL_MARKETS)
  const picked = control ? control.choice : ownPick
  const setPicked = control ? control.onChoice : setOwnPick
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    const seed: ExportMarketOption[] = []
    if (project?.defaultMarket) {
      seed.push({ id: project.defaultMarket.id, label: marketLabel(project.defaultMarket) })
    }
    const loaded =
      pageId && readPage
        ? readPage(pageId)
        : Promise.resolve({ markets: pageId ? [] : (projectMarkets ?? []) })
    void loaded.then(
      (detail) => {
        if (cancelled) return
        const next = [...seed]
        for (const market of detail.markets) {
          if (!next.some((item) => item.id === market.id)) {
            next.push({ id: market.id, label: marketLabel(market) })
          }
        }
        setMarkets(next)
        setError(null)
      },
      (failure: unknown) => {
        if (cancelled) return
        setMarkets(seed)
        setError(errorText(failure, ''))
      }
    )
    return () => {
      cancelled = true
    }
  }, [project, pageId, readPage, attempt, projectMarkets])

  const choice =
    picked !== ALL_MARKETS && markets.some((market) => market.id === picked) ? picked : ALL_MARKETS
  const marketIds = useMemo(
    () => (choice === ALL_MARKETS ? markets.map((market) => market.id) : [choice]),
    [choice, markets]
  )
  const retry = useCallback(() => setAttempt((n) => n + 1), [])
  return { markets, choice, setChoice: setPicked, marketIds, error, retry }
}
